const GameEngine = require("../services/gameEngine");
const AutobetHandler = require("../services/autobetHandler");
const Game = require("../models/Game");
const Round = require("../models/Round");
const { validateBetAmount } = require("../middleware/validation");

function canBypass(req) {
  const u = req.user;
  if (!u) return false;
  if (u.role === "owner") return true;
  return Boolean(u.can_bypass_disabled);
}

function isAllowedToAccessGame(req, gameRow) {
  if (!gameRow) return false;
  if (gameRow.is_enabled) return true;
  return canBypass(req);
}

function isMobileRequest(req) {
  const header = req.headers['x-mobile'] || req.headers['x-client-mobile'];
  if (header === '1' || header === 'true' || header === true) return true;
  const ua = req.headers['user-agent'] || '';
  return /Mobi|Android|iPhone|iPad|Mobile/i.test(ua);
}

async function requireGameEnabledOrBypass(req, res, gameName) {
  const game = Game.findByName(gameName);
  if (!game) {
    res.status(404).json({ success: false, message: "Game not found" });
    return null;
  }
  if (!game.is_enabled && !canBypass(req)) {
    res.status(403).json({ success: false, message: "Betting is disabled for unavailable games." });
    return null;
  }
  if (game.is_mobile_enabled === 0 && isMobileRequest(req) && !canBypass(req)) {
    res.status(403).json({ success: false, message: "Betting is disabled on mobile for this game." });
    return null;
  }
  return game;
}

// What each game's history pill shows (the value is formatted by the client)
const HISTORY_VALUE = {
  dice: (outcome) => outcome.roll, // where the result landed (0–100)
  limbo: (outcome) => outcome.resultMultiplier, // the multiplier that came up
  wheel: (outcome, row) => outcome.multiplier ?? row.multiplier, // the landed segment
};

class GamesController {
  static async getGames(req, res) {
    try {
      const games = Game.getAll(true);

      res.json({
        success: true,
        data: games.map((game) => ({ ...game, config: JSON.parse(game.config) })),
      });
    } catch (error) {
      console.error("Get games error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch games" });
    }
  }

  static async getGame(req, res) {
    try {
      const { gameName } = req.params;
      const game = Game.findByName(gameName);

      if (!game) return res.status(404).json({ success: false, message: "Game not found" });

      const stats = Game.getStats(game.id, "24h");
      const recentRounds = Game.getRecentRounds(game.id, 20);

      res.json({
        success: true,
        data: { ...game, config: JSON.parse(game.config), stats, recentRounds },
      });
    } catch (error) {
      console.error("Get game error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch game" });
    }
  }

  static async playFlip(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "flip");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const selectedSide = req.body.selectedSide;

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      if (!["heads", "tails"].includes(selectedSide)) {
        return res.status(400).json({ success: false, message: "Invalid side selection" });
      }

      const result = await GameEngine.processFlip(req.user.id, betAmount, selectedSide);
      res.json(result);
    } catch (error) {
      console.error("Flip error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  // =======================
  // Coin Flip — multi-flip round (bet first, then call heads / tails)
  // =======================
  static _flipError(res, error, label) {
    const msg = error?.message || "Game error";
    if (error?.code === "FLIP_ROUND_OPEN") {
      return res.status(409).json({ success: false, code: error.code, message: msg });
    }
    // player-side mistakes (stale round, nothing to cash out …) are 400s
    if (/^(Invalid|Round (not found|already finished)|Access denied|Nothing to cash out|Maximum flips|Insufficient balance)/.test(msg)) {
      return res.status(400).json({ success: false, message: msg });
    }
    console.error(label, error);
    return res.status(500).json({ success: false, message: msg });
  }

  static async startFlip(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "flip");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      res.json(await GameEngine.startFlip(req.user.id, betAmount));
    } catch (error) {
      GamesController._flipError(res, error, "Flip start error:");
    }
  }

  static async chooseFlip(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "flip");
      if (!game) return;

      const { roundId, side } = req.body;
      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });
      if (!["heads", "tails"].includes(String(side || "").toLowerCase())) {
        return res.status(400).json({ success: false, message: "Invalid side selection" });
      }

      res.json(await GameEngine.chooseFlip(req.user.id, roundId, side));
    } catch (error) {
      GamesController._flipError(res, error, "Flip choose error:");
    }
  }

  static async cashoutFlip(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "flip");
      if (!game) return;

      const { roundId } = req.body;
      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      res.json(await GameEngine.cashoutFlip(req.user.id, roundId));
    } catch (error) {
      GamesController._flipError(res, error, "Flip cashout error:");
    }
  }

  static async activeFlip(req, res) {
    try {
      res.json(GameEngine.activeFlip(req.user.id));
    } catch (error) {
      console.error("Flip active error:", error);
      res.status(500).json({ success: false, message: "Failed to load the flip round" });
    }
  }

  /**
   * GET /games/:gameName/history — the player's latest rounds of one game for
   * the history pills above the board (same shape as Crash's pills:
   * { roundId, value, won, at }, newest first). Guests get an empty list.
   */
  static async getGameHistory(req, res) {
    try {
      const { gameName } = req.params;
      const valueOf = HISTORY_VALUE[gameName];
      if (!valueOf) return res.status(404).json({ success: false, message: "No history for this game" });
      if (!req.user) return res.json({ success: true, data: [] });

      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const data = Round.getUserGameRounds(req.user.id, gameName, limit)
        .map((row) => {
          const value = Number(valueOf(row.outcome || {}, row));
          if (!Number.isFinite(value)) return null;
          return {
            roundId: row.round_uuid,
            value,
            won: Number(row.payout_amount) > 0,
            at: row.created_at,
          };
        })
        .filter(Boolean);

      res.json({ success: true, data });
    } catch (error) {
      console.error("Get game history error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch history" });
    }
  }

  static async playDice(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "dice");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const targetNumber = Number(req.body.targetNumber);
      const rollUnder = Boolean(req.body.rollUnder);

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processDice(req.user.id, betAmount, targetNumber, rollUnder);
      res.json(result);
    } catch (error) {
      console.error("Dice error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async playLimbo(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "limbo");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const targetMultiplier = Number(req.body.targetMultiplier);

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processLimbo(req.user.id, betAmount, targetMultiplier);
      res.json(result);
    } catch (error) {
      console.error("Limbo error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async startMines(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "mines");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const mineCount = Number(req.body.mineCount);
      const gridSize = req.body.gridSize != null ? Number(req.body.gridSize) : 5;

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processMines(req.user.id, betAmount, mineCount, gridSize);
      res.json(result);
    } catch (error) {
      console.error("Mines error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async revealMinesCell(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "mines");
      if (!game) return;

      const { roundId, cellIndex } = req.body;
      const result = await GameEngine.revealMinesCell(roundId, cellIndex);
      res.json(result);
    } catch (error) {
      console.error("Mines reveal error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async cashoutMines(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "mines");
      if (!game) return;

      const { roundId } = req.body;
      const result = await GameEngine.cashoutMines(roundId);
      res.json(result);
    } catch (error) {
      console.error("Mines cashout error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async playRoulette(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "roulette");
      if (!game) return;

      const { bets } = req.body;

      if (!Array.isArray(bets) || bets.length === 0) {
        return res.status(400).json({ success: false, message: "Invalid bets" });
      }

      for (const bet of bets) {
        const validation = validateBetAmount(Number(bet.amount));
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            message: `Invalid bet amount: ${validation.message}`,
          });
        }
      }

      const result = await GameEngine.processRoulette(
        req.user.id,
        bets.map((b) => ({ ...b, amount: Number(b.amount) }))
      );

      res.json(result);
    } catch (error) {
      console.error("Roulette error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async startBlackjack(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "blackjack");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processBlackjack(req.user.id, betAmount);
      res.json(result);
    } catch (error) {
      console.error("Blackjack error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async blackjackAction(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "blackjack");
      if (!game) return;

      const { roundId, action, handIndex } = req.body;

      if (!["hit", "stand", "double", "split"].includes(action)) {
        return res.status(400).json({ success: false, message: "Invalid action" });
      }

      const result = await GameEngine.blackjackAction(roundId, action, handIndex ?? 0);
      res.json(result);
    } catch (error) {
      console.error("Blackjack action error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async playKeno(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "keno");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const selectedNumbers = req.body.selectedNumbers;
      const difficulty = (req.body.difficulty || "medium").toLowerCase();

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processKeno(req.user.id, betAmount, selectedNumbers, difficulty);
      res.json(result);
    } catch (error) {
      console.error("Keno error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async getKenoLadder(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "keno");
      if (!game) return;

      const picks = Number(req.query.picks);
      const difficulty = (req.query.difficulty || "medium").toLowerCase();

      const result = GameEngine.getKenoLadder(difficulty, picks);
      res.json({ success: true, data: { ...result, version: GameEngine.getKenoPayoutTableVersion() } });
    } catch (error) {
      console.error("Keno ladder error:", error);
      res.status(400).json({ success: false, message: error.message || "Failed to fetch ladder" });
    }
  }

  static async playPlinko(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "plinko");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const rows = req.body.rows != null ? Number(req.body.rows) : 16;
      const difficulty = (req.body.difficulty || "low").toLowerCase();

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      if (![8, 9, 10, 11, 12, 13, 14, 15, 16].includes(rows)) {
        return res.status(400).json({ success: false, message: "Invalid rows" });
      }

      if (!["low", "medium", "high"].includes(difficulty)) {
        return res.status(400).json({ success: false, message: "Invalid difficulty" });
      }

      const result = await GameEngine.processPlinko(req.user.id, betAmount, rows, difficulty);
      res.json(result);
    } catch (error) {
      console.error("Plinko error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async startTower(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "tower");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const difficulty = (req.body.difficulty || "easy").toLowerCase();

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      if (!["easy", "medium", "hard"].includes(difficulty)) {
        return res.status(400).json({ success: false, message: "Invalid difficulty" });
      }

      const result = await GameEngine.processTowerStart(req.user.id, betAmount, difficulty);
      res.json(result);
    } catch (error) {
      console.error("Tower start error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async towerPick(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "tower");
      if (!game) return;

      const { roundId, tileIndex } = req.body;

      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      const idx = Number(tileIndex);
      if (!Number.isInteger(idx) || idx < 0) {
        return res.status(400).json({ success: false, message: "Invalid tileIndex" });
      }

      const result = await GameEngine.towerPick(roundId, idx);
      res.json(result);
    } catch (error) {
      console.error("Tower pick error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async cashoutTower(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "tower");
      if (!game) return;

      const { roundId } = req.body;
      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      const result = await GameEngine.towerCashout(roundId);
      res.json(result);
    } catch (error) {
      console.error("Tower cashout error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async playRussianRoulette(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "russian_roulette");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const blankCount = Number(req.body.blankCount);
      const betOn = req.body.betOn;

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processRussianRoulette(req.user.id, betAmount, blankCount, betOn);
      res.json(result);
    } catch (error) {
      console.error("Russian Roulette error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async startRussianRoulette(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "russian_roulette");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processRussianRouletteStart(req.user.id, betAmount);
      res.json(result);
    } catch (error) {
      console.error("RR start error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async russianRoulettePlaceShotBet(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "russian_roulette");
      if (!game) return;

      const { roundId, betAmount } = req.body;
      const amount = Number(betAmount);

      const validation = validateBetAmount(amount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.processRussianRoulettePlaceShotBet(roundId, amount);
      res.json(result);
    } catch (error) {
      console.error("RR bet2 error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async russianRouletteResolveShot(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "russian_roulette");
      if (!game) return;

      const { roundId } = req.body;
      const result = await GameEngine.processRussianRouletteResolveShot(roundId);
      res.json(result);
    } catch (error) {
      console.error("RR resolve shot error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  // =======================
  // Wheel
  // =======================
  static async playWheel(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "wheel");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const riskLevel = (req.body.riskLevel || "medium").toLowerCase();
      const segments = req.body.segments != null ? Number(req.body.segments) : 30;

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      if (!["low", "medium", "high"].includes(riskLevel)) {
        return res.status(400).json({ success: false, message: "Invalid risk level" });
      }

      if (![10, 20, 30, 40, 50].includes(segments)) {
        return res.status(400).json({ success: false, message: "Invalid segment count" });
      }

      const result = await GameEngine.processWheel(req.user.id, betAmount, riskLevel, segments);
      res.json(result);
    } catch (error) {
      console.error("Wheel error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async wheelLayout(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "wheel");
      if (!game) return;

      const riskLevel = (req.body.riskLevel || "medium").toLowerCase();
      const segments = req.body.segments != null ? Number(req.body.segments) : 30;

      if (!["low", "medium", "high"].includes(riskLevel)) {
        return res.status(400).json({ success: false, message: "Invalid risk level" });
      }

      if (![10, 20, 30, 40, 50].includes(segments)) {
        return res.status(400).json({ success: false, message: "Invalid segment count" });
      }

      const data = GameEngine.getWheelLayout(riskLevel, segments);
      res.json(data);
    } catch (error) {
      console.error("Wheel layout error:", error);
      res.status(500).json({ success: false, message: error.message || "Failed to get wheel layout" });
    }
  }

  // =======================
  // Snakes (v2)
  // =======================
  static async snakesLayout(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "snakes");
      if (!game) return;

      const difficulty = (req.body.difficulty || "medium").toLowerCase();

      if (!["easy", "medium", "hard", "expert", "master"].includes(difficulty)) {
        return res.status(400).json({ success: false, message: "Invalid difficulty" });
      }

      const result = await GameEngine.snakesLayout(difficulty);
      res.json(result);
    } catch (error) {
      console.error("Snakes layout error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async startSnakes(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "snakes");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const difficulty = (req.body.difficulty || "medium").toLowerCase();

      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      if (!["easy", "medium", "hard", "expert", "master"].includes(difficulty)) {
        return res.status(400).json({ success: false, message: "Invalid difficulty" });
      }

      const result = await GameEngine.processSnakesStart(req.user.id, betAmount, difficulty);
      res.json(result);
    } catch (error) {
      console.error("Snakes start error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async snakesRoll(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "snakes");
      if (!game) return;

      const { roundId } = req.body;
      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      const result = await GameEngine.snakesRoll(roundId);
      res.json(result);
    } catch (error) {
      console.error("Snakes roll error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async cashoutSnakes(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "snakes");
      if (!game) return;

      const { roundId } = req.body;
      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      const result = await GameEngine.snakesCashout(roundId);
      res.json(result);
    } catch (error) {
      console.error("Snakes cashout error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  // =======================
  // Rock Paper Scissors (your file shows stake-like ladder methods)
  // =======================
  static async startRPS(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "rps");
      if (!game) return;

      const betAmount = Number(req.body.betAmount);
      const validation = validateBetAmount(betAmount);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

      const result = await GameEngine.startRPS(req.user.id, betAmount);
      res.json(result);
    } catch (error) {
      console.error("RPS start error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async chooseRPS(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "rps");
      if (!game) return;

      const { roundId, choice } = req.body;
      const playerChoice = (choice || "").toLowerCase();

      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      if (!["rock", "paper", "scissors"].includes(playerChoice)) {
        return res.status(400).json({
          success: false,
          message: "Invalid choice. Must be rock, paper, or scissors",
        });
      }

      const result = await GameEngine.chooseRPS(req.user.id, roundId, playerChoice);
      res.json(result);
    } catch (error) {
      console.error("RPS choose error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async cashoutRPS(req, res) {
    try {
      const game = await requireGameEnabledOrBypass(req, res, "rps");
      if (!game) return;

      const { roundId } = req.body;
      if (!roundId) return res.status(400).json({ success: false, message: "Missing roundId" });

      const result = await GameEngine.cashoutRPS(req.user.id, roundId);
      res.json(result);
    } catch (error) {
      console.error("RPS cashout error:", error);
      res.status(500).json({ success: false, message: error.message || "Game error" });
    }
  }

  static async processAutobet(req, res) {
    try {
      const { game, config } = req.body;

      const g = await requireGameEnabledOrBypass(req, res, game);
      if (!g) return;

      AutobetHandler.validateConfig(config);

      let result;

      switch (game) {
        case "flip":
          result = await AutobetHandler.processAutobetFlip(req.user.id, config);
          break;
        case "dice":
          result = await AutobetHandler.processAutobetDice(req.user.id, config);
          break;
        case "limbo":
          result = await AutobetHandler.processAutobetLimbo(req.user.id, config);
          break;
        case "plinko":
          result = await AutobetHandler.processAutobetPlinko(req.user.id, config);
          break;
        case "keno":
          result = await AutobetHandler.processAutobetKeno(req.user.id, config);
          break;
        case "rps":
          result = await AutobetHandler.processAutobetRPS(req.user.id, config);
          break;
        case "wheel":
          result = await AutobetHandler.processAutobetWheel(req.user.id, config);
          break;
        default:
          return res.status(400).json({ success: false, message: "Autobet not supported for this game" });
      }

      res.json(result);
    } catch (error) {
      console.error("Autobet error:", error);
      res.status(500).json({ success: false, message: error.message || "Autobet failed" });
    }
  }

  static async getUserRounds(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const rounds = Round.getUserRounds(req.user.id, limit, offset);
      res.json({ success: true, data: rounds });
    } catch (error) {
      console.error("Get rounds error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch rounds" });
    }
  }

  static async getRound(req, res) {
    try {
      const { roundId } = req.params;
      const round = Round.findById(roundId);

      if (!round) return res.status(404).json({ success: false, message: "Round not found" });

      if (round.user_id !== req.user.id && req.user.role !== "admin" && req.user.role !== "owner") {
        return res.status(403).json({ success: false, message: "Access denied" });
      }

      res.json({ success: true, data: round });
    } catch (error) {
      console.error("Get round error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch round" });
    }
  }
}

module.exports = GamesController;