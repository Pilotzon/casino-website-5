const crypto = require("crypto");
const RNG = require("../utils/rng");
const { validateBetAmount } = require("../middleware/validation");
const Round = require("../models/Round");
const GameModel = require("../models/Game");
const { db } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

/**
 * ==========================================================================
 *  CRASH — solo rounds, one live round per user.
 * ==========================================================================
 *
 *  Money-safety rules implemented here (this file is the source of truth for
 *  the game, the frontend is only a renderer):
 *
 *   1. The bet is debited atomically the moment the round starts.
 *   2. The crash point NEVER leaves the server before the round ends
 *      (only a sha256 commitment is sent to the client).
 *   3. Every round is settled by a server-side timer, so the outcome no
 *      longer depends on the browser: closing the tab, losing the network or
 *      refreshing can never leave a round "stuck" (which used to cause the
 *      "You already have an active round" error forever).
 *   4. Open rounds are persisted in `crash_rounds`, so a backend restart
 *      resumes/settles them instead of dropping the bet.
 *   5. There is a short cooldown (COOLDOWN_MS) after a round ends, enforced
 *      server-side, before the next bet is accepted.
 *
 *  The multiplier follows m(t) = e^(GROWTH_K * t); the crash multiplier is
 *  drawn from the standard crash distribution P(m >= x) = (1 - houseEdge)/x.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const GROWTH_K = 0.066; // m(t) = e^(k*t) — ~1.93x at 10s, ~2.69x at 15s
const HOUSE_EDGE = 0.01; // 1%
const COOLDOWN_MS = 1000; // wait after a round ends before betting again
const MIN_CRASH = 1.01; // never crash instantly at 1.00x
const MAX_CRASH = 1000000;
const MIN_AUTO_CASHOUT = 1.01;
const MAX_AUTO_CASHOUT = 1000000;
const HISTORY_LIMIT = 20; // pills shown in the UI
const MAX_ROUND_MS = 10 * 60 * 1000; // hard safety cap for a live round
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
/** @type {Map<number, object>} live round per user id */
const activeRounds = new Map();
/** @type {Map<number, number>} userId -> epoch ms when betting is allowed again */
const cooldownEndsAt = new Map();
/** @type {Map<number, object>} userId -> last finished round (exact endedAt) */
const lastEnded = new Map();
/** @type {Map<number, NodeJS.Timeout>} userId -> pending settlement timer */
const settleTimers = new Map();

let tablesReady = false;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function round8(value) {
  return Math.round(Number(value) * 1e8) / 1e8;
}
function floor2(value) {
  return Math.floor(Number(value) * 100) / 100;
}
function multiplierAt(startedAt, at = Date.now()) {
  const elapsed = (at - startedAt) / 1000;
  if (elapsed <= 0) return 1;
  return Math.exp(GROWTH_K * elapsed);
}
/** epoch ms at which the round reaches its crash multiplier */
function crashTimeMs(round) {
  return round.startedAt + (Math.log(round.crashPoint) / GROWTH_K) * 1000;
}
/** epoch ms at which the auto cash-out fires (null when not usable) */
function autoCashoutTimeMs(round) {
  if (!round.autoCashout || round.cashedOut) return null;
  // Crash at or below the target always wins (standard crash behaviour).
  if (round.autoCashout >= round.crashPoint) return null;
  return round.startedAt + (Math.log(round.autoCashout) / GROWTH_K) * 1000;
}

function generateCrashPoint() {
  // P(m >= x) = (1 - houseEdge) / x   (same distribution as Limbo)
  const r = Math.max(RNG.randomFloat(), 1e-12);
  const m = (1 - HOUSE_EDGE) / r;
  return Math.min(MAX_CRASH, Math.max(MIN_CRASH, floor2(m)));
}

// ---------------------------------------------------------------------------
// Persistence of open rounds (survives a backend restart)
// ---------------------------------------------------------------------------
function ensureTables() {
  if (tablesReady) return;
  tablesReady = true;
  db.exec(`
    CREATE TABLE IF NOT EXISTS crash_rounds (
      user_id           INTEGER PRIMARY KEY,
      round_uuid        TEXT    NOT NULL,
      game_id           INTEGER NOT NULL,
      bet_amount        REAL    NOT NULL,
      auto_cashout      REAL,
      crash_point       REAL    NOT NULL,
      server_seed       TEXT    NOT NULL,
      hash              TEXT    NOT NULL,
      started_at        INTEGER NOT NULL,
      cashed_out        INTEGER NOT NULL DEFAULT 0,
      cashout_multiplier REAL,
      payout            REAL,
      updated_at        INTEGER NOT NULL
    );
  `);
  restoreOpenRounds();

  // Safety net: force-settle anything that somehow outlived MAX_ROUND_MS.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [userId, round] of activeRounds.entries()) {
      if (now - round.startedAt > MAX_ROUND_MS) {
        try {
          finalizeRound(userId, { crashed: true, reason: "expired" });
        } catch (err) {
          console.error("Crash sweep error:", err.message);
        }
      }
    }
  }, 60 * 1000);
  if (sweep.unref) sweep.unref();
}

function persistOpenRound(round) {
  db.prepare(
    `INSERT INTO crash_rounds
       (user_id, round_uuid, game_id, bet_amount, auto_cashout, crash_point,
        server_seed, hash, started_at, cashed_out, cashout_multiplier, payout, updated_at)
     VALUES (@user_id, @round_uuid, @game_id, @bet_amount, @auto_cashout, @crash_point,
        @server_seed, @hash, @started_at, @cashed_out, @cashout_multiplier, @payout, @updated_at)
     ON CONFLICT(user_id) DO UPDATE SET
        round_uuid = excluded.round_uuid,
        game_id = excluded.game_id,
        bet_amount = excluded.bet_amount,
        auto_cashout = excluded.auto_cashout,
        crash_point = excluded.crash_point,
        server_seed = excluded.server_seed,
        hash = excluded.hash,
        started_at = excluded.started_at,
        cashed_out = excluded.cashed_out,
        cashout_multiplier = excluded.cashout_multiplier,
        payout = excluded.payout,
        updated_at = excluded.updated_at`
  ).run({
    user_id: round.userId,
    round_uuid: round.roundUuid,
    game_id: round.gameId,
    bet_amount: round.betAmount,
    auto_cashout: round.autoCashout ?? null,
    crash_point: round.crashPoint,
    server_seed: round.serverSeed,
    hash: round.hash,
    started_at: round.startedAt,
    cashed_out: round.cashedOut ? 1 : 0,
    cashout_multiplier: round.cashoutMultiplier ?? null,
    payout: round.payout ?? null,
    updated_at: Date.now(),
  });
}

function forgetOpenRound(userId) {
  db.prepare("DELETE FROM crash_rounds WHERE user_id = ?").run(userId);
}

/**
 * Restore rounds that were live when the process stopped. Each one is
 * re-evaluated immediately: the crash/auto-cash-out times are all derived
 * from `startedAt`, so a restart cannot change an outcome.
 */
function restoreOpenRounds() {
  let rows = [];
  try {
    rows = db.prepare("SELECT * FROM crash_rounds").all();
  } catch (err) {
    console.error("Crash restore error:", err.message);
    return;
  }
  for (const row of rows) {
    activeRounds.set(row.user_id, {
      userId: row.user_id,
      roundUuid: row.round_uuid,
      gameId: row.game_id,
      betAmount: row.bet_amount,
      autoCashout: row.auto_cashout,
      crashPoint: row.crash_point,
      serverSeed: row.server_seed,
      hash: row.hash,
      startedAt: row.started_at,
      cashedOut: !!row.cashed_out,
      cashoutMultiplier: row.cashout_multiplier,
      payout: row.payout,
      resolved: false,
    });
  }
  if (rows.length) {
    console.log(`🎢 Crash: restored ${rows.length} unfinished round(s) after restart`);
    for (const row of rows) {
      const timer = setTimeout(() => {
        try {
          evaluateRound(row.user_id);
        } catch (err) {
          console.error("Crash restore settle error:", err.message);
        }
      }, 0);
      if (timer.unref) timer.unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function clearTimer(userId) {
  const timer = settleTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    settleTimers.delete(userId);
  }
}

/** Make sure a timer exists for the next event of this round. */
function scheduleTimers(userId) {
  clearTimer(userId);
  const round = activeRounds.get(userId);
  if (!round || round.resolved) return;

  const now = Date.now();
  let nextEventAt = crashTimeMs(round);
  const autoAt = autoCashoutTimeMs(round);
  if (autoAt != null && autoAt < nextEventAt) nextEventAt = autoAt;

  const delay = Math.max(0, nextEventAt - now);
  const timer = setTimeout(() => {
    settleTimers.delete(userId);
    try {
      evaluateRound(userId);
    } catch (err) {
      console.error("Crash timer error:", err.message);
    }
  }, delay);
  settleTimers.set(userId, timer);
  if (timer.unref) timer.unref();
}

/**
 * Apply every event of this round that is already due (auto cash-out first
 * when it happens before the crash, then the crash itself) and re-arm the
 * timer for the next one.
 */
function evaluateRound(userId) {
  const round = activeRounds.get(userId);
  if (!round || round.resolved) return null;

  const now = Date.now();
  const autoAt = autoCashoutTimeMs(round);
  const crashAt = crashTimeMs(round);

  if (autoAt != null && autoAt <= now) {
    creditCashout(round, floor2(round.autoCashout), { auto: true });
  }
  if (crashAt <= now + EPS) {
    return finalizeRound(userId, { crashed: true });
  }
  scheduleTimers(userId);
  return null;
}

/** Credit a cash-out (manual or automatic) exactly once. */
function creditCashout(round, multiplier, { auto = false } = {}) {
  if (round.cashedOut || round.resolved) return false;
  const safeMultiplier = Math.min(floor2(multiplier), floor2(round.crashPoint));
  const payout = round8(round.betAmount * safeMultiplier);

  const credit = db.transaction(() => {
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(payout, round.userId);
  });
  credit();

  round.cashedOut = true;
  round.cashoutMultiplier = safeMultiplier;
  round.payout = payout;
  round.autoCashedOut = auto;
  round.cashedOutAt = Date.now();
  persistOpenRound(round);
  return true;
}

/**
 * Finish a round: write it into `rounds`, drop it from memory/persistence and
 * start the cooldown.
 */
function finalizeRound(userId, { crashed = false, reason = "crash" } = {}) {
  const round = activeRounds.get(userId);
  if (!round) return null;
  if (round.resolved) return round.lastPayload || null;

  const cashoutMultiplier = round.cashedOut ? round.cashoutMultiplier : null;
  const payout = round.cashedOut ? round8(round.payout || 0) : 0;
  const netProfit = round8(payout - round.betAmount);
  const win = !!round.cashedOut;
  const endedAt = Date.now();

  const outcome = {
    crashPoint: round.crashPoint,
    cashedOut: win,
    cashoutMultiplier,
    serverSeed: round.serverSeed,
    hash: round.hash,
    startedAt: round.startedAt,
    endedAt,
    netProfit,
    win,
    autoCashout: round.autoCashout ?? null,
    auto: !!round.autoCashedOut,
    reason,
  };

  let recordedId = null;
  try {
    const recorded = Round.create({
      userId,
      gameId: round.gameId,
      betAmount: round.betAmount,
      payoutAmount: payout,
      multiplier: win ? cashoutMultiplier : round.crashPoint,
      outcome,
      gameState: outcome,
    });
    recordedId = recorded?.id ?? null;
  } catch (err) {
    // Never lose the round silently: the balance side is already correct.
    console.error("Crash: failed to record round:", err.message);
  }

  round.resolved = true;
  activeRounds.delete(userId);
  clearTimer(userId);
  try {
    forgetOpenRound(userId);
  } catch (err) {
    console.error("Crash: failed to drop persisted round:", err.message);
  }
  cooldownEndsAt.set(userId, endedAt + COOLDOWN_MS);

  const payload = {
    roundId: round.roundUuid,
    roundRecordId: recordedId,
    betAmount: round.betAmount,
    autoCashout: round.autoCashout ?? null,
    startedAt: round.startedAt,
    endedAt,
    crashed: !!crashed && !win,
    crashPoint: round.crashPoint,
    serverSeed: round.serverSeed,
    hash: round.hash,
    cashedOut: win,
    autoCashedOut: !!round.autoCashedOut,
    cashoutMultiplier,
    payout,
    netProfit,
    win,
  };
  lastEnded.set(userId, payload);
  round.lastPayload = payload;
  return payload;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------
function cooldownRemaining(userId) {
  const endsAt = cooldownEndsAt.get(userId) || 0;
  return Math.max(0, endsAt - Date.now());
}

function getUserBalance(userId) {
  const row = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
  return row ? Number(row.balance) : null;
}

function parseOutcome(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Last finished crash rounds (own rounds, or global history for guests). */
function recentCrashRounds(userId, limit = HISTORY_LIMIT) {
  const base = `
    SELECT r.round_uuid, r.bet_amount, r.payout_amount, r.multiplier, r.outcome, r.created_at
      FROM rounds r
      JOIN games g ON g.id = r.game_id
     WHERE g.name = 'crash'`;
  const rows =
    userId == null
      ? db.prepare(`${base} ORDER BY r.id DESC LIMIT ?`).all(limit)
      : db.prepare(`${base} AND r.user_id = ? ORDER BY r.id DESC LIMIT ?`).all(userId, limit);
  return rows || [];
}

function serializeHistory(userId, limit = HISTORY_LIMIT) {
  return recentCrashRounds(userId, limit).map((row) => {
    const outcome = parseOutcome(row.outcome);
    const won = Number(row.payout_amount) > 0;
    const value = won
      ? Number(outcome.cashoutMultiplier ?? row.multiplier)
      : Number(outcome.crashPoint ?? row.multiplier);
    return {
      roundId: row.round_uuid,
      value: Number.isFinite(value) ? value : row.multiplier,
      won,
      at: row.created_at,
    };
  });
}

function serializeLastRound(userId) {
  // Prefer a round this process just finished (has the exact endedAt).
  const inMemory = userId != null ? lastEnded.get(userId) : null;
  if (inMemory) {
    return {
      roundId: inMemory.roundId,
      betAmount: inMemory.betAmount,
      crashPoint: inMemory.crashPoint,
      serverSeed: inMemory.serverSeed,
      hash: inMemory.hash,
      cashedOut: inMemory.cashedOut,
      cashoutMultiplier: inMemory.cashoutMultiplier,
      payout: inMemory.payout,
      netProfit: inMemory.netProfit,
      win: inMemory.win,
      startedAt: inMemory.startedAt,
      endedAt: inMemory.endedAt,
      own: true,
    };
  }

  const [row] = recentCrashRounds(userId, 1);
  if (!row) return null;
  const outcome = parseOutcome(row.outcome);
  const won = Number(row.payout_amount) > 0;
  return {
    roundId: row.round_uuid,
    betAmount: Number(row.bet_amount),
    crashPoint: Number(outcome.crashPoint ?? row.multiplier),
    serverSeed: outcome.serverSeed ?? null,
    hash: outcome.hash ?? null,
    cashedOut: won,
    cashoutMultiplier: won ? Number(outcome.cashoutMultiplier ?? row.multiplier) : null,
    payout: Number(row.payout_amount),
    netProfit: round8(Number(row.payout_amount) - Number(row.bet_amount)),
    win: won,
    startedAt: outcome.startedAt ?? null,
    // The row is written the moment the round ends, so created_at is a good
    // approximation of the end time (used for the post-round cooldown).
    endedAt: outcome.endedAt ?? null,
    createdAt: row.created_at,
    own: true,
  };
}

function serializeActiveRound(round) {
  const revealed = round.cashedOut; // only revealed once the bet is locked in
  return {
    roundId: round.roundUuid,
    hash: round.hash,
    startedAt: round.startedAt,
    betAmount: round.betAmount,
    autoCashout: round.autoCashout ?? null,
    cashedOut: !!round.cashedOut,
    cashoutMultiplier: round.cashoutMultiplier ?? null,
    payout: round.payout ?? null,
    currentMultiplier: floor2(Math.min(multiplierAt(round.startedAt), round.crashPoint)),
    crashPoint: revealed ? round.crashPoint : undefined,
  };
}

/** The single payload every crash endpoint returns. */
function buildState(userId, extra = {}) {
  const round = userId != null ? activeRounds.get(userId) : null;
  const balance = userId != null ? getUserBalance(userId) : null;
  const lastRound = serializeLastRound(userId);
  const remaining = userId != null ? cooldownRemaining(userId) : 0;

  return {
    serverNow: Date.now(),
    growthK: GROWTH_K,
    cooldownMs: COOLDOWN_MS,
    cooldownEndsAt: remaining > 0 ? Date.now() + remaining : null,
    cooldownRemainingMs: remaining,
    balance,
    active: !!round,
    round: round ? serializeActiveRound(round) : null,
    lastRound,
    history: serializeHistory(userId, HISTORY_LIMIT),
    ...extra,
  };
}

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/games/crash/start
 * Debits the bet and starts the round. A truly live round still blocks a new
 * bet (and that message tells the player what to do), but a round whose crash
 * time has already passed is settled first instead of blocking the player.
 */
async function startCrash(req, res) {
  try {
    ensureTables();

    const game = GameModel.findByName("crash");
    if (!game) return fail(res, 404, "Game not found");
    if (!game.is_enabled) return fail(res, 403, "Crash is currently disabled.");

    const userId = req.user.id;
    const betAmount = Number(req.body.betAmount);
    const autoCashout =
      req.body.autoCashout != null && req.body.autoCashout !== "" ? Number(req.body.autoCashout) : null;

    const validation = validateBetAmount(betAmount);
    if (!validation.valid) return fail(res, 400, validation.message);

    if (autoCashout != null) {
      if (!Number.isFinite(autoCashout) || autoCashout < MIN_AUTO_CASHOUT || autoCashout > MAX_AUTO_CASHOUT) {
        return fail(
          res,
          400,
          `Auto cashout target must be between ${MIN_AUTO_CASHOUT} and ${MAX_AUTO_CASHOUT}x`
        );
      }
    }

    // Settle whatever is already due before deciding whether the player is
    // really still in a round.
    const pending = activeRounds.get(userId);
    if (pending) {
      if (pending.resolved) {
        activeRounds.delete(userId);
      } else {
        const due = evaluateRound(userId);
        if (!due && activeRounds.has(userId)) {
          const live = activeRounds.get(userId);
          const now = floor2(multiplierAt(live.startedAt));
          const state = buildState(userId);
          return fail(
            res,
            400,
            `Your previous round is still running at ${now.toFixed(2)}x — cash out or wait for the crash.`,
            { data: state, state }
          );
        }
      }
    }

    const remaining = cooldownRemaining(userId);
    if (remaining > 0) {
      return fail(res, 429, "The round just ended — you can bet again in a moment.", {
        data: buildState(userId),
        retryInMs: remaining,
      });
    }

    // Atomic debit — re-checked inside the transaction so two parallel
    // requests can never spend the same balance.
    let balanceAfter;
    try {
      const debit = db.transaction(() => {
        const row = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
        const current = row ? Number(row.balance) : 0;
        if (current < betAmount) {
          const err = new Error("Insufficient balance");
          err.statusCode = 400;
          throw err;
        }
        db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(round8(betAmount), userId);
        return round8(current - betAmount);
      });
      balanceAfter = debit();
    } catch (err) {
      return fail(res, err.statusCode || 400, err.message || "Bet failed");
    }

    const crashPoint = generateCrashPoint();
    const serverSeed = RNG.generateServerSeed();
    const hash = crypto.createHash("sha256").update(`${serverSeed}:${crashPoint}`).digest("hex");
    const startedAt = Date.now();

    const round = {
      userId,
      roundUuid: uuidv4(),
      gameId: game.id,
      betAmount: round8(betAmount),
      autoCashout,
      crashPoint,
      serverSeed,
      hash,
      startedAt,
      cashedOut: false,
      cashoutMultiplier: null,
      payout: null,
      resolved: false,
    };
    activeRounds.set(userId, round);
    persistOpenRound(round);
    scheduleTimers(userId);

    return res.json({
      success: true,
      data: buildState(userId, {
        balance: balanceAfter,
        started: true,
        roundId: round.roundUuid,
        hash,
        startedAt,
        growthK: GROWTH_K,
      }),
    });
  } catch (error) {
    console.error("Crash start error:", error);
    return fail(res, 500, error.message || "Game error");
  }
}

/**
 * POST /api/games/crash/cashout
 * Manual cash-out. If the round already crashed the response says so
 * (`crashed: true`) instead of pretending the player won.
 */
async function cashoutCrash(req, res) {
  try {
    ensureTables();
    const userId = req.user.id;
    const round = activeRounds.get(userId);
    if (!round || round.resolved) {
      return fail(res, 400, "No active round", { data: buildState(userId) });
    }
    if (round.cashedOut) {
      return fail(res, 400, "Already cashed out", { data: buildState(userId) });
    }

    // The crash always wins when it is already due.
    if (Date.now() + EPS >= crashTimeMs(round)) {
      const ended = finalizeRound(userId, { crashed: true });
      return res.json({ success: true, data: buildState(userId, { crashed: true, lastRound: ended }) });
    }

    const m = multiplierAt(round.startedAt);
    creditCashout(round, floor2(m), { auto: false });
    scheduleTimers(userId); // the round keeps running until its crash time

    return res.json({
      success: true,
      data: buildState(userId, {
        cashedOut: true,
        autoCashoutHit: false,
        multiplier: round.cashoutMultiplier,
        payout: round.payout,
        newBalance: getUserBalance(userId),
        crashPoint: round.crashPoint, // revealed: the bet is locked in
        balance: getUserBalance(userId),
      }),
    });
  } catch (error) {
    console.error("Crash cashout error:", error);
    return fail(res, 500, error.message || "Game error");
  }
}

/**
 * POST /api/games/crash/stop
 * Ends the (already cashed out) round early — a viewer-only convenience: the
 * money was already credited, this only skips the rest of the animation.
 */
async function stopCrash(req, res) {
  try {
    ensureTables();
    const userId = req.user.id;
    const round = activeRounds.get(userId);
    if (!round || round.resolved) {
      return fail(res, 400, "No active round", { data: buildState(userId) });
    }
    if (!round.cashedOut) {
      return fail(res, 400, "You can only stop after cashing out.", { data: buildState(userId) });
    }

    const ended = finalizeRound(userId, { crashed: false, reason: "stopped" });
    return res.json({ success: true, data: buildState(userId, { stopped: true, lastRound: ended }) });
  } catch (error) {
    console.error("Crash stop error:", error);
    return fail(res, 500, error.message || "Game error");
  }
}

/**
 * POST /api/games/crash/tick  +  GET /api/games/crash/state
 * Reconciliation poll used by the client while a round is on screen. Also
 * applies any due event server-side, so the state is correct no matter how
 * often (or rarely) the client polls.
 */
async function tickCrash(req, res) {
  try {
    ensureTables();
    const userId = req.user.id;
    let crashedPayload = null;

    if (activeRounds.has(userId)) {
      crashedPayload = evaluateRound(userId);
    }

    const state = buildState(userId);
    if (crashedPayload) {
      state.crashed = true;
      state.lastRound = crashedPayload;
    }
    return res.json({ success: true, data: state });
  } catch (error) {
    console.error("Crash tick error:", error);
    return fail(res, 500, error.message || "Game error");
  }
}

/**
 * GET /api/games/crash/active — kept for backwards compatibility.
 * NOTE: never reveals crashPoint/serverSeed while the bet is still open.
 */
async function getActiveCrash(req, res) {
  try {
    ensureTables();
    const userId = req.user.id;
    return res.json({ success: true, data: buildState(userId) });
  } catch (error) {
    console.error("Crash state error:", error);
    return fail(res, 500, error.message || "Game error");
  }
}

/**
 * GET /api/games/crash/last — public snapshot for the game board.
 * Returns ONLY finished rounds (crashPoint is already public for those), so a
 * refreshed/guest page can render the last outcome without any chance of
 * leaking a live round's crash point.
 */
async function getLastCrashRounds(req, res) {
  try {
    ensureTables();
    const userId = req.user ? req.user.id : null;
    return res.json({
      success: true,
      data: {
        serverNow: Date.now(),
        growthK: GROWTH_K,
        cooldownMs: COOLDOWN_MS,
        lastRound: serializeLastRound(userId),
        history: serializeHistory(userId, HISTORY_LIMIT),
      },
    });
  } catch (error) {
    console.error("Crash last rounds error:", error);
    return fail(res, 500, error.message || "Game error");
  }
}

module.exports = {
  startCrash,
  cashoutCrash,
  stopCrash,
  tickCrash,
  getActiveCrash,
  getLastCrashRounds,
  GROWTH_K: GROWTH_K,
  COOLDOWN_MS,
};
