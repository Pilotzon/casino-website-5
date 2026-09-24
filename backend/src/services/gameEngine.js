const RNG = require("../utils/rng");
const User = require("../models/User");
const Game = require("../models/Game");
const Round = require("../models/Round");
const { WIN_DAMPENER } = require("../config/gameTuning");
const { gameTuning } = require("../config/classifiedConfig");
const { getMinesMultiplier } = require("../config/minesPayoutTable");
const { getTowerMultiplier } = require("../config/towerPayoutTable");
const { KENO_PAYOUTS, getKenoMultiplier } = require("../config/kenoPayoutTable");
const { getWheelDefinition } = require("../config/wheelPayoutTable");

const {
  formatNumber,
  calculateHandTotal,
  isBlackjack,
  checkRouletteBet,
  getRoulettePayout,
} = require("../utils/helpers");

/**
 * GAME ENGINE
 * Server is the source of truth.
 *
 * IMPORTANT POLICY (per your request):
 * - If they win, they get full payout.
 * - If they lose, they lose full bet.
 * - We only reduce win frequency (WIN_DAMPENER), never skim winnings.
 */

// ---- Limbo tuning: "make >5x pretty rare" ----
// Probability(M >= X) approx = 1 / X^POWER (for this chosen formula)
const LIMBO_POWER = 2.2; // try 2.2–3.0. Higher = rarer big multipliers.

// -----------------------------
// Blackjack card normalization
// RNG.generateDeck() returns: { suit, value }
// Frontend expects: { suit, r } or { suit, rank }.
// helpers below ensure consistent shape in game_state + responses.
// -----------------------------
function bjRank(card) {
  return card?.r ?? card?.rank ?? card?.value;
}

function bjSuit(card) {
  return card?.s ?? card?.suit;
}

function normalizeCard(card) {
  if (!card) return card;
  if (card.hidden) return card;
  return {
    ...card,
    r: bjRank(card),
    s: bjSuit(card),
  };
}

function normalizeHand(hand) {
  return (hand || []).map(normalizeCard);
}

function canSplitHand(hand) {
  if (!Array.isArray(hand) || hand.length !== 2) return false;
  const r0 = bjRank(hand[0]);
  const r1 = bjRank(hand[1]);
  return !!r0 && r0 === r1;
}

function isTwoCardHand(hand) {
  return Array.isArray(hand) && hand.length === 2;
}

function bjCardValueForDealer(card) {
  const r = bjRank(card);
  if (r === "A") return 11;
  if (["K", "Q", "J"].includes(r)) return 10;
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

function worsenNextDealerHitCard(deck, startIndex, maxLookahead = 24) {
  const i = startIndex;
  if (!deck?.[i]) return;

  const iVal = bjCardValueForDealer(deck[i]);

  const end = Math.min(deck.length - 1, i + maxLookahead);
  let bestJ = -1;
  let bestVal = iVal;

  for (let j = i + 1; j <= end; j++) {
    const v = bjCardValueForDealer(deck[j]);
    if (v < bestVal) {
      bestVal = v;
      bestJ = j;
      if (bestVal <= 4) break; // early exit if we found a very low card
    }
  }

  if (bestJ !== -1) {
    const tmp = deck[i];
    deck[i] = deck[bestJ];
    deck[bestJ] = tmp;
  }
}

class GameEngine {
  /**
   * Process a Coin Flip round
   */
static async processFlip(userId, betAmount, selectedSide) {
  const game = Game.findByName("flip");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  // Lock credits (this returns balance AFTER subtracting bet)
  const balanceAfterBet = User.updateBalance(userId, -bet, "Flip bet placed");

  try {
    const result = RNG.randomBool() ? "heads" : "tails";

    let won = result === selectedSide;

    // Make wins less frequent without reducing payout
    if (won && RNG.randomFloat() > WIN_DAMPENER) won = false;

    const multiplier = won ? 1.98 : 0;
    const payoutAmount = won ? bet * multiplier : 0;

    // IMPORTANT: use the returned value as the authoritative final balance
    let finalBalance = balanceAfterBet;
    if (payoutAmount > 0) {
      finalBalance = User.updateBalance(userId, payoutAmount, "Flip win payout");
    }

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount,
      multiplier,
      outcome: { result, selectedSide, won },
      gameState: { seed: RNG.generateSeed() },
    });

    return {
      success: true,
      round,
      result: {
        outcome: result,
        won,
        payout: payoutAmount,
        balance: finalBalance,
      },
    };
  } catch (error) {
    // Refund bet on server error
    User.updateBalance(userId, bet, "Flip bet refunded due to error");
    throw error;
  }
}

  /**
   * Process a Dice roll
   *
   * FIXED:
   * - Backend win logic now matches UI coloring exactly:
   *   - rollUnder: win if roll < targetNumber
   *   - rollOver : win if roll > targetNumber
   *   - equality loses
   * - Multiplier matches frontend: multiplier = (99 / chance)
   *   where chance = target (under) or (100-target) (over)
   * - WIN_DAMPENER is NOT applied here, because any dampening that flips wins to losses
   *   will necessarily produce "loss on green side", which is the reported bug.
   */
static async processDice(userId, betAmount, targetNumber, rollUnder = true) {
  const game = Game.findByName("dice");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  const target = Number(targetNumber);
  const under = !!rollUnder;

  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  // Frontend allows ~3..97; backend safe check:
  if (!Number.isFinite(target) || target <= 0 || target >= 100) {
    throw new Error("Target must be between 1 and 99");
  }

  // Lock credits (returns balance AFTER subtracting bet)
  const balanceAfterBet = User.updateBalance(userId, -bet, "Dice bet placed");

  try {
    // RNG.rollDice() returns [0, 100). Keep 2 decimals for display.
    const roll = formatNumber(RNG.rollDice(), 2);

    // Win logic aligned with UI divider (equality loses)
    const won = under ? roll < target : roll > target;

    // House edge 1% => 99 used in numerator (matches frontend MAX_ROLL - HOUSE_EDGE)
    const chance = under ? target : 100 - target;
    const houseEdgeAdjusted = 99;

    // multiplier shown/used: 99/chance (only meaningful if won; else 0)
    const multiplier = won ? formatNumber(houseEdgeAdjusted / chance, 8) : 0;

    const payoutAmount = won ? bet * multiplier : 0;

    // IMPORTANT: use the returned value as the authoritative final balance
    let finalBalance = balanceAfterBet;
    if (payoutAmount > 0) {
      finalBalance = User.updateBalance(userId, payoutAmount, "Dice win payout");
    }

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount,
      multiplier: won ? multiplier : 0,
      outcome: {
        roll,
        targetNumber: target,
        rollUnder: under,
        won,
        chance,
        houseEdge: 1,
      },
      gameState: { seed: RNG.generateSeed() },
    });

    return {
      success: true,
      round,
      result: {
        roll,
        won,
        payout: payoutAmount,
        multiplier: won ? multiplier : 0,
        balance: finalBalance,
      },
    };
  } catch (error) {
    User.updateBalance(userId, bet, "Dice bet refunded due to error");
    throw error;
  }
}

  /**
   * Limbo
   * Make >5x rare by using a heavy-tail with tunable power.
   */
  static async processLimbo(userId, betAmount, targetMultiplier) {
    const game = Game.findByName("limbo");
    if (!game || !game.is_enabled) {
      throw new Error("Game is disabled");
    }

    const bet = Number(betAmount);
    const target = Number(targetMultiplier);

    if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");
    if (target < 1.01 || target > 1000000) {
      throw new Error("Target multiplier must be between 1.01 and 1,000,000");
    }

    // ✅ Make 2x harder by increasing house edge (example: 50% => 2x wins ~25%)
    // You can tune this number:
    const houseEdge = 0.50;

    // Lock credits
    const newBalance = User.updateBalance(userId, -bet, "Limbo bet placed");

    try {
      // Standard limbo/crash style result:
      // P(result >= T) = (1 - houseEdge) / T
      const resultMultiplier = RNG.generateLimboResult(houseEdge);

      const won = resultMultiplier >= target;

      // Payout consistent with the same house edge (so displayed odds can be honest)
      // If you want even harsher, change to: won ? bet * target : 0
      const payoutAmount = won ? bet * target : 0;

      if (payoutAmount > 0) {
        User.updateBalance(userId, payoutAmount, "Limbo win payout");
      }

      const round = Round.create({
        userId,
        gameId: game.id,
        betAmount: bet,
        payoutAmount,
        multiplier: won ? target : 0,
        outcome: { resultMultiplier, targetMultiplier: target, won, houseEdge },
        gameState: { seed: RNG.generateSeed() },
      });

      return {
        success: true,
        round,
        result: {
          multiplier: resultMultiplier,
          won,
          payout: payoutAmount,
          balance: newBalance + payoutAmount,
          houseEdge,
        },
      };
    } catch (error) {
      User.updateBalance(userId, bet, "Limbo bet refunded due to error");
      throw error;
    }
  }

  static async processPlinko(userId, betAmount, rows = 16, difficulty = "low") {
    const game = Game.findByName("plinko");
    if (!game || !game.is_enabled) throw new Error("Game is disabled");

    const bet = Number(betAmount);
    const r = Number(rows);

    if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

    // Validate rows
    if (![8, 9, 10, 11, 12, 13, 14, 15, 16].includes(r)) {
      throw new Error("Invalid rows");
    }

    // Validate difficulty
    if (!["low", "medium", "high"].includes(difficulty)) {
      throw new Error("Invalid difficulty");
    }

    const newBalance = User.updateBalance(userId, -bet, "Plinko bet placed");

    try {
      const path = RNG.generatePlinkoPath(r);
      const finalPosition = RNG.calculatePlinkoPosition(path);

      const multipliers = RNG.getPlinkoMultipliers(r, difficulty);
      const multiplier = multipliers[finalPosition] ?? 0;

      const payoutAmount = bet * multiplier;

      if (payoutAmount > 0) {
        User.updateBalance(userId, payoutAmount, "Plinko win payout");
      }

      const round = Round.create({
        userId,
        gameId: game.id,
        betAmount: bet,
        payoutAmount,
        multiplier,
        outcome: { path, finalPosition, difficulty },
        gameState: { seed: RNG.generateSeed(), rows: r, difficulty },
      });

      return {
        success: true,
        round,
        result: {
          path,
          finalPosition,
          difficulty,
          multipliers, // ✅ send to frontend so labels ALWAYS match payout
          multiplier,
          payout: payoutAmount,
          balance: newBalance + payoutAmount,
        },
      };
    } catch (error) {
      User.updateBalance(userId, bet, "Plinko bet refunded due to error");
      throw error;
    }
  }
static async processMines(userId, betAmount, mineCount, gridSize = 5) {
  const game = Game.findByName("mines");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  const mines = Number(mineCount);
  const size = Number(gridSize);

  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");
  if (!Number.isInteger(mines) || mines < 1 || mines >= size * size) throw new Error("Invalid mine count");

  const newBalance = User.updateBalance(userId, -bet, "Mines bet placed");

  try {
    const minePositions = RNG.generateMines(size, mines);

    const gameState = {
      minePositions,
      gridSize: size,
      mineCount: mines,
      revealedCells: [],
      currentMultiplier: 1.0,
      seed: RNG.generateSeed(),
      status: "in_progress", // ✅ FIX: Explicitly set initial status
    };

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "in_progress" },
      gameState,
    });

    return {
      success: true,
      round,
      gameState: {
        roundId: round.id,
        gridSize: size,
        mineCount: mines,
        currentMultiplier: 1.0,
        revealedCells: [],
        balanceAfterBet: newBalance,
      },
    };
  } catch (error) {
    User.updateBalance(userId, bet, "Mines bet refunded due to error");
    throw error;
  }
}

static async revealMinesCell(roundId, cellIndex) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const gameState = round.game_state;

  // ✅ FIX: Guard against already-finished rounds (double-click / race condition)
  if (gameState.status && gameState.status !== "in_progress") {
    throw new Error("Round is not active");
  }

  if (gameState.revealedCells.includes(cellIndex)) {
    throw new Error("Cell already revealed");
  }

  const hitMine = gameState.minePositions.includes(cellIndex);
  gameState.revealedCells.push(cellIndex);

  if (hitMine) {
    // ✅ FIX: Mark original round as finished so it can't be acted on again
    gameState.status = "lost";

    Round.updateGameState(roundId, gameState);

    // ✅ FIX: Update the original round's payout/outcome (closes it properly)
    Round.updatePayout(roundId, 0, 0, {
      status: "lost",
      hitMine: true,
      cellIndex,
    });

    // Also create a history record (keep existing behavior)
    Round.create({
      userId: round.user_id,
      gameId: round.game_id,
      betAmount: round.bet_amount,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "lost", hitMine: true, cellIndex },
      gameState,
    });

    return {
      success: true,
      hitMine: true,
      gameOver: true,
      minePositions: gameState.minePositions,
      payout: 0,
    };
  }

  // ✅ Use payout table: multiplier depends on mineCount and gems revealed
  const gemsRevealed = gameState.revealedCells.length;
  const mult = getMinesMultiplier(gameState.mineCount, gemsRevealed);

  if (!mult) {
    throw new Error(
      `Missing payout table entry for mines=${gameState.mineCount}, gems=${gemsRevealed}`
    );
  }

  gameState.currentMultiplier = formatNumber(mult, 8);

  // Persist game_state so cashout uses correct multiplier
  Round.updateGameState(roundId, gameState);

  return {
    success: true,
    hitMine: false,
    gameOver: false,
    currentMultiplier: gameState.currentMultiplier,
    revealedCells: gameState.revealedCells,
  };
}

static async cashoutMines(roundId) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const gameState = round.game_state;

  // ✅ FIX: Guard against double-cashout / already-finished rounds
  if (gameState.status && gameState.status !== "in_progress") {
    throw new Error("Round is not active");
  }

  if (!gameState.revealedCells || gameState.revealedCells.length === 0) {
    throw new Error("Reveal at least one cell before cashing out");
  }

  const payoutAmount = round.bet_amount * gameState.currentMultiplier;

  // ✅ FIX: Mark original round as finished BEFORE crediting (prevents race condition)
  gameState.status = "cashed_out";
  Round.updateGameState(roundId, gameState);

  // ✅ updateBalance returns the new balance
  let newBalance = null;
  if (payoutAmount > 0) {
    newBalance = User.updateBalance(round.user_id, payoutAmount, "Mines cashout");
  }

  // ✅ FIX: Update the original round's payout/outcome
  Round.updatePayout(roundId, payoutAmount, gameState.currentMultiplier, {
    status: "cashed_out",
    revealedCells: gameState.revealedCells.length,
  });

  // Also create a history record
  Round.create({
    userId: round.user_id,
    gameId: round.game_id,
    betAmount: round.bet_amount,
    payoutAmount,
    multiplier: gameState.currentMultiplier,
    outcome: { status: "cashed_out", revealedCells: gameState.revealedCells.length },
    gameState,
  });

  return {
    success: true,
    payout: payoutAmount,
    multiplier: gameState.currentMultiplier,
    minePositions: gameState.minePositions,
    ...(typeof newBalance === "number" ? { balance: newBalance } : {}),
  };
}

  static async processRoulette(userId, bets) {
  const game = Game.findByName("roulette");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  if (!Array.isArray(bets) || bets.length === 0) throw new Error("Invalid bets");

  // Clean + validate amounts, keep type/value as strings
  const cleanedBets = bets.map((b) => ({
    type: String(b.type || "").toLowerCase(),
    value: b.value != null ? String(b.value) : "",
    amount: Number(b.amount),
  }));

  for (const b of cleanedBets) {
    if (!b.type) throw new Error("Invalid bet type");
    if (!Number.isFinite(b.amount) || b.amount <= 0) throw new Error("Invalid bet amount");
    // value is validated in checkRouletteBet indirectly; but we keep it as-is
  }

  const totalBet = cleanedBets.reduce((sum, bet) => sum + bet.amount, 0);
  if (!Number.isFinite(totalBet) || totalBet <= 0) throw new Error("Invalid bets");

  const newBalance = User.updateBalance(userId, -totalBet, "Roulette bet placed");

  try {
    const number = RNG.spinRoulette(); // 0..36 European

    let totalPayout = 0;

    const betResults = cleanedBets.map((bet) => {
      const won = checkRouletteBet(number, bet.type, bet.value);
      const payoutMultProfit = getRoulettePayout(bet.type); // profit multiplier
      const payout = won ? bet.amount * (payoutMultProfit + 1) : 0;

      totalPayout += payout;

      return {
        ...bet,
        won,
        payout,
        payoutMultProfit,
      };
    });

    if (totalPayout > 0) {
      User.updateBalance(userId, totalPayout, "Roulette win payout");
    }

    Round.create({
      userId,
      gameId: game.id,
      betAmount: totalBet,
      payoutAmount: totalPayout,
      multiplier: totalBet > 0 ? formatNumber(totalPayout / totalBet, 8) : 0,
      outcome: { number, bets: betResults },
      gameState: { seed: RNG.generateSeed() },
    });

    return {
      success: true,
      result: {
        number,
        bets: betResults,
        totalPayout,
        balance: newBalance + totalPayout,
      },
    };
  } catch (error) {
    User.updateBalance(userId, totalBet, "Roulette bet refunded due to error");
    throw error;
  }
}

    // =======================
// =======================
// Blackjack (hit/stand/double/split)
// Rules:
// - Dealer hits <=16 (S17)
// - Natural blackjack pays 3:2 (return = bet*2.5), push returns bet
// - Double: only on 2-card active hand, draw 1 then auto-stand
// - Split: only on 2-card active hand with equal rank; creates 2 hands
// - Split Aces: draw one card each, then auto-stand both (standard)
// =======================

// -----------------------------
// Blackjack card normalization
// RNG.generateDeck() returns: { suit, value }
// Frontend expects: { suit, r } or { suit, rank }.
// helpers below ensure consistent shape in game_state + responses.
// -----------------------------


// -----------------------------
// NEW: dealer "luck" tuning (keeps dealer rules intact)
// We nudge the deck so the dealer's *next possible hit card* is
// more likely to be low-value.
// -----------------------------


static async blackjackAction(roundId, action, handIndex = 0) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  // ✅ FIX: Guard against acting on finished rounds
  const gs = round.game_state;
  if (!gs || gs.status !== "player_turn") {
    throw new Error("Round is not active");
  }

  const userId = round.user_id;

  if (!["hit", "stand", "double", "split"].includes(action)) {
    throw new Error("Invalid action");
  }

  if (action === "hit") return GameEngine.blackjackHit(userId, roundId, handIndex);
  if (action === "stand") return GameEngine.blackjackStand(userId, roundId, handIndex);
  if (action === "double") return GameEngine.blackjackDouble(userId, roundId, handIndex);
  return GameEngine.blackjackSplit(userId, roundId, handIndex);
}

static async processBlackjack(userId, betAmount) {
  const game = Game.findByName("blackjack");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  // charge base bet
  const balanceAfterBet = User.updateBalance(userId, -bet, "Blackjack bet placed");

  try {
    const deck = RNG.generateDeck().map(normalizeCard);

    // ✅ NEW: nudge the dealer's *next possible hit card* to be worse sometimes.
    // This keeps the dealer rules intact (still must hit to 16, stand at 17),
    // but makes dealer "luck" lower over many rounds.
    //
    // Tuning:
    // - 0.25 subtle
    // - 0.35 noticeable
    // - 0.50 strong
    if (RNG.randomFloat() < 0.35) {
      // after initial deal, the next undealt index is 4
      worsenNextDealerHitCard(deck, 4, 24);
      // optional: nudge the *second* possible dealer hit as well (stronger)
      // worsenNextDealerHitCard(deck, 5, 24);
    }

    const playerHand = [deck[0], deck[2]];
    const dealerHand = [deck[1], deck[3]];
    let deckIndex = 4;

    const playerTotal = calculateHandTotal(playerHand);
    const dealerTotal = calculateHandTotal(dealerHand);
    const dealerShownTotal = calculateHandTotal([dealerHand[0]]);

    const gameState = {
      userId,
      deck,
      deckIndex,
      dealerHand,
      baseBet: bet,
      status: "player_turn", // player_turn | finished
      activeHandIndex: 0,
      hands: [
        {
          hand: playerHand,
          bet,
          doubled: false,
          finished: false,
          outcome: null, // win|lose|push|null
          payout: 0, // credited return (includes stake)
          isSplitAce: false,
        },
      ],
      seed: RNG.generateSeed(),
    };

    const playerBJ = isBlackjack(playerHand);
    const dealerBJ = isBlackjack(dealerHand);

    if (playerBJ || dealerBJ) {
      gameState.status = "finished";

      let payoutAmount = 0;
      let outcome = "push";

      if (playerBJ && !dealerBJ) {
        payoutAmount = bet * 2.5; // return incl stake
        outcome = "win_blackjack";
      } else if (!playerBJ && dealerBJ) {
        payoutAmount = 0;
        outcome = "lose";
      } else {
        payoutAmount = bet; // push
        outcome = "push";
      }

      let newBalance = balanceAfterBet;
      if (payoutAmount > 0) {
        newBalance = User.updateBalance(userId, payoutAmount, "Blackjack payout");
      }

      gameState.hands[0] = {
        ...gameState.hands[0],
        finished: true,
        outcome: outcome === "lose" ? "lose" : outcome === "push" ? "push" : "win",
        payout: payoutAmount,
      };

      const round = Round.create({
        userId,
        gameId: game.id,
        betAmount: bet,
        payoutAmount,
        multiplier: bet > 0 ? formatNumber(payoutAmount / bet, 8) : 0,
        outcome: { status: "finished", playerBJ, dealerBJ, outcome },
        gameState,
      });

      return {
        success: true,
        round,
        gameState: {
          roundId: round.id,
          status: "finished",
          activeHandIndex: 0,
          playerHands: [normalizeHand(playerHand)],
          dealerHand: normalizeHand(dealerHand),
          handTotals: [playerTotal],
          handBets: [bet],
          handOutcomes: [gameState.hands[0].outcome],
          payout: payoutAmount,
          balance: newBalance,
          dealerTotal,
          dealerShownTotal: dealerTotal,
        },
      };
    }

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "in_progress" },
      gameState,
    });

    return {
      success: true,
      round,
      gameState: {
        roundId: round.id,
        status: "player_turn",
        activeHandIndex: 0,
        playerHands: [normalizeHand(playerHand)],
        dealerHand: [normalizeCard(dealerHand[0]), { hidden: true }],
        handTotals: [playerTotal],
        handBets: [bet],
        handOutcomes: [null],
        payout: 0,
        balance: balanceAfterBet,
        dealerTotal,
        dealerShownTotal,
        balanceAfterBet,
      },
    };
  } catch (error) {
    User.updateBalance(userId, bet, "Blackjack bet refunded due to error");
    throw error;
  }
}
static async blackjackHit(userId, roundId, handIndex = 0) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");
  if (round.user_id !== userId) throw new Error("Unauthorized");

  const gs = round.game_state;
  if (!gs || gs.status !== "player_turn") throw new Error("Round is not active");

  const idx = Number(handIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= gs.hands.length) throw new Error("Invalid hand index");
  if (idx !== gs.activeHandIndex) throw new Error("Not your active hand");

  const deck = gs.deck;
  let deckIndex = gs.deckIndex ?? 0;

  const hands = [...gs.hands];
  const h = { ...hands[idx], hand: [...hands[idx].hand] };

  if (h.finished) throw new Error("Hand already finished");
  if (h.isSplitAce && h.hand.length >= 2) throw new Error("Cannot hit split aces");

  const card = deck[deckIndex++];
  if (!card) throw new Error("Deck exhausted");
  h.hand.push(normalizeCard(card));

  const total = calculateHandTotal(h.hand);

  if (total > 21) {
    h.finished = true;
    h.outcome = "lose";
    h.payout = 0;
    hands[idx] = h;

    // ✅ FIX: Check if other split hands still need playing
    const nextUnfinished = hands.findIndex((hand, i) => i !== idx && !hand.finished);

    if (nextUnfinished !== -1) {
      // Other hands still active — don't end the round yet
      const nextState = { ...gs, deckIndex, hands, activeHandIndex: nextUnfinished };
      Round.updateGameState(roundId, nextState);
      return GameEngine._bjSerialize(roundId, nextState, userId);
    }

    // ✅ FIX: All hands done — check if ALL hands busted
    const allBusted = hands.every((hand) => {
      const t = calculateHandTotal(hand.hand || []);
      return t > 21;
    });

    if (allBusted) {
      // All hands busted — no dealer play needed, finish immediately
      const nextState = {
        ...gs,
        deckIndex,
        hands,
        status: "finished",
        finishReason: "player_bust",
      };

      // ✅ FIX: Create final round record so history captures the result
      const totalBet = hands.reduce((s, hand) => s + Number(hand.bet || 0), 0);
      Round.create({
        userId,
        gameId: round.game_id,
        betAmount: totalBet,
        payoutAmount: 0,
        multiplier: 0,
        outcome: {
          status: "finished",
          dealerTotal: calculateHandTotal(gs.dealerHand || []),
          hands: hands.map((hand) => ({
            bet: hand.bet,
            total: calculateHandTotal(hand.hand || []),
            outcome: hand.outcome,
            payout: hand.payout,
            doubled: hand.doubled,
            isSplitAce: hand.isSplitAce,
          })),
        },
        gameState: nextState,
      });

      Round.updateGameState(roundId, nextState);
      return GameEngine._bjSerialize(roundId, nextState, userId);
    }

    // ✅ FIX: Not all busted — go through normal _bjAdvance (dealer plays)
    let nextState = { ...gs, deckIndex, hands };
    nextState = GameEngine._bjAdvance(nextState, userId, round.game_id, roundId);
    Round.updateGameState(roundId, nextState);
    return GameEngine._bjSerialize(roundId, nextState, userId);
  }

  // split aces: auto-finish after one draw
  if (h.isSplitAce) h.finished = true;

  hands[idx] = h;

  let nextState = { ...gs, deckIndex, hands };
  nextState = GameEngine._bjAdvance(nextState, userId, round.game_id, roundId);

  Round.updateGameState(roundId, nextState);
  return GameEngine._bjSerialize(roundId, nextState, userId);
}

static async blackjackStand(userId, roundId, handIndex = 0) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");
  if (round.user_id !== userId) throw new Error("Unauthorized");

  const gs = round.game_state;
  if (!gs || gs.status !== "player_turn") throw new Error("Round is not active");

  const idx = Number(handIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= gs.hands.length) throw new Error("Invalid hand index");
  if (idx !== gs.activeHandIndex) throw new Error("Not your active hand");

  const hands = [...gs.hands];
  const h = { ...hands[idx] };

  if (h.finished) throw new Error("Hand already finished");

  h.finished = true;
  hands[idx] = h;

  let nextState = { ...gs, hands };
  nextState = GameEngine._bjAdvance(nextState, userId, round.game_id, roundId);

  Round.updateGameState(roundId, nextState);

  return GameEngine._bjSerialize(roundId, nextState, userId);
}

static async blackjackDouble(userId, roundId, handIndex = 0) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");
  if (round.user_id !== userId) throw new Error("Unauthorized");

  const gs = round.game_state;
  if (!gs || gs.status !== "player_turn") throw new Error("Round is not active");

  const idx = Number(handIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= gs.hands.length) throw new Error("Invalid hand index");
  if (idx !== gs.activeHandIndex) throw new Error("Not your active hand");

  const deck = gs.deck;
  let deckIndex = gs.deckIndex ?? 0;

  const hands = [...gs.hands];
  const h = { ...hands[idx], hand: [...hands[idx].hand] };

  if (h.finished) throw new Error("Hand already finished");
  if (h.isSplitAce) throw new Error("Cannot double split aces");
  if (!isTwoCardHand(h.hand)) throw new Error("Double only allowed on first two cards");
  if (h.doubled) throw new Error("Already doubled");

  const extra = Number(gs.baseBet);
  if (!Number.isFinite(extra) || extra <= 0) throw new Error("Invalid bet");

  // charge extra bet
  User.updateBalance(userId, -extra, "Blackjack double bet");

  h.bet = Number(h.bet) + extra;
  h.doubled = true;

  // deal 1 card and auto-stand
  const card = deck[deckIndex++];
  if (!card) throw new Error("Deck exhausted");
  h.hand.push(normalizeCard(card));

  const total = calculateHandTotal(h.hand);
  if (total > 21) {
    h.finished = true;
    h.outcome = "lose";
    h.payout = 0;
  } else {
    h.finished = true;
  }

  hands[idx] = h;

  let nextState = { ...gs, deckIndex, hands };
  nextState = GameEngine._bjAdvance(nextState, userId, round.game_id, roundId);

  Round.updateGameState(roundId, nextState);

  return GameEngine._bjSerialize(roundId, nextState, userId);
}

static async blackjackSplit(userId, roundId, handIndex = 0) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");
  if (round.user_id !== userId) throw new Error("Unauthorized");

  const gs = round.game_state;
  if (!gs || gs.status !== "player_turn") throw new Error("Round is not active");

  const idx = Number(handIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= gs.hands.length) throw new Error("Invalid hand index");
  if (idx !== gs.activeHandIndex) throw new Error("Not your active hand");

  const hands = [...gs.hands];
  const current = hands[idx];

  if (!current || !Array.isArray(current.hand)) throw new Error("Invalid hand");
  if (!isTwoCardHand(current.hand)) throw new Error("Split only allowed on first two cards");
  if (!canSplitHand(current.hand)) throw new Error("Cards are not splittable");

  // optional: limit to 4 hands
  if (hands.length >= 4) throw new Error("Max split hands reached");

  const baseBet = Number(gs.baseBet);
  if (!Number.isFinite(baseBet) || baseBet <= 0) throw new Error("Invalid bet");

  // charge extra bet
  User.updateBalance(userId, -baseBet, "Blackjack split bet");

  const deck = gs.deck;
  let deckIndex = gs.deckIndex ?? 0;

  const [c0, c1] = current.hand;
  const isAceSplit = bjRank(c0) === "A";

  const h0 = {
    hand: [c0],
    bet: baseBet,
    doubled: false,
    finished: false,
    outcome: null,
    payout: 0,
    isSplitAce: isAceSplit,
  };
  const h1 = {
    hand: [c1],
    bet: baseBet,
    doubled: false,
    finished: false,
    outcome: null,
    payout: 0,
    isSplitAce: isAceSplit,
  };

  const draw0 = deck[deckIndex++];
  const draw1 = deck[deckIndex++];
  if (!draw0 || !draw1) throw new Error("Deck exhausted");

  h0.hand.push(normalizeCard(draw0));
  h1.hand.push(normalizeCard(draw1));

  // split aces: auto-stand both
  if (isAceSplit) {
    h0.finished = true;
    h1.finished = true;
  }

  // replace current hand with h0 and insert h1 after
  hands.splice(idx, 1, h0, h1);

  let nextState = {
    ...gs,
    deckIndex,
    hands,
    activeHandIndex: idx,
    status: "player_turn",
  };

  nextState = GameEngine._bjAdvance(nextState, userId, round.game_id, roundId);

  Round.updateGameState(roundId, nextState);

  return GameEngine._bjSerialize(roundId, nextState, userId);
}

// ---- internals ----
static _bjAdvance(gs, userId, gameId, roundId) {
  // choose next unfinished hand after current
  const nextAfter = gs.hands.findIndex((h, i) => i > gs.activeHandIndex && !h.finished);
  if (nextAfter !== -1) {
    return { ...gs, activeHandIndex: nextAfter, status: "player_turn" };
  }

  // choose any unfinished
  const any = gs.hands.findIndex((h) => !h.finished);
  if (any !== -1) {
    return { ...gs, activeHandIndex: any, status: "player_turn" };
  }

  // all done => dealer plays and settle
  const afterDealer = GameEngine._bjDealerPlay(gs);
  const settled = GameEngine._bjSettle(afterDealer, userId);

  const totalBet = settled.hands.reduce((s, h) => s + Number(h.bet || 0), 0);
  const totalPayout = settled.hands.reduce((s, h) => s + Number(h.payout || 0), 0);
  const mult = totalBet > 0 ? formatNumber(totalPayout / totalBet, 8) : 0;

  // ✅ FIX: Update original round so it's marked finished (prevents re-action)
  if (roundId) {
    Round.updateGameState(roundId, { ...settled, status: "finished" });
    Round.updatePayout(roundId, totalPayout, mult, {
      status: "finished",
      dealerTotal: calculateHandTotal(settled.dealerHand || []),
      hands: settled.hands.map((h) => ({
        bet: h.bet,
        total: calculateHandTotal(h.hand || []),
        outcome: h.outcome,
        payout: h.payout,
        doubled: h.doubled,
        isSplitAce: h.isSplitAce,
      })),
    });
  }

  // History record
  Round.create({
    userId,
    gameId,
    betAmount: totalBet,
    payoutAmount: totalPayout,
    multiplier: mult,
    outcome: {
      status: "finished",
      dealerTotal: calculateHandTotal(settled.dealerHand || []),
      hands: settled.hands.map((h) => ({
        bet: h.bet,
        total: calculateHandTotal(h.hand || []),
        outcome: h.outcome,
        payout: h.payout,
        doubled: h.doubled,
        isSplitAce: h.isSplitAce,
      })),
    },
    gameState: { ...settled, status: "finished" },
  });

  return { ...settled, status: "finished" };
}

static _bjDealerPlay(gs) {
  const deck = gs.deck;
  let deckIndex = gs.deckIndex ?? 0;
  let dealerHand = [...(gs.dealerHand || [])];

  let dealerTotal = calculateHandTotal(dealerHand);
  while (dealerTotal <= 16) {
    const c = deck[deckIndex++];
    if (!c) break;
    dealerHand.push(normalizeCard(c));
    dealerTotal = calculateHandTotal(dealerHand);
  }

  return { ...gs, deckIndex, dealerHand };
}

static _bjSettle(gs, userId) {
  const dealerTotal = calculateHandTotal(gs.dealerHand || []);

  const hands = gs.hands.map((h) => {
    const total = calculateHandTotal(h.hand || []);

    if (total > 21) {
      return { ...h, finished: true, outcome: "lose", payout: 0 };
    }

    let outcome = "push";
    let payout = Number(h.bet); // push returns bet

    if (dealerTotal > 21) {
      outcome = "win";
      payout = Number(h.bet) * 2;
    } else if (total > dealerTotal) {
      outcome = "win";
      payout = Number(h.bet) * 2;
    } else if (total < dealerTotal) {
      outcome = "lose";
      payout = 0;
    }

    return { ...h, finished: true, outcome, payout };
  });

  const totalPayout = hands.reduce((s, h) => s + Number(h.payout || 0), 0);
  if (totalPayout > 0) {
    User.updateBalance(userId, totalPayout, "Blackjack payout");
  }

  return { ...gs, hands };
}
static _bjSerialize(roundId, gs, userId) {
  const status = gs.status === "finished" ? "finished" : "player_turn";

  const playerHands = gs.hands.map((h) => normalizeHand(h.hand));
  const handTotals = gs.hands.map((h) => calculateHandTotal(h.hand || []));
  const handBets = gs.hands.map((h) => Number(h.bet || 0));
  const handOutcomes = gs.hands.map((h) => (h.outcome ?? null));

  const dealerTotal = calculateHandTotal(gs.dealerHand || []);

  const isPlayerBust = gs.finishReason === "player_bust";

  const dealerShownTotal =
    status === "finished" && !isPlayerBust
      ? dealerTotal
      : calculateHandTotal([gs.dealerHand?.[0]].filter(Boolean));

  const dealerHandUi =
    status === "finished" && !isPlayerBust
      ? normalizeHand(gs.dealerHand)
      : [normalizeCard(gs.dealerHand?.[0]), { hidden: true }].filter(Boolean);

  const payout =
    status === "finished"
      ? gs.hands.reduce((s, h) => s + Number(h.payout || 0), 0)
      : 0;

  // ✅ FIX: User.getBalance does not exist — use User.findById instead
  const userRow = User.findById(userId);
  const balance = userRow ? userRow.balance : undefined;

  return {
    success: true,
    gameState: {
      roundId,
      status,
      activeHandIndex: gs.activeHandIndex ?? 0,
      playerHands,
      dealerHand: dealerHandUi,
      handTotals,
      handBets,
      handOutcomes,
      payout,
      dealerTotal,
      dealerShownTotal,
      ...(typeof balance === "number" ? { balance } : {}),
    },
  };
}


    // =======================
  // Dragon Tower (Stake-like custom rules)
  // Board: 9 rows x 4 columns
  // Difficulties:
  // - easy  : 3 safe, 1 fire  (p = 3/4)
  // - medium: 2 safe, 2 fire  (p = 2/4)
  // - hard  : 1 safe, 3 fire  (p = 1/4)
  // Rules:
  // - pick 1 tile per row
  // - correct => advance row, multiplier increases
  // - cashout allowed after at least 1 correct pick
  // - lose => lose full bet; reveal ONLY safe tiles across all rows
  // House edge: 2% (RTP 98%)
  // =======================

// =======================
// Dragon Tower (Stake-like custom rules)
// Board: 9 rows x columns depend on difficulty
// Difficulties:
// - easy  : 4 columns, 3 safe (p = 3/4)
// - medium: 3 columns, 2 safe (p = 2/3)
// - hard  : 2 columns, 1 safe (p = 1/2)
// Rules:
// - pick 1 tile per row
// - correct => advance row, multiplier increases
// - cashout allowed after at least 1 correct pick
// - lose => lose full bet; reveal ONLY safe tiles across all rows
// House edge: 2% (RTP 98%)
// =======================

static async processTowerStart(userId, betAmount, difficulty = "easy") {
  const game = Game.findByName("tower");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  const diff = String(difficulty || "easy").toLowerCase();
  if (!["easy", "medium", "hard"].includes(diff)) throw new Error("Invalid difficulty");

  const rows = 9;

  const columnsByDifficulty = {
    easy: 4,
    medium: 3, // remove 1 tile
    hard: 2,   // remove 2 tiles
  };

  const columns = columnsByDifficulty[diff];
  if (!Number.isInteger(columns) || columns < 2) throw new Error("Invalid difficulty");

  // how many safe tiles per row (keep same idea: safeCount = columns - 1)
  const safeCountByDifficulty = {
    easy: 3,   // out of 4
    medium: 2, // out of 3
    hard: 1,   // out of 2
  };

  const safeCount = safeCountByDifficulty[diff];
  if (!Number.isInteger(safeCount) || safeCount < 1 || safeCount >= columns) {
    throw new Error("Invalid safeCount config");
  }

  // Lock credits (balance AFTER subtracting bet)
  const balanceAfterBet = User.updateBalance(userId, -bet, "Tower bet placed");

  try {
    // For each row, generate a set of safe indices (length = safeCount)
    // Store as array of arrays, e.g. safeMap[row] = [0,2,3] (for 4 columns)
    const safeMap = Array.from({ length: rows }, () => {
      const indices = Array.from({ length: columns }, (_, i) => i);

      // shuffle
      for (let i = indices.length - 1; i > 0; i--) {
        const j = RNG.randomInt(0, i);
        const tmp = indices[i];
        indices[i] = indices[j];
        indices[j] = tmp;
      }

      return indices.slice(0, safeCount).sort((a, b) => a - b);
    });

    const gameState = {
      seed: RNG.generateSeed(),
      difficulty: diff,
      rows,
      columns,
      safeCount,
      safeMap, // SECRET until loss (then we reveal only this)
      currentRow: 0,
      revealed: [], // [{ row, tileIndex, safe }]
      currentMultiplier: 1.0,
      status: "in_progress", // in_progress | lost | cashed_out
    };

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "in_progress" },
      gameState,
    });

    return {
      success: true,
      round,
      gameState: {
        roundId: round.id,
        difficulty: diff,
        rows,
        columns,
        safeCount,
        currentRow: 0,
        revealed: [],
        currentMultiplier: 1.0,
        balanceAfterBet,
      },
    };
  } catch (error) {
    User.updateBalance(userId, bet, "Tower bet refunded due to error");
    throw error;
  }
}

static async towerPick(roundId, tileIndex) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const gs = round.game_state;
  if (!gs || gs.status !== "in_progress") throw new Error("Round is not active");

  const col = Number(tileIndex);
  if (!Number.isInteger(col) || col < 0 || col >= gs.columns) {
    throw new Error("Invalid tileIndex");
  }

  const row = Number(gs.currentRow);
  if (!Number.isInteger(row) || row < 0 || row >= gs.rows) {
    throw new Error("Already completed");
  }

  if (Array.isArray(gs.revealed) && gs.revealed.some((r) => r.row === row)) {
    throw new Error("Row already picked");
  }

  // Determine if picked tile is safe
  const safeRow = gs.safeMap?.[row] || [];
  const safe = safeRow.includes(col);

  if (!Array.isArray(gs.revealed)) gs.revealed = [];
  gs.revealed.push({ row, tileIndex: col, safe });

  // LOSS
  if (!safe) {
    gs.status = "lost";
    gs.currentMultiplier = 0;

    // ✅ FIX: Update original round state AND payout (closes it)
    Round.updateGameState(roundId, gs);
    Round.updatePayout(roundId, 0, 0, {
      status: "lost",
      row,
      tileIndex: col,
    });

    // History record
    Round.create({
      userId: round.user_id,
      gameId: round.game_id,
      betAmount: round.bet_amount,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "lost", row, tileIndex: col },
      gameState: gs,
    });

    return {
      success: true,
      result: {
        status: "lost",
        row,
        tileIndex: col,
        safe: false,
        payout: 0,
        reveal: {
          safeMap: gs.safeMap,
        },
      },
      gameState: {
        roundId,
        status: "lost",
        currentRow: row,
        revealed: gs.revealed,
        currentMultiplier: 0,
      },
    };
  }

  // SAFE => update multiplier and advance
  const stepsCleared = row + 1;

  const houseEdge = 0.02;
  const p = Number(gs.safeCount) / Number(gs.columns);
  const mult = (1 - houseEdge) / Math.pow(p, stepsCleared);

  gs.currentMultiplier = formatNumber(mult, 8);
  gs.currentRow = row + 1;

  // auto cashout if completed all rows
  if (gs.currentRow >= gs.rows) {
    const payoutAmount = round.bet_amount * Number(gs.currentMultiplier);

    // ✅ FIX: Mark original round as finished BEFORE crediting
    gs.status = "cashed_out";
    Round.updateGameState(roundId, gs);
    Round.updatePayout(roundId, payoutAmount, gs.currentMultiplier, {
      status: "cashed_out",
      stepsCleared,
      completed: true,
    });

    const newBalance = User.updateBalance(round.user_id, payoutAmount, "Tower auto cashout");

    // History record
    Round.create({
      userId: round.user_id,
      gameId: round.game_id,
      betAmount: round.bet_amount,
      payoutAmount,
      multiplier: gs.currentMultiplier,
      outcome: { status: "cashed_out", stepsCleared, completed: true },
      gameState: gs,
    });

    return {
      success: true,
      result: {
        status: "cashed_out",
        row,
        tileIndex: col,
        safe: true,
        payout: payoutAmount,
        multiplier: Number(gs.currentMultiplier),
        balance: newBalance,
        completed: true,
      },
      gameState: {
        roundId,
        status: "cashed_out",
        currentRow: gs.currentRow,
        revealed: gs.revealed,
        currentMultiplier: gs.currentMultiplier,
      },
    };
  }

  Round.updateGameState(roundId, gs);

  return {
    success: true,
    result: {
      status: "in_progress",
      row,
      tileIndex: col,
      safe: true,
      currentMultiplier: gs.currentMultiplier,
      nextRow: gs.currentRow,
    },
    gameState: {
      roundId,
      status: "in_progress",
      currentRow: gs.currentRow,
      revealed: gs.revealed,
      currentMultiplier: gs.currentMultiplier,
    },
  };
}

static async towerCashout(roundId) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const gs = round.game_state;
  if (!gs || gs.status !== "in_progress") throw new Error("Round is not active");

  const safeCount = Array.isArray(gs.revealed) ? gs.revealed.filter((r) => r.safe).length : 0;
  if (safeCount < 1) throw new Error("Make at least one safe pick before cashout");

  const multiplier = Number(gs.currentMultiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("Invalid multiplier");

  const payoutAmount = round.bet_amount * multiplier;

  // ✅ FIX: Mark original round as finished BEFORE crediting (prevents double-cashout)
  gs.status = "cashed_out";
  Round.updateGameState(roundId, gs);
  Round.updatePayout(roundId, payoutAmount, multiplier, {
    status: "cashed_out",
    stepsCleared: safeCount,
  });

  const newBalance = User.updateBalance(round.user_id, payoutAmount, "Tower cashout");

  // History record
  Round.create({
    userId: round.user_id,
    gameId: round.game_id,
    betAmount: round.bet_amount,
    payoutAmount,
    multiplier,
    outcome: { status: "cashed_out", stepsCleared: safeCount },
    gameState: gs,
  });

  return {
    success: true,
    result: {
      status: "cashed_out",
      payout: payoutAmount,
      multiplier,
      balance: newBalance,
    },
    gameState: {
      roundId,
      status: "cashed_out",
      currentRow: gs.currentRow,
      revealed: gs.revealed,
      currentMultiplier: gs.currentMultiplier,
    },
  };
}

// =======================
// Russian Roulette v2 (multi-phase) — TOP decides
// Rules:
// - bet1 amount = x
//   if landedOnUser => payout1 = 2x (credited immediately in start)
// - optional bet2 amount = y (only if landedOnUser AND bullets < 6)
//   if wasShot => payout2 = 2y (credited on resolve)
// - bullets progression is per-user: 1..6 repeating across bets
// - cylinder is generated once per bet (start) and never reshuffled (no teleport)
// - resolve allowed exactly once per round
// =======================

// ---- bullets progression helpers ----
static _rrBulletsForAttempt(attemptIndex) {
  const idx = Number(attemptIndex) || 0;
  const step = ((idx % 6) + 6) % 6; // 0..5
  return step + 1; // 1..6
}

static _rrCreateCylinderFromBullets(bullets) {
  const b = Math.max(0, Math.min(6, Number(bullets) || 0));
  const blanks = 6 - b;
  const chambers = [
    ...Array.from({ length: b }, () => "bullet"),
    ...Array.from({ length: blanks }, () => "blank"),
  ];
  return RNG.shuffle(chambers);
}

// ---- Persistent per-user attempt index (SQLite) ----
static _rrEnsureUserColumn() {
  try {
    const { db } = require("../config/database");
    const cols = db.prepare(`PRAGMA table_info(users)`).all();
    const exists = cols.some((c) => c.name === "rr_attempt_index");
    if (!exists) {
      db.exec(`ALTER TABLE users ADD COLUMN rr_attempt_index INTEGER NOT NULL DEFAULT 0`);
      console.log("✅ Added users.rr_attempt_index");
    }
  } catch {}
}

static _rrGetUserAttemptIndex(userId) {
  GameEngine._rrEnsureUserColumn();
  const { db } = require("../config/database");
  const row = db.prepare(`SELECT rr_attempt_index FROM users WHERE id = ?`).get(userId);
  if (!row) throw new Error("User not found");
  const idx = Number(row.rr_attempt_index) || 0;
  return ((idx % 6) + 6) % 6; // 0..5
}

static _rrAdvanceUserAttemptIndex(userId) {
  GameEngine._rrEnsureUserColumn();
  const { db } = require("../config/database");
  const current = GameEngine._rrGetUserAttemptIndex(userId);
  const next = (current + 1) % 6;
  db.prepare(`UPDATE users SET rr_attempt_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    next,
    userId
  );
  return next;
}

/**
 * Phase 1: Bet that gun lands on user (userIndex=2 of 0..4)
 * - subtract x
 * - if landedOnUser => credit payout1=2x immediately
 * - create bullets/cylinder snapshot for this bet
 */
static async processRussianRouletteStart(userId, betAmount) {
  const game = Game.findByName("russian_roulette");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const x = Number(betAmount);
  if (!Number.isFinite(x) || x <= 0) throw new Error("Invalid bet amount");

  const players = 5;
  const userIndex = 2;

  const attemptIndex = GameEngine._rrGetUserAttemptIndex(userId); // 0..5 persistent
  const bullets = GameEngine._rrBulletsForAttempt(attemptIndex);  // 1..6
  const blanks = 6 - bullets;

  const cylinder = GameEngine._rrCreateCylinderFromBullets(bullets);

  // take bet1
  const balanceAfterBet = User.updateBalance(userId, -x, "RR bet1 placed (land on me)");

  try {
    const selectedPlayerIndex = RNG.randomInt(0, players - 1);
    const landedOnUser = selectedPlayerIndex === userIndex;

    const payout1 = landedOnUser ? 2 * x : 0;

    let finalBalance = balanceAfterBet;
    if (payout1 > 0) {
      finalBalance = User.updateBalance(userId, payout1, "RR bet1 payout (2x landed on user)");
    }

    const canPlaceBet2 = landedOnUser && bullets < 6;

    const gameState = {
      version: 2,
      phase: "awaiting_shot_bet",
      players,
      userIndex,
      selectedPlayerIndex,

      attemptIndex,
      bullets,
      blanks,
      cylinder,

      alive: [true, true, true, true, true],

      bet1: { amount: x, landedOnUser, payout: payout1 },
      bet2: null,
      lastShot: null,

      rules: {
        bet1_multiplier: 2,
        bet2_multiplier: 2,
        bet2_disabled_when_bullets_gte: 6,
      },
    };

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: x,
      payoutAmount: payout1,
      multiplier: x > 0 ? formatNumber(payout1 / x, 8) : 0,
      outcome: { status: "phase1_complete", selectedPlayerIndex, landedOnUser },
      gameState,
    });

    return {
      success: true,
      round,
      result: {
        phase: "phase1_complete",
        selectedPlayerIndex,
        landedOnUser,
        bullets,
        blanks,
        cylinder,
        payout1,
        canPlaceBet2,
        autoResolveRecommended: !landedOnUser || bullets >= 6,
        balance: finalBalance,
        players,
        userIndex,
      },
      gameState: {
        roundId: round.id,
        phase: gameState.phase,
        selectedPlayerIndex,
        userIndex,
        attemptIndex,
        bullets,
        blanks,
        cylinder,
        alive: gameState.alive,
        landedOnUser,
        canPlaceBet2,
        balance: finalBalance,
      },
    };
  } catch (error) {
    User.updateBalance(userId, x, "RR bet1 refunded due to error");
    throw error;
  }
}

/**
 * Phase 2: place bet2 (optional)
 * - only if landed on user
 * - disabled at 6 bullets
 */
static async processRussianRoulettePlaceShotBet(roundId, betAmount) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const game = Game.findByName("russian_roulette");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const gs = round.game_state;
  if (!gs || gs.version !== 2) throw new Error("Invalid game state");
  if (gs.phase !== "awaiting_shot_bet") throw new Error("Not in shot bet phase");

  const y = Number(betAmount);
  if (!Number.isFinite(y) || y <= 0) throw new Error("Invalid bet amount");

  const userIndex = gs.userIndex ?? 2;
  if (gs.selectedPlayerIndex !== userIndex) {
    throw new Error("Shot bet only allowed when gun lands on you");
  }

  const bullets = Number(gs.bullets) || 1;
  if (bullets >= 6) {
    throw new Error("Shot bet is disabled when there are 6 bullets");
  }

  const balanceAfterBet2 = User.updateBalance(round.user_id, -y, "RR bet2 placed (will I be shot)");

  gs.bet2 = { amount: y, payout: 0, won: null };
  gs.phase = "bet2_placed";

  Round.updateGameState(roundId, gs);

  return {
    success: true,
    result: {
      phase: "bet2_placed",
      bullets,
      bet2: { amount: y, multiplier: 2 },
      balanceAfterBet2,
    },
    gameState: {
      roundId,
      phase: gs.phase,
      bullets,
      selectedPlayerIndex: gs.selectedPlayerIndex,
      userIndex,
      alive: gs.alive,
      cylinder: gs.cylinder,
    },
  };
}

/**
 * Resolve shot (single-use):
 * - TOP decides (topIndex)
 * - shot only if cylinder[topIndex] === "bullet"
 * - bet2 pays 2y only if shot and bet2 exists
 * - advance user bullets progression for NEXT bet
 */
static async processRussianRouletteResolveShot(roundId) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const game = Game.findByName("russian_roulette");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const gs = round.game_state;
  if (!gs || gs.version !== 2) throw new Error("Invalid game state");

  if (!["awaiting_shot_bet", "bet2_placed"].includes(gs.phase)) {
    throw new Error("Shot already resolved or round not ready");
  }

  // lock single resolve
  gs.phase = "resolving_shot";

  const x = Number(gs.bet1?.amount) || 0;
  const payout1 = Number(gs.bet1?.payout) || Number(round.payout_amount || 0);

  const bet2Placed = !!(gs.bet2 && Number(gs.bet2.amount) > 0);
  const y = bet2Placed ? Number(gs.bet2.amount) : 0;

  const bullets = Number(gs.bullets) || 1;
  const blanks = 6 - bullets;

  const cylinder =
    Array.isArray(gs.cylinder) && gs.cylinder.length === 6
      ? gs.cylinder
      : GameEngine._rrCreateCylinderFromBullets(bullets);

  const rotationIndex = RNG.randomInt(0, 5);
  const topIndex = rotationIndex;
  const top = cylinder[topIndex];

  const wasShot = top === "bullet";
  const target = Number(gs.selectedPlayerIndex);

  if (!Array.isArray(gs.alive)) gs.alive = [true, true, true, true, true];
  if (wasShot) gs.alive[target] = false;

  let payout2 = 0;
  if (bet2Placed) {
    gs.bet2.won = wasShot;
    if (wasShot) {
      payout2 = 2 * y;
      gs.bet2.payout = payout2;
      User.updateBalance(round.user_id, payout2, "RR bet2 payout (2x shot happened)");
    } else {
      gs.bet2.payout = 0;
    }
  }

  gs.lastShot = {
    bullets,
    blanks,
    cylinder,
    rotationIndex,
    topIndex,
    top,
    wasShot,
    targetPlayerIndex: target,
  };

  const nextAttemptIndex = GameEngine._rrAdvanceUserAttemptIndex(round.user_id);
  gs.nextAttemptIndex = nextAttemptIndex;

  gs.phase = "complete";
  gs.cylinder = cylinder;

  Round.updateGameState(roundId, gs);

  const totalPayout = payout1 + payout2;
  const totalWager = x + y;
  const netProfit = totalPayout - totalWager;

  Round.updatePayout(
    roundId,
    totalPayout,
    round.bet_amount > 0 ? formatNumber(totalPayout / round.bet_amount, 8) : 0,
    {
      status: "complete",
      selectedPlayerIndex: gs.selectedPlayerIndex,
      wasShot,
      fired: top,
      bullets,
      totals: { totalWager, totalPayout, netProfit, payout1, payout2, bet2Placed },
    }
  );

  const userRow = User.findById(round.user_id);
  const balance = userRow ? userRow.balance : undefined;

  return {
    success: true,
    result: {
      phase: "shot_resolved",
      targetPlayerIndex: target,
      bullets,
      blanks,
      cylinder,
      rotationIndex,
      topIndex,
      top,
      wasShot,
      bet2Placed,
      x,
      y,
      payout1,
      payout2,
      totalWager,
      totalPayout,
      netProfit,
      balance,
      nextAttemptIndex,
    },
    gameState: {
      roundId,
      phase: gs.phase,
      bullets,
      cylinder,
      alive: gs.alive,
      lastShot: gs.lastShot,
      nextAttemptIndex,
      ...(typeof balance === "number" ? { balance } : {}),
    },
  };
}

static async processKeno(userId, betAmount, selectedNumbers, difficulty = "medium") {
  const game = Game.findByName("keno");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  const diff = String(difficulty || "medium").toLowerCase();
  if (!["easy", "medium", "high"].includes(diff)) throw new Error("Invalid difficulty");

  if (!Array.isArray(selectedNumbers)) throw new Error("selectedNumbers must be an array");

  // sanitize picks: unique ints 1..40
  const picks = Array.from(
    new Set(
      selectedNumbers
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 40)
    )
  ).sort((a, b) => a - b);

  const maxPicks = 10;
  if (picks.length < 1 || picks.length > maxPicks) {
    throw new Error(`Select between 1 and ${maxPicks} numbers`);
  }

  // Lock credits (returns balance AFTER subtracting bet)
  const balanceAfterBet = User.updateBalance(userId, -bet, "Keno bet placed");

  try {
    const drawn = RNG.generateKenoNumbers(10, 40); // 10 numbers, 1..40

    const drawnSet = new Set(drawn);
    const hitNumbers = picks.filter((n) => drawnSet.has(n));
    const hits = hitNumbers.length;

    const multiplier = getKenoMultiplier(diff, picks.length, hits);
    const payoutAmount = bet * multiplier;

    let finalBalance = balanceAfterBet;
    if (payoutAmount > 0) {
      finalBalance = User.updateBalance(userId, payoutAmount, "Keno win payout");
    }

    // Provide a payout ladder for hover UI: hits=0..picks
    const ladder = Array.from({ length: picks.length + 1 }, (_, h) => ({
      hits: h,
      multiplier: getKenoMultiplier(diff, picks.length, h),
    }));

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount,
      multiplier,
      outcome: {
        difficulty: diff,
        picks,
        drawn,
        hits,
        hitNumbers,
        won: payoutAmount > 0,
      },
      gameState: {
        seed: RNG.generateSeed(),
        difficulty: diff,
        picks,
        drawn,
        hits,
      },
    });

    return {
      success: true,
      round,
      result: {
        difficulty: diff,
        picks,
        drawn,
        hits,
        hitNumbers,
        multiplier,
        payout: payoutAmount,
        balance: finalBalance,
        ladder,
        maxPicks,
      },
    };
  } catch (error) {
    User.updateBalance(userId, bet, "Keno bet refunded due to error");
    throw error;
  }
}

// =======================
// KENO helpers (UI ladder)
// =======================
static getKenoLadder(difficulty = "medium", picks = 1) {
  const diff = String(difficulty || "medium").toLowerCase();
  if (!["easy", "medium", "high"].includes(diff)) throw new Error("Invalid difficulty");

  const p = Number(picks);
  if (!Number.isInteger(p) || p < 1 || p > 10) throw new Error("Invalid picks");

  const ladder = Array.from({ length: p + 1 }, (_, h) => ({
    hits: h,
    multiplier: getKenoMultiplier(diff, p, h),
  }));

  return {
    success: true,
    difficulty: diff,
    picks: p,
    ladder,
    maxPicks: 10,
    drawCount: 10,
    rangeMax: 40,
  };
}

static getKenoPayoutTableVersion() {
  // simple version to let frontend cache + bust when you change tables
  // change this string whenever you change payouts
  return "keno_v1_40_10";
}

// ================================================
// ADD THESE METHODS inside class GameEngine { ... }
// Place them after the getKenoPayoutTableVersion() method
// and before the closing } of the class
// ================================================

  // =======================
  // WHEEL (deterministic layout, no shuffle)
  // =======================

  static _buildBalancedWheelLayout(defs, segments) {
    // Expand pool
    const pool = [];
    for (const d of defs) {
      for (let i = 0; i < d.weight; i++) {
        pool.push({ multiplier: d.multiplier, color: d.color });
      }
    }
    if (pool.length !== segments) return pool.slice(0, segments);

    // group by multiplier
    const groups = new Map();
    for (const s of pool) {
      const key = String(s.multiplier);
      if (!groups.has(key)) groups.set(key, { multiplier: s.multiplier, color: s.color, count: 0 });
      groups.get(key).count += 1;
    }

    const entries = [...groups.values()].sort((a, b) => b.count - a.count);
    const out = Array(segments).fill(null);

    const placeType = (entry) => {
      const stride = Math.max(1, Math.floor(segments / entry.count));
      let bestStart = 0;
      let bestScore = Infinity;

      for (let start = 0; start < Math.min(segments, stride); start++) {
        let score = 0;
        for (let k = 0; k < entry.count; k++) {
          const idx = (start + k * stride) % segments;
          if (out[idx] !== null) score += 2;
          const left = out[(idx - 1 + segments) % segments];
          const right = out[(idx + 1) % segments];
          if (left && left.multiplier === entry.multiplier) score += 3;
          if (right && right.multiplier === entry.multiplier) score += 3;
        }
        if (score < bestScore) {
          bestScore = score;
          bestStart = start;
        }
      }

      for (let k = 0; k < entry.count; k++) {
        let idx = (bestStart + k * stride) % segments;

        if (out[idx] === null) {
          out[idx] = { multiplier: entry.multiplier, color: entry.color };
          continue;
        }

        let found = false;
        for (let r = 1; r < segments; r++) {
          const a = (idx + r) % segments;
          const b = (idx - r + segments) % segments;
          if (out[a] === null) {
            out[a] = { multiplier: entry.multiplier, color: entry.color };
            found = true;
            break;
          }
          if (out[b] === null) {
            out[b] = { multiplier: entry.multiplier, color: entry.color };
            found = true;
            break;
          }
        }
        if (!found) break;
      }
    };

    for (const e of entries) placeType(e);

    for (let i = 0; i < segments; i++) {
      if (out[i] == null) out[i] = { multiplier: defs[0]?.multiplier ?? 0, color: defs[0]?.color ?? "#406C82" };
    }

    const sameAdj = (arr) => {
      let c = 0;
      for (let i = 0; i < arr.length; i++) {
        const j = (i + 1) % arr.length;
        if (arr[i].multiplier === arr[j].multiplier) c++;
      }
      return c;
    };

    let best = out;
    let bestScore = sameAdj(best);

    for (let t = 0; t < 120; t++) {
      const a = (t * 7) % segments;
      const b = (t * 13 + 3) % segments;
      const cand = [...best];
      const tmp = cand[a];
      cand[a] = cand[b];
      cand[b] = tmp;
      const sc = sameAdj(cand);
      if (sc < bestScore) {
        best = cand;
        bestScore = sc;
        if (bestScore === 0) break;
      }
    }

    return best;
  }

  static _getWheelSegments(riskLevel, segmentCount) {
    const defs = getWheelDefinition(riskLevel, segmentCount);
    // ✅ deterministic order matching frontend rendering
    return GameEngine._buildBalancedWheelLayout(defs, segmentCount);
  }

  static async processWheel(userId, betAmount, riskLevel = "medium", segments = 30) {
    const game = Game.findByName("wheel");
    if (!game || !game.is_enabled) throw new Error("Game is disabled");

    const bet = Number(betAmount);
    if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

    const risk = String(riskLevel || "medium").toLowerCase();
    const segCount = Number(segments);

    const wheel = GameEngine._getWheelSegments(risk, segCount);

    const balanceAfterBet = User.updateBalance(userId, -bet, "Wheel bet placed");

    try {
      const landedIndex = RNG.randomInt(0, wheel.length - 1);
      const landed = wheel[landedIndex];

      const multiplier = Number(landed.multiplier) || 0;
      const payoutAmount = bet * multiplier;

      let finalBalance = balanceAfterBet;
      if (payoutAmount > 0) {
        finalBalance = User.updateBalance(userId, payoutAmount, "Wheel win payout");
      }

      const round = Round.create({
        userId,
        gameId: game.id,
        betAmount: bet,
        payoutAmount,
        multiplier,
        outcome: {
          riskLevel: risk,
          segments: segCount,
          landedIndex,
          multiplier,
          won: payoutAmount > 0,
        },
        gameState: {
          seed: RNG.generateSeed(),
          wheel,
          landedIndex,
          riskLevel: risk,
          segments: segCount,
        },
      });

      return {
        success: true,
        round,
        result: {
          wheel,
          landedIndex,
          multiplier,
          payout: payoutAmount,
          balance: finalBalance,
          won: payoutAmount > 0,
          riskLevel: risk,
          segments: segCount,
        },
      };
    } catch (error) {
      User.updateBalance(userId, bet, "Wheel bet refunded due to error");
      throw error;
    }
  }

static getWheelLayout(riskLevel = "medium", segments = 30) {
  const risk = String(riskLevel || "medium").toLowerCase();
  const segCount = Number(segments);
  const wheel = GameEngine._getWheelSegments(risk, segCount);
  return { success: true, riskLevel: risk, segments: segCount, wheel };
}

// =======================
// SNAKES (v2 - session/rounds payout + layout)
// =======================

static _snakesV2Config(difficulty) {
  const diff = String(difficulty || "medium").toLowerCase();

  // ✅ snake counts per your updated requirement
  const snakeCounts = {
    easy: 1,
    medium: 3,
    hard: 5,
    expert: 7,
    master: 9,
  };

  const snakeCount = snakeCounts[diff];
  if (snakeCount == null) throw new Error("Invalid difficulty");

  // ✅ multipliers: easy lowest, master highest
  // (houseEdge applied later; keep these as "display multipliers" before edge)
  const pools = {
    easy:   [1.03, 1.05, 1.07, 1.09, 1.11, 1.14, 1.18],
    medium: [1.06, 1.08, 1.11, 1.14, 1.18, 1.22, 1.28, 1.35],
    hard:   [1.10, 1.14, 1.18, 1.22, 1.28, 1.35, 1.45, 1.60],
    expert: [1.14, 1.18, 1.22, 1.28, 1.35, 1.45, 1.60, 1.80, 2.10],
    master: [1.18, 1.22, 1.28, 1.35, 1.45, 1.60, 1.80, 2.10, 2.50, 3.00, 4.00],
  };

  return {
    tiles: 12,
    snakeCount,
    houseEdge: 0.02,
    multiplierPool: pools[diff],
  };
}

static _snakesV2RollDice() {
  const d1 = Math.floor(RNG.randomFloat() * 6) + 1;
  const d2 = Math.floor(RNG.randomFloat() * 6) + 1;
  return { d1, d2, sum: d1 + d2 };
}

static _snakesV2PickFrom(arr) {
  const i = Math.floor(RNG.randomFloat() * arr.length);
  return Number(arr[i]);
}

static _snakesV2GenerateBoard(difficulty) {
  const cfg = GameEngine._snakesV2Config(difficulty);

  const board = Array.from({ length: cfg.tiles }, (_, idx) => {
    if (idx === 0) return { type: "start", multiplier: 1.0 };
    return { type: "pending" };
  });

  // positions 1..11
  const positions = [];
  for (let i = 1; i < cfg.tiles; i++) positions.push(i);

  // RNG shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(RNG.randomFloat() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  const snakes = new Set(positions.slice(0, cfg.snakeCount));

  for (let i = 1; i < cfg.tiles; i++) {
    if (snakes.has(i)) {
      board[i] = { type: "snake" };
    } else {
      const base = GameEngine._snakesV2PickFrom(cfg.multiplierPool);
      const scaled = base * (1 - cfg.houseEdge);

      // show nice 2dp like Stake
      board[i] = { type: "multiplier", multiplier: Number(scaled.toFixed(2)) };
    }
  }

  return board;
}

// Non-betting layout to show tiles before betting
static async snakesLayout(difficulty = "medium") {
  const diff = String(difficulty || "medium").toLowerCase();
  if (!["easy", "medium", "hard", "expert", "master"].includes(diff)) throw new Error("Invalid difficulty");

  const board = GameEngine._snakesV2GenerateBoard(diff);

  return {
    success: true,
    data: {
      difficulty: diff,
      tilesTotal: board.length,
      board,
    },
  };
}

static async processSnakesStart(userId, betAmount, difficulty = "medium") {
  const game = Game.findByName("snakes");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  const diff = String(difficulty || "medium").toLowerCase();
  if (!["easy", "medium", "hard", "expert", "master"].includes(diff)) throw new Error("Invalid difficulty");

  const balanceAfterBet = User.updateBalance(userId, -bet, "Snakes bet placed");

  try {
    const seed = RNG.generateSeed();
    const board = GameEngine._snakesV2GenerateBoard(diff);

    const gameState = {
      version: "snakes_v2_session",
      seed,
      difficulty: diff,
      tilesTotal: board.length,
      board,                // fully revealed
      position: 0,
      status: "in_progress",

      // session payout accounting
      rollIndex: 0,          // 0 before first roll, then 1,2,3...
      totalMultiplier: 1.0,  // still shown in UI (can be used however you want)
      totalPayoutAccrued: 0, // how much will be paid on cashout (excluding original balance before bet)
      history: [],
    };

    const round = Round.create({
      userId,
      gameId: game.id,
      betAmount: bet,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "in_progress" },
      gameState,
    });

    return {
      success: true,
      round,
      gameState: {
        roundId: round.id,
        difficulty: diff,
        tilesTotal: board.length,
        board,
        position: 0,
        rollIndex: 0,
        totalMultiplier: 1.0,
        totalPayoutAccrued: 0,
        status: "in_progress",
        balanceAfterBet,
      },
    };
  } catch (error) {
    User.updateBalance(userId, bet, "Snakes bet refunded due to error");
    throw error;
  }
}

static async snakesRoll(roundId) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const gs = round.game_state;
  if (!gs || gs.status !== "in_progress") throw new Error("Round is not active");
  if (gs.version !== "snakes_v2_session") throw new Error("Round is not compatible");

  const { d1, d2, sum } = GameEngine._snakesV2RollDice();

  const from = Number(gs.position || 0);
  const totalTiles = Number(gs.tilesTotal || 12);

  // Wrap around the board
  let to = (from + sum) % totalTiles;

  const tile = gs.board[to];
  if (!tile) throw new Error("Invalid board state");

  gs.rollIndex = Number(gs.rollIndex || 0) + 1;
  gs.position = to;

  const entry = { roll: { d1, d2, sum }, from, to, tile, rollIndex: gs.rollIndex };

  // Landing on snake - LOST
  if (tile.type === "snake") {
    gs.status = "lost";
    gs.totalMultiplier = 0;

    gs.history = Array.isArray(gs.history) ? gs.history : [];
    gs.history.push({ ...entry, totalMultiplier: 0, totalPayoutAccrued: gs.totalPayoutAccrued });

    Round.updateGameState(roundId, gs);
    Round.updatePayout(roundId, 0, 0, { status: "lost", landed: to, rollIndex: gs.rollIndex });

    Round.create({
      userId: round.user_id,
      gameId: round.game_id,
      betAmount: round.bet_amount,
      payoutAmount: 0,
      multiplier: 0,
      outcome: { status: "lost", landed: to, rollIndex: gs.rollIndex },
      gameState: gs,
    });

    return {
      success: true,
      result: { status: "lost", roll: { d1, d2, sum }, from, to, tile, payout: 0 },
      gameState: {
        roundId,
        status: "lost",
        board: gs.board,
        position: gs.position,
        rollIndex: gs.rollIndex,
        totalMultiplier: 0,
        totalPayoutAccrued: gs.totalPayoutAccrued,
        history: gs.history,
      },
    };
  }

  // Landing on multiplier or start tile
  if (tile.type === "multiplier" || tile.type === "start") {
    const m = tile.type === "start" ? 1.0 : Number(tile.multiplier);

    const prevTotal = Number(gs.totalMultiplier || 1);
    const newTotal = Number((prevTotal * m).toFixed(6));
    gs.totalMultiplier = newTotal;

    const betAmount = Number(round.bet_amount);

    if (gs.rollIndex === 1) {
      gs.totalPayoutAccrued = Number((betAmount * newTotal).toFixed(8));
    } else {
      gs.totalPayoutAccrued = Number((Number(gs.totalPayoutAccrued || 0) + betAmount * newTotal).toFixed(8));
    }

    gs.history = Array.isArray(gs.history) ? gs.history : [];
    gs.history.push({
      ...entry,
      totalMultiplier: gs.totalMultiplier,
      totalPayoutAccrued: gs.totalPayoutAccrued,
    });

    // ===== AUTO-CASHOUT AFTER 5 SUCCESSFUL ROLLS =====
    if (gs.rollIndex >= 5) {
      const payoutAmount = Number(gs.totalPayoutAccrued || 0);
      
      gs.status = "auto_cashed_out";

      Round.updateGameState(roundId, gs);
      Round.updatePayout(roundId, payoutAmount, Number(gs.totalMultiplier || 0), {
        status: "auto_cashed_out",
        position: gs.position,
        rollIndex: gs.rollIndex,
        totalPayoutAccrued: gs.totalPayoutAccrued,
      });

      const newBalance = User.updateBalance(round.user_id, payoutAmount, "Snakes auto-cashout (5 rounds)");

      Round.create({
        userId: round.user_id,
        gameId: round.game_id,
        betAmount: round.bet_amount,
        payoutAmount,
        multiplier: Number(gs.totalMultiplier || 0),
        outcome: { status: "auto_cashed_out", position: gs.position, rollIndex: gs.rollIndex },
        gameState: gs,
      });

      return {
        success: true,
        result: {
          status: "auto_cashed_out",
          roll: { d1, d2, sum },
          from,
          to,
          tile,
          totalMultiplier: gs.totalMultiplier,
          rollIndex: gs.rollIndex,
          totalPayoutAccrued: gs.totalPayoutAccrued,
          payout: payoutAmount,
          balance: newBalance,
        },
        gameState: {
          roundId,
          status: "auto_cashed_out",
          board: gs.board,
          position: gs.position,
          rollIndex: gs.rollIndex,
          totalMultiplier: Number(gs.totalMultiplier || 0),
          totalPayoutAccrued: gs.totalPayoutAccrued,
          history: gs.history,
        },
      };
    }

    // Normal roll - continue playing
    Round.updateGameState(roundId, gs);

    return {
      success: true,
      result: {
        status: "in_progress",
        roll: { d1, d2, sum },
        from,
        to,
        tile,
        totalMultiplier: gs.totalMultiplier,
        rollIndex: gs.rollIndex,
        totalPayoutAccrued: gs.totalPayoutAccrued,
      },
      gameState: {
        roundId,
        status: "in_progress",
        board: gs.board,
        position: gs.position,
        rollIndex: gs.rollIndex,
        totalMultiplier: gs.totalMultiplier,
        totalPayoutAccrued: gs.totalPayoutAccrued,
        history: gs.history,
      },
    };
  }

  throw new Error("Unknown tile type");
}

static async snakesCashout(roundId) {
  const round = Round.findById(roundId);
  if (!round) throw new Error("Round not found");

  const gs = round.game_state;
  if (!gs || gs.status !== "in_progress") throw new Error("Round is not active");
  if (gs.version !== "snakes_v2_session") throw new Error("Round is not compatible");

  const payoutAmount = Number(gs.totalPayoutAccrued || 0);
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    throw new Error("Nothing to cash out");
  }

  gs.status = "cashed_out";

  Round.updateGameState(roundId, gs);
  Round.updatePayout(roundId, payoutAmount, Number(gs.totalMultiplier || 0), {
    status: "cashed_out",
    position: gs.position,
    rollIndex: gs.rollIndex,
    totalPayoutAccrued: gs.totalPayoutAccrued,
  });

  const newBalance = User.updateBalance(round.user_id, payoutAmount, "Snakes cashout");

  Round.create({
    userId: round.user_id,
    gameId: round.game_id,
    betAmount: round.bet_amount,
    payoutAmount,
    multiplier: Number(gs.totalMultiplier || 0),
    outcome: { status: "cashed_out", position: gs.position, rollIndex: gs.rollIndex },
    gameState: gs,
  });

  return {
    success: true,
    result: { status: "cashed_out", payout: payoutAmount, multiplier: Number(gs.totalMultiplier || 0), balance: newBalance },
    gameState: {
      roundId,
      status: "cashed_out",
      board: gs.board,
      position: gs.position,
      rollIndex: gs.rollIndex,
      totalMultiplier: Number(gs.totalMultiplier || 0),
      totalPayoutAccrued: gs.totalPayoutAccrued,
      history: gs.history,
    },
  };
}

// =======================
// ROCK PAPER SCISSORS (STAKE-LIKE LADDER)
// =======================
// Session-based RPS vs house with "continue or cashout".
//
// Multipliers: 1.00x (start), 1.96x, 3.92x, 7.84x, 15.68x...
// (1.96 * 2^(step-1) for step>=1)
//
// Flow:
//  - startRPS: deduct bet and create round session
//  - chooseRPS: resolve one step; on loss ends with 0 payout; on win increases step
//  - cashoutRPS: payout bet * currentMultiplier and end round

static _rpsMultiplier(stepIndex) {
  const s = Number(stepIndex) || 0;
  if (s <= 0) return 1.0;
  return 1.96 * Math.pow(2, s - 1);
}

static _rpsPickHouseChoice() {
  const choices = ["rock", "paper", "scissors"];
  return choices[RNG.randomInt(0, 2)];
}

static _rpsResolve(player, house) {
  if (player === house) return "tie";
  const win =
    (player === "rock" && house === "scissors") ||
    (player === "paper" && house === "rock") ||
    (player === "scissors" && house === "paper");
  return win ? "win" : "lose";
}

static async startRPS(userId, betAmount) {
  const game = Game.findByName("rps");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const bet = Number(betAmount);
  if (!Number.isFinite(bet) || bet <= 0) throw new Error("Invalid bet amount");

  const balanceAfterBet = User.updateBalance(userId, -bet, "RPS start (bet placed)");

  const stepIndex = 0;
  const currentMultiplier = GameEngine._rpsMultiplier(stepIndex);

  const outcome = {
    status: "in_progress",
    stepIndex,
    currentMultiplier,
    lastResult: null,
    lastPlayerChoice: null,
    lastHouseChoice: null,
    won: false,
  };

  const gameState = {
    seed: RNG.generateSeed(),
    inProgress: true,
    bet,
    stepIndex,
    currentMultiplier,
    history: [],
    raw: [],
  };

  const round = Round.create({
    userId,
    gameId: game.id,
    betAmount: bet,
    payoutAmount: 0,
    multiplier: 0,
    outcome,
    gameState,
  });

  return {
    success: true,
    roundId: round.id,
    round,
    result: {
      roundId: round.id,
      balance: balanceAfterBet,
      inProgress: true,
      stepIndex,
      currentMultiplier,
      canCashout: false, // only after stepIndex>=1
    },
  };
}

static async chooseRPS(userId, roundId, playerChoice) {
  const game = Game.findByName("rps");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const rid = Number(roundId);
  if (!Number.isInteger(rid) || rid <= 0) throw new Error("Invalid roundId");

  const choice = String(playerChoice || "").toLowerCase();
  if (!["rock", "paper", "scissors"].includes(choice)) throw new Error("Invalid choice");

  const round = Round.findById(rid);
  if (!round) throw new Error("Round not found");
  if (round.user_id !== userId) throw new Error("Access denied");
  if (round.game_name !== "rps") throw new Error("Invalid round game");

  const gs = round.game_state || {};
  if (!gs.inProgress) throw new Error("Bet already resolved");

  const stepIndex = Number(gs.stepIndex || 0);
  const atMultiplier = GameEngine._rpsMultiplier(stepIndex);

  // RNG choice
  const rawHouseChoice = GameEngine._rpsPickHouseChoice();
  let outcome = GameEngine._rpsResolve(choice, rawHouseChoice);

  // Dampener: flip some wins into losses
  if (outcome === "win" && RNG.randomFloat() > WIN_DAMPENER) {
    outcome = "lose";
  }

  const counters = { rock: "paper", paper: "scissors", scissors: "rock" };
  const effectiveHouseChoice = outcome === "lose" ? counters[choice] : rawHouseChoice;

  // Determine next state
  let newStepIndex = stepIndex;
  let status = "in_progress";

  if (outcome === "win") newStepIndex = stepIndex + 1;
  if (outcome === "lose") status = "lost";

  const newMultiplier = GameEngine._rpsMultiplier(newStepIndex);

  // Persist history
  const entry = {
    stepIndex,
    atMultiplier,
    playerChoice: choice,
    houseChoice: effectiveHouseChoice,
    result: outcome,
    ts: Date.now(),
  };

  const newHistory = Array.isArray(gs.history) ? [...gs.history, entry] : [entry];
  const newRaw = Array.isArray(gs.raw)
    ? [...gs.raw, { rawHouseChoice }]
    : [{ rawHouseChoice }];

  const newGameState = {
    ...gs,
    stepIndex: newStepIndex,
    currentMultiplier: newMultiplier,
    inProgress: status === "in_progress",
    history: newHistory,
    raw: newRaw,
  };

  // Persist state
  Round.updateGameState(rid, newGameState);

  const newOutcome = {
    status: status === "lost" ? "lost" : "in_progress",
    stepIndex: newStepIndex,
    currentMultiplier: newMultiplier,
    lastResult: outcome,
    lastPlayerChoice: choice,
    lastHouseChoice: effectiveHouseChoice,
    won: false,
  };

  // If lost, finalize payout=0
  if (status === "lost") {
    Round.updatePayout(rid, 0, 0, newOutcome);

    return {
      success: true,
      roundId: rid,
      result: {
        roundId: rid,
        inProgress: false,
        lost: true,
        outcome,
        playerChoice: choice,
        houseChoice: effectiveHouseChoice,
        stepIndex, // lost at this step
        reachedMultiplier: atMultiplier,
        currentMultiplier: atMultiplier,
        canCashout: false,
        canContinue: false,
      },
    };
  }

  // Still alive (win or tie)
  Round.updateOutcome(rid, newOutcome);

  return {
    success: true,
    roundId: rid,
    result: {
      roundId: rid,
      inProgress: true,
      lost: false,
      won: outcome === "win",
      tied: outcome === "tie",
      outcome,
      playerChoice: choice,
      houseChoice: effectiveHouseChoice,
      previousStepIndex: stepIndex,
      stepIndex: newStepIndex,
      previousMultiplier: atMultiplier,
      currentMultiplier: newMultiplier,
      canCashout: newStepIndex >= 1,
      canContinue: true,
    },
  };
}

static async cashoutRPS(userId, roundId) {
  const game = Game.findByName("rps");
  if (!game || !game.is_enabled) throw new Error("Game is disabled");

  const rid = Number(roundId);
  if (!Number.isInteger(rid) || rid <= 0) throw new Error("Invalid roundId");

  const round = Round.findById(rid);
  if (!round) throw new Error("Round not found");
  if (round.user_id !== userId) throw new Error("Access denied");
  if (round.game_name !== "rps") throw new Error("Invalid round game");

  const gs = round.game_state || {};
  if (!gs.inProgress) throw new Error("Bet already resolved");

  const bet = Number(round.bet_amount);
  const stepIndex = Number(gs.stepIndex || 0);
  if (stepIndex <= 0) throw new Error("Nothing to cashout yet");

  const currentMultiplier = GameEngine._rpsMultiplier(stepIndex);
  const payoutAmount = bet * currentMultiplier;

  const finalBalance = User.updateBalance(userId, payoutAmount, "RPS cashout payout");

  const newGameState = {
    ...gs,
    inProgress: false,
    cashedOutAt: Date.now(),
  };
  Round.updateGameState(rid, newGameState);

  const newOutcome = {
    status: "cashed_out",
    stepIndex,
    currentMultiplier,
    lastResult: gs.history?.[gs.history.length - 1]?.result || null,
    lastPlayerChoice: gs.history?.[gs.history.length - 1]?.playerChoice || null,
    lastHouseChoice: gs.history?.[gs.history.length - 1]?.houseChoice || null,
    won: true,
  };

  Round.updatePayout(rid, payoutAmount, currentMultiplier, newOutcome);

  return {
    success: true,
    roundId: rid,
    result: {
      roundId: rid,
      inProgress: false,
      status: "cashed_out",
      stepIndex,
      multiplier: currentMultiplier,
      payout: payoutAmount,
      profit: payoutAmount - bet,
      balance: finalBalance,
    },
  };
}
}

module.exports = GameEngine;