const crypto = require("crypto");
const RNG = require("../utils/rng");
const { validateBetAmount } = require("../middleware/validation");
const Round = require("../models/Round");
const GameModel = require("../models/Game");
const { db } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

/**
 * In-memory solo crash rounds, keyed by userId.
 * Each user runs their own solo round; no shared state between users.
 * Entry shape:
 *   {
 *     roundUuid, gameId, betAmount, autoCashout,
 *     crashPoint, serverSeed, hash,
 *     startedAt, cashedOut: false, cashoutMultiplier: null, payout: null,
 *     resolved: false
 *   }
 */
const activeRounds = new Map();

// Exponential growth constant. m(t) = e^(GROWTH_K * t).
// Calibrated so that at t=10s, m ≈ e^0.66 ≈ 1.93x and by t=15s m ≈ e^0.99 ≈ 2.69x,
// matching the reference screenshots.
const GROWTH_K = 0.066;

function currentMultiplierAt(startedAt) {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed <= 0) return 1.0;
  return Math.exp(GROWTH_K * elapsed);
}

function houseEdge() {
  return 0.01; // 1%
}

function generateCrash() {
  // Same style of distribution used elsewhere in the codebase (see RNG.generateLimboResult).
  const r = Math.max(RNG.randomFloat(), 1e-12);
  const m = (1 - houseEdge()) / r;
  return Math.max(1.0, Math.min(1000000, Math.floor(m * 100) / 100));
}

function cleanupOldRounds() {
  const now = Date.now();
  for (const [userId, round] of activeRounds.entries()) {
    // Give up on abandoned rounds after 10 minutes
    if (now - round.startedAt > 10 * 60 * 1000) {
      activeRounds.delete(userId);
    }
  }
}

async function startCrash(req, res) {
  try {
    cleanupOldRounds();

    const game = GameModel.findByName("crash");
    if (!game) return res.status(404).json({ success: false, message: "Game not found" });
    // Allow game check already handled by middleware-helper in router via caller;
    // we re-check simple enabled here too for safety.
    if (!game.is_enabled) {
      return res.status(403).json({ success: false, message: "Crash is currently disabled." });
    }

    const userId = req.user.id;
    if (activeRounds.has(userId)) {
      return res.status(400).json({ success: false, message: "You already have an active round. Cash out or wait for it to crash." });
    }

    const betAmount = Number(req.body.betAmount);
    const autoCashout = req.body.autoCashout != null ? Number(req.body.autoCashout) : null;

    const validation = validateBetAmount(betAmount);
    if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

    if (betAmount > req.user.balance) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    if (autoCashout != null && (!Number.isFinite(autoCashout) || autoCashout < 1.01)) {
      return res.status(400).json({ success: false, message: "Auto cashout target must be at least 1.01x" });
    }

    // Deduct balance immediately
    req.user.balance = Number(req.user.balance) - betAmount;
    db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(req.user.balance, userId);

    const crashPoint = generateCrash();
    const serverSeed = crypto.randomBytes(16).toString("hex");
    const hash = crypto.createHash("sha256").update(`${serverSeed}:${crashPoint}`).digest("hex");
    const roundUuid = uuidv4();

    activeRounds.set(userId, {
      roundUuid,
      gameId: game.id,
      betAmount,
      autoCashout,
      crashPoint,
      serverSeed,
      hash,
      startedAt: Date.now(),
      cashedOut: false,
      cashoutMultiplier: null,
      payout: null,
      resolved: false,
    });

    return res.json({
      success: true,
      data: {
        roundId: roundUuid,
        hash, // provably-fair commit (reveal serverSeed + crashPoint after round)
        startedAt: Date.now(),
        growthK: GROWTH_K, // m(t) = e^(k*t)
      },
    });
  } catch (error) {
    console.error("Crash start error:", error);
    return res.status(500).json({ success: false, message: error.message || "Game error" });
  }
}

async function cashoutCrash(req, res) {
  try {
    const userId = req.user.id;
    const round = activeRounds.get(userId);
    if (!round) {
      return res.status(400).json({ success: false, message: "No active round" });
    }
    if (round.cashedOut || round.resolved) {
      return res.status(400).json({ success: false, message: "Already cashed out" });
    }

    const m = currentMultiplierAt(round.startedAt);
    if (m >= round.crashPoint) {
      // Already crashed — bet lost
      return finalizeCrashRound(userId, { crashed: true });
    }

    // Cash out at 2 decimal precision, capped by crashPoint
    const cashoutMultiplier = Math.floor(Math.min(m, round.crashPoint) * 100) / 100;
    const payout = Math.floor(round.betAmount * cashoutMultiplier * 100) / 100;

    round.cashedOut = true;
    round.cashoutMultiplier = cashoutMultiplier;
    round.payout = payout;

    // Credit balance
    const newBal = Number(req.user.balance) + payout;
    db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBal, userId);
    req.user.balance = newBal;

    return res.json({
      success: true,
      data: {
        cashedOut: true,
        multiplier: cashoutMultiplier,
        payout,
        newBalance: newBal,
        crashPoint, // reveal so client can continue animating to the crash point
      },
    });
  } catch (error) {
    console.error("Crash cashout error:", error);
    return res.status(500).json({ success: false, message: error.message || "Game error" });
  }
}

/**
 * Called by the frontend either via Stop (viewer ended animation) or on the
 * next /start (auto-finalize). Resolves the round into the rounds table.
 * Returns the revealed crashPoint + serverSeed for provably-fair verification.
 */
async function finalizeCrashRound(userId, opts = {}) {
  const round = activeRounds.get(userId);
  if (!round) return null;
  if (round.resolved) return round;

  // If not already crashed via time check, compute crash at finalize time so
  // the client-side Stop does NOT award extra money: only prior cashout counts.
  const m = currentMultiplierAt(round.startedAt);
  const didCrashNow = opts.crashed || m >= round.crashPoint;

  const outcome = {
    crashPoint: round.crashPoint,
    cashedOut: !!round.cashedOut,
    cashoutMultiplier: round.cashoutMultiplier || null,
    serverSeed: round.serverSeed,
  };

  const payout = round.cashedOut ? round.payout : 0;
  const netProfit = payout - round.betAmount;
  const win = round.cashedOut;

  // Record round
  Round.create({
    userId,
    gameId: round.gameId,
    betAmount: round.betAmount,
    payoutAmount: payout,
    multiplier: round.cashedOut ? round.cashoutMultiplier : round.crashPoint,
    outcome: { ...outcome, netProfit, win },
    gameState: outcome,
  });

  round.resolved = true;
  activeRounds.delete(userId);

  return {
    ...round,
    payout,
    netProfit,
    win,
  };
}

async function stopCrash(req, res) {
  try {
    const userId = req.user.id;
    const round = activeRounds.get(userId);
    if (!round) return res.status(400).json({ success: false, message: "No active round" });

    // Stop can only be used AFTER a successful cashout (user has already
    // locked in profit and wants to skip the rest of the animation).
    if (!round.cashedOut) {
      return res.status(400).json({ success: false, message: "You can only stop after cashing out." });
    }

    const finalized = await finalizeCrashRound(userId, {});
    return res.json({
      success: true,
      data: {
        stopped: true,
        crashPoint: finalized.crashPoint,
        serverSeed: finalized.serverSeed,
        payout: finalized.payout,
        cashoutMultiplier: finalized.cashoutMultiplier,
      },
    });
  } catch (error) {
    console.error("Crash stop error:", error);
    return res.status(500).json({ success: false, message: error.message || "Game error" });
  }
}

/**
 * Poll/check endpoint the frontend calls on a short interval while it knows
 * the round has "visually" reached crashPoint (m >= crashPoint at client)
 * so that the server can finalize the lost bet (if the user didn't cash out).
 * Clients may also call this to reconcile state.
 */
async function tickCrash(req, res) {
  try {
    const userId = req.user.id;
    const round = activeRounds.get(userId);
    if (!round) {
      return res.json({ success: true, data: { active: false } });
    }
    const m = currentMultiplierAt(round.startedAt);
    // Auto cashout server-side enforcement
    if (!round.cashedOut && round.autoCashout && m >= round.autoCashout && m < round.crashPoint) {
      // Perform cashout
      const cashoutMultiplier = Math.floor(round.autoCashout * 100) / 100;
      const payout = Math.floor(round.betAmount * cashoutMultiplier * 100) / 100;
      round.cashedOut = true;
      round.cashoutMultiplier = cashoutMultiplier;
      round.payout = payout;
      const newBal = Number(req.user.balance) + payout;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBal, userId);
      req.user.balance = newBal;
      return res.json({
        success: true,
        data: {
          active: true,
          cashedOut: true,
          autoCashoutHit: true,
          multiplier: cashoutMultiplier,
          payout,
          newBalance: newBal,
          crashPoint: round.crashPoint,
        },
      });
    }
    if (m >= round.crashPoint) {
      // Crash! If they didn't cash out, they lost.
      const finalized = await finalizeCrashRound(userId, { crashed: true });
      return res.json({
        success: true,
        data: {
          active: false,
          crashed: true,
          crashPoint: finalized.crashPoint,
          serverSeed: finalized.serverSeed,
          cashedOut: finalized.cashedOut,
          cashoutMultiplier: finalized.cashoutMultiplier,
          payout: finalized.payout,
          netProfit: finalized.netProfit,
        },
      });
    }
    return res.json({
      success: true,
      data: {
        active: true,
        cashedOut: round.cashedOut,
        cashoutMultiplier: round.cashoutMultiplier,
        multiplier: Math.floor(m * 100) / 100,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Game error" });
  }
}

/**
 * Recovery endpoint - frontend asks for the active round state after refresh.
 * NOTE: We NEVER reveal crashPoint/serverSeed while the round is still live
 * and uncashed-out (that would be cheating). After cashout the crashPoint
 * is revealed so the client can continue animating to it.
 */
async function getActiveCrash(req, res) {
  try {
    const userId = req.user.id;
    const round = activeRounds.get(userId);
    if (!round) return res.json({ success: true, data: { active: false } });
    const m = Math.min(currentMultiplierAt(round.startedAt), round.crashPoint);
    return res.json({
      success: true,
      data: {
        active: true,
        roundId: round.roundUuid,
        hash: round.hash,
        startedAt: round.startedAt,
        growthK: GROWTH_K,
        crashPoint: round.cashedOut ? round.crashPoint : undefined,
        serverSeed: round.resolved ? round.serverSeed : undefined,
        cashedOut: round.cashedOut,
        cashoutMultiplier: round.cashoutMultiplier,
        payout: round.payout,
        autoCashout: round.autoCashout,
        betAmount: round.betAmount,
        currentMultiplier: Math.floor(m * 100) / 100,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Game error" });
  }
}

module.exports = {
  startCrash,
  cashoutCrash,
  stopCrash,
  tickCrash,
  getActiveCrash,
  GROWTH_K,
};
