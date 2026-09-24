/**
 * Crash engine smoke test.
 *
 *   npm run test:crash        (from backend/)
 *
 * ⚠️  It wipes and recreates the database at DATABASE_PATH, so it defaults to a
 * throw-away file. Never point it at the real casino.db.
 *
 * The RNG is patched so crash points are deterministic, which makes every
 * money path (bet, manual cash-out, auto cash-out, crash, cooldown, restart
 * recovery, validation) checkable in ~30 seconds.
 */
process.env.DATABASE_PATH = process.env.DATABASE_PATH || "/tmp/crash-engine-test.db";
if (/casino\.db$/.test(process.env.DATABASE_PATH)) {
  console.error("Refusing to run against the live database:", process.env.DATABASE_PATH);
  process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const fs = require("fs");
try { fs.rmSync(process.env.DATABASE_PATH, { force: true }); } catch {}

const path = require("path");
const BACKEND = path.resolve(__dirname, "..");

const { db, initializeDatabase, initializeGames, initializeSettings } = require(path.join(BACKEND, "src/config/database"));
initializeDatabase();
initializeGames();
initializeSettings();

const RNG = require(path.join(BACKEND, "src/utils/rng"));
const crash = require(path.join(BACKEND, "src/services/crashHandler"));

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake request/response helpers -------------------------------------------------
function makeReq(userId, body = {}) {
  return { user: { id: userId }, body };
}
function makeRes() {
  const res = { statusCode: 200, payload: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (p) => { res.payload = p; return res; };
  return res;
}
async function call(handler, userId, body = {}) {
  const req = makeReq(userId, body);
  const res = makeRes();
  await handler(req, res);
  return res;
}
const balanceOf = (id) => Number(db.prepare("SELECT balance FROM users WHERE id = ?").get(id).balance);
const setBalance = (id, v) => db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(v, id);
const roundsOf = (id) => db.prepare("SELECT * FROM rounds WHERE user_id = ? ORDER BY id DESC").all(id);
const openRows = (id) => db.prepare("SELECT * FROM crash_rounds WHERE user_id = ?").all(id);

// crash point control: crashPoint = floor2((1-e)/r) clamped to [1.01, 1e6]
const crashAtR = (r) => { RNG.randomFloat = () => r; };
const secondsUntil = (crashPoint) => Math.log(crashPoint) / 0.066;

// create test users
db.prepare(
  `INSERT INTO users (email, username, password_hash, role, balance, is_active)
   VALUES ('t@t.t', 'tester', 'x', 'user', 100, 1)`
).run();
db.prepare(
  `INSERT INTO users (email, username, password_hash, role, balance, is_active)
   VALUES ('t2@t.t', 'tester2', 'x', 'user', 100, 1)`
).run();
const U1 = db.prepare("SELECT id FROM users WHERE email = 't@t.t'").get().id;
const U2 = db.prepare("SELECT id FROM users WHERE email = 't2@t.t'").get().id;

(async () => {
  console.log("\n=== 1. instant-ish crash (1.01x) settles by itself, no polling at all ===");
  {
    setBalance(U1, 100);
    crashAtR(0.999); // -> 1.01x, crashes after ~0.15s
    const r = await call(crash.startCrash, U1, { betAmount: 10, autoCashout: 5 });
    ok(r.statusCode === 200 && r.payload.success, "start accepted", JSON.stringify(r.payload));
    ok(Math.abs(balanceOf(U1) - 90) < 1e-9, "bet debited immediately", `balance=${balanceOf(U1)}`);
    ok(r.payload.data.active === true, "round reported active");
    ok(r.payload.data.round.crashPoint === undefined, "crashPoint NOT leaked while live");
    ok(typeof r.payload.data.round.hash === "string", "commitment hash sent");

    await sleep(500); // never call /state — the server must settle on its own
    const row = roundsOf(U1)[0];
    ok(!!row, "round recorded in rounds table without any client poll");
    ok(Number(row.payout_amount) === 0, "loss has payout 0");
    ok(Math.abs(balanceOf(U1) - 90) < 1e-9, "balance unchanged after loss");
    ok(openRows(U1).length === 0, "open round removed from crash_rounds");
    const state = await call(crash.tickCrash, U1);
    ok(state.payload.data.active === false, "state says no active round");
    ok(state.payload.data.lastRound?.crashPoint === 1.01, "crash point revealed after crash");
  }

  console.log("\n=== 2. post-round cooldown is enforced server-side (1s) ===");
  {
    crashAtR(0.999);
    await call(crash.startCrash, U1, { betAmount: 1 });
    await sleep(400);
    const early = await call(crash.startCrash, U1, { betAmount: 1 });
    ok(early.statusCode === 429, "bet during cooldown rejected", `status=${early.statusCode}`);
    ok(/wait|moment/i.test(early.payload.message || ""), "cooldown message is user friendly", early.payload.message);
    await sleep(900);
    crashAtR(0.9); // 1.10x
    const late = await call(crash.startCrash, U1, { betAmount: 1 });
    ok(late.statusCode === 200, "bet accepted once the cooldown passed", JSON.stringify(late.payload));
    await sleep(1200);
  }

  console.log("\n=== 3. manual cashout credits once and the crash still settles the round ===");
  {
    setBalance(U2, 100);
    crashAtR(0.6); // 0.99/0.6 = 1.65x  -> crash at ~7.6s
    const start = await call(crash.startCrash, U2, { betAmount: 10, autoCashout: 99 });
    ok(start.statusCode === 200, "start ok");
    await sleep(1500); // ~1.10x
    const out = await call(crash.cashoutCrash, U2);
    const d = out.payload.data;
    ok(out.payload.success && d.cashedOut === true, "cashout accepted", JSON.stringify(out.payload));
    ok(d.multiplier >= 1.09 && d.multiplier < 1.12, "cashout multiplier ~1.10x", `m=${d.multiplier}`);
    ok(Math.abs(balanceOf(U2) - (90 + d.payout)) < 1e-6, "payout credited", `balance=${balanceOf(U2)} payout=${d.payout}`);
    ok(d.crashPoint === 1.65, "crash point revealed after cashout (bet locked in)");
    ok(d.active === true, "round keeps running for the animation");

    const again = await call(crash.cashoutCrash, U2);
    ok(again.statusCode === 400, "double cashout rejected", `status=${again.statusCode}`);

    const balBefore = balanceOf(U2);
    await sleep(7000); // crash happens ~7.6s in
    const after = await call(crash.tickCrash, U2);
    ok(after.payload.data.active === false, "round auto-settled at the crash point");
    ok(Math.abs(balanceOf(U2) - balBefore) < 1e-9, "no second credit at the crash");
    const row = roundsOf(U2)[0];
    ok(Number(row.payout_amount) === d.payout, "recorded payout = cashout payout");
    ok(JSON.parse(row.outcome).cashedOut === true, "recorded as cashed out");
  }

  console.log("\n=== 4. auto cashout fires on time with NO polling (survives a close/refresh) ===");
  {
    setBalance(U1, 100);
    crashAtR(0.6); // 1.65x -> crash ~7.6s
    const start = await call(crash.startCrash, U1, { betAmount: 20, autoCashout: 1.2 }); // auto at ~2.8s
    ok(start.statusCode === 200, "start ok");
    await sleep(3800); // no polls in between
    const bal = balanceOf(U1);
    const expected = 80 + Math.round(20 * 1.2 * 100) / 100;
    ok(Math.abs(bal - expected) < 1e-6, "auto cashout credited without polling", `balance=${bal} expected=${expected}`);
    const mid = await call(crash.tickCrash, U1);
    ok(mid.payload.data.active === true && mid.payload.data.round.cashedOut === true, "round still live + cashed out");
    await sleep(4500);
    const done = await call(crash.tickCrash, U1);
    ok(done.payload.data.active === false, "round settled after the crash");
    ok(Math.abs(balanceOf(U1) - expected) < 1e-9, "no double credit");
    const row = roundsOf(U1)[0];
    ok(Math.abs(me(row.multiplier) - 1.2) < 1e-9, "recorded multiplier = auto target", `m=${row.multiplier}`);
  }

  console.log("\n=== 5. auto cashout ABOVE the crash point still loses (crash wins) ===");
  {
    setBalance(U2, 100);
    crashAtR(0.9); // 1.10x
    await call(crash.startCrash, U2, { betAmount: 5, autoCashout: 2 });
    await sleep(1500);
    const st = await call(crash.tickCrash, U2);
    ok(st.payload.data.active === false, "round settled as a loss");
    ok(Math.abs(balanceOf(U2) - 95) < 1e-9, "lost the bet", `balance=${balanceOf(U2)}`);
    await sleep(1100);
  }

  console.log("\n=== 6. a live round still blocks a second bet (with a clear message) ===");
  {
    setBalance(U1, 100);
    crashAtR(0.3); // 3.30x -> ~18s
    await call(crash.startCrash, U1, { betAmount: 5, autoCashout: 3 });
    const dup = await call(crash.startCrash, U1, { betAmount: 5 });
    ok(dup.statusCode === 400, "second concurrent bet rejected");
    ok(/still running/i.test(dup.payload.message), "message explains the live round", dup.payload.message);
    ok(dup.payload.data?.active === true, "state attached so the client resyncs");
    ok(Math.abs(balanceOf(U1) - 95) < 1e-9, "no extra debit");
    const out = await call(crash.cashoutCrash, U1);
    ok(out.payload.data.cashedOut === true, "cashout works");
    await call(crash.stopCrash, U1); // stop is allowed after cashout
    const stopped = await call(crash.tickCrash, U1);
    ok(stopped.payload.data.active === false, "stop finalised the round");
    const stoppedAgain = await call(crash.stopCrash, U1);
    ok(stoppedAgain.statusCode === 400, "stop without a round rejected");
  }

  console.log("\n=== 7. 'stop' before cashing out is refused (no free roll) ===");
  {
    setBalance(U2, 100);
    await sleep(1100);
    crashAtR(0.9);
    await call(crash.startCrash, U2, { betAmount: 5 });
    const stop = await call(crash.stopCrash, U2);
    ok(stop.statusCode === 400, "stop before cashout refused", `status=${stop.statusCode}`);
    await sleep(1500);
  }

  console.log("\n=== 8. leftovers from a previous process are settled on startup ===");
  {
    setBalance(U1, 100);
    // simulate a round that was live when the server died 5 seconds ago and
    // whose crash time (1.10x -> 1.44s) already passed
    db.prepare(
      `INSERT INTO crash_rounds
        (user_id, round_uuid, game_id, bet_amount, auto_cashout, crash_point, server_seed, hash,
         started_at, cashed_out, cashout_multiplier, payout, updated_at)
       VALUES (?, 'stale-uuid', (SELECT id FROM games WHERE name='crash'), 7, NULL, 1.10, 'seed', 'hash',
               ?, 0, NULL, NULL, ?)`
    ).run(U1, Date.now() - 5000, Date.now() - 5000);
    setBalance(U1, 93); // bet already debited

    // a fresh module instance == a fresh process
    delete require.cache[require.resolve(path.join(BACKEND, "src/services/crashHandler"))];
    const crash2 = require(path.join(BACKEND, "src/services/crashHandler"));
    const st = await call(crash2.tickCrash, U1);
    ok(st.payload.data.active === false, "stale round settled after restore");
    ok(openRows(U1).length === 0, "stale row cleaned up");
    const row = db.prepare("SELECT * FROM rounds WHERE user_id = ? ORDER BY id DESC").get(U1);
    ok(!!row && Number(row.bet_amount) === 7 && Math.abs(Number(row.multiplier) - 1.1) < 1e-9,
      "stale round recorded with its original crash point",
      JSON.stringify(row || {}));
    ok(Math.abs(balanceOf(U1) - 93) < 1e-9, "lost bet, balance stays debited");
  }

  console.log("\n=== 9. validation / security ===");
  {
    await sleep(1100);
    const neg = await call(crash.startCrash, U2, { betAmount: -5 });
    ok(neg.statusCode === 400, "negative bet rejected");
    const big = await call(crash.startCrash, U2, { betAmount: 1e9 });
    ok(big.statusCode === 400, "over-max bet rejected", big.payload.message);
    const poor = await call(crash.startCrash, U2, { betAmount: 5000, autoCashout: 2 });
    ok(poor.statusCode === 400, "over-balance bet rejected", poor.payload.message);
    const badAuto = await call(crash.startCrash, U2, { betAmount: 1, autoCashout: 0.5 });
    ok(badAuto.statusCode === 400, "auto cashout below 1.01 rejected");
    const nan = await call(crash.startCrash, U2, { betAmount: "abc" });
    ok(nan.statusCode === 400, "non-numeric bet rejected");
    const live = await call(crash.getActiveCrash, U2);
    ok(live.payload.data.active === false && live.payload.data.round === null, "no ghost round for a user who never played");
  }

  console.log("\n=== 10. the \"bypass disabled games/pages\" permission ===");
  {
    const { canBypassUser, runWithGameAccess } = require(path.join(BACKEND, "src/services/gameAccess"));
    const GameModel = require(path.join(BACKEND, "src/models/Game"));
    const setEnabled = (name, on) =>
      db.prepare("UPDATE games SET is_enabled = ? WHERE name = ?").run(on ? 1 : 0, name);
    const asUser = { id: U2, role: "user" };
    const bypassUser = { id: U2, role: "user", can_bypass_disabled: 1 };
    const ownerUser = { id: U2, role: "owner" };

    // --- who may bypass at all
    ok(canBypassUser(asUser) === false, "a normal user may not bypass");
    ok(canBypassUser(bypassUser) === true, "the permission holder may");
    ok(canBypassUser(ownerUser) === true, "the owner always may");
    ok(canBypassUser(null) === false, "anonymous never may");

    // --- crash, switched off by an admin
    setEnabled("crash", 0);
    GameModel.clearCache?.();
    await sleep(1100);
    const blocked = await call(crash.startCrash, U2, { betAmount: 1 });
    ok(blocked.statusCode === 403, "everyone is blocked while the game is off", `status=${blocked.statusCode}`);

    await sleep(1100);
    setBalance(U2, 100);
    const allowed = await runWithGameAccess(canBypassUser(bypassUser), () =>
      call(crash.startCrash, U2, { betAmount: 1 })
    );
    ok(allowed.statusCode === 200, "the permission holder still bets", `${allowed.statusCode} ${JSON.stringify(allowed.payload).slice(0, 120)}`);
    await runWithGameAccess(true, () => call(crash.stopCrash, U2));   // tidy up
    await sleep(1200);

    // --- the mobile switch, same rule (only the mobile client is blocked)
    setEnabled("crash", 1);
    db.prepare("UPDATE games SET is_mobile_enabled = 0 WHERE name = 'crash'").run();
    await sleep(1100);
    const mobileReq = { user: { id: U2 }, body: { betAmount: 1 }, headers: { "x-mobile": "1" } };
    const mobileRes = makeRes();
    await crash.startCrash(mobileReq, mobileRes);
    ok(mobileRes.statusCode === 403, "mobile is refused while the mobile switch is off", `status=${mobileRes.statusCode}`);
    await sleep(1100);
    const mobileBypassReq = { user: { id: U2, can_bypass_disabled: 1 }, body: { betAmount: 1 }, headers: { "x-mobile": "1" } };
    const mobileBypassRes = makeRes();
    await runWithGameAccess(true, () => crash.startCrash(mobileBypassReq, mobileBypassRes));
    ok(mobileBypassRes.statusCode === 200, "a permission holder on mobile still bets", `status=${mobileBypassRes.statusCode}`);
    await runWithGameAccess(true, () => call(crash.stopCrash, U2));
    db.prepare("UPDATE games SET is_mobile_enabled = 1 WHERE name = 'crash'").run();
    await sleep(1200);

    // --- the engine layer (every game re-checks on its own)
    const GameEngine = require(path.join(BACKEND, "src/services/gameEngine"));
    setEnabled("flip", 0);
    await sleep(1100);
    setBalance(U2, 100);
    let engineErr = null;
    try {
      await GameEngine.processFlip(U2, 1, "heads");
    } catch (e) {
      engineErr = e;
    }
    ok(!!engineErr && /disabled/i.test(engineErr.message), "the engine refuses a switched-off game too", String(engineErr && engineErr.message));

    const before = balanceOf(U2);
    const engineOut = await runWithGameAccess(canBypassUser(bypassUser), () => GameEngine.processFlip(U2, 1, "heads"));
    ok(!!engineOut?.success === true && !!engineOut.round?.id,
      "…but plays it for a permission holder", JSON.stringify(engineOut).slice(0, 120));
    ok(Math.abs(balanceOf(U2) - before) !== 0, "and the bet really settled (balance moved)");
    setEnabled("flip", 1);

    // --- outside a request there is no bypass at all
    ok(require(path.join(BACKEND, "src/services/gameAccess")).isBypassActive() === false,
      "no request scope → no bypass (scripts and background jobs stay safe)");
  }

  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
})();

function me(v) { return v; }
