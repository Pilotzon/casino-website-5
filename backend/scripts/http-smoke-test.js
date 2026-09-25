/**
 * HTTP smoke test — the real server, over HTTP, against a throw-away database.
 *
 *   npm run test:http        (from backend/)
 *
 * It boots `src/server.js` exactly as production does (same middleware chain,
 * same routes) and pokes the endpoints the frontend depends on:
 *   • the game list + the admin switch that drives the hazard badge
 *   • login / register / /me
 *   • the "bypass disabled games/pages" permission, end to end:
 *       player without it → 403 on a switched-off game
 *       owner grants it   → the same player bets normally
 *       owner revokes it  → 403 again
 *   • the per-game mobile switch (blocked for mobile clients, bypassable)
 *   • GET /api/dashboard/today (navbar balance box): auth, local-midnight
 *     window, totals that match the rounds, the 3 latest bets, fallbacks
 *   • the multi-step Coin Flip round (start → choose … → cashout / loss,
 *     one open round at a time, resume via /flip/active)
 *   • GET /api/games/:game/history (the history pills above the board)
 *
 * ⚠️  It always runs on its own tempdir database and its own port, so it can
 * never touch the real casino.db. Never point DATA_DIR at the live data.
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.SMOKE_PORT || 5099);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "casino-http-"));
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? " → " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, { body, token, headers } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

(async () => {
  const env = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "development",
    DATA_DIR: TMP,
    DATABASE_PATH: path.join(TMP, "casino.db"),
    RATE_LIMIT_MAX_REQUESTS: "10000",
    RATE_LIMIT_WINDOW_MS: "1000",
  };

  const srv = spawn("node", ["src/server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  srv.stdout.on("data", (d) => (log += d));
  srv.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + 60000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/games");
      if (r.ok) { up = true; break; }
    } catch { /* not yet */ }
    await sleep(300);
  }
  if (!up) {
    console.log(log.slice(-3000));
    console.log("server never came up");
    process.exit(1);
  }

  const ownerEmail = process.env.OWNER_EMAIL || "owner@casino.local";
  const ownerPassword = process.env.OWNER_PASSWORD || "ChangeThisPassword123!";

  try {
    /* ---------------------------------------------------- public game list */
    const games = await req("GET", "/api/games");
    const list = games.json?.data || games.json?.games || [];
    ok(games.status === 200 && Array.isArray(list), "GET /api/games → 200 + list",
      `${games.status} ${JSON.stringify(games.json)?.slice(0, 200)}`);
    ok(list.length >= 14, "all 14 games are served", String(list.length));
    const crash = list.find((g) => (g.name || "").toLowerCase() === "crash");
    ok(!!crash && "is_enabled" in crash, "the payload carries crash + its is_enabled flag (drives the badge)",
      JSON.stringify(crash));

    const pages = await req("GET", "/api/pages");
    ok(pages.status === 200, "GET /api/pages → 200", String(pages.status));

    const site = await req("GET", "/api/pages/site-status");
    ok(site.status === 200 || site.status === 404, "site-status endpoint answers", String(site.status));

    /* --------------------------------------------------------------- owner */
    // the owner row is created + synced (bcrypt) asynchronously at boot
    let login = { status: 0 };
    for (let i = 0; i < 20 && login.status !== 200; i++) {
      login = await req("POST", "/api/auth/login", { body: { email: ownerEmail, password: ownerPassword } });
      if (login.status !== 200) await sleep(500);
    }
    const token = login.json?.data?.token || login.json?.token;
    ok(login.status === 200 && !!token, "owner login returns a token",
      `${login.status} ${JSON.stringify(login.json)?.slice(0, 160)}`);

    const admin = await req("GET", "/api/admin/games", { token });
    const adminRows = admin.json?.data || [];
    ok(admin.status === 200 && adminRows.length >= 14, "admin game list needs the owner token",
      `${admin.status} ${JSON.stringify(admin.json)?.slice(0, 160)}`);
    const noAuth = await req("GET", "/api/admin/games");
    ok(noAuth.status === 401 || noAuth.status === 403, "admin game list rejects anonymous callers", String(noAuth.status));

    const row = adminRows.find((g) => (g.name || "").toLowerCase() === "crash") || adminRows[0];
    if (row) {
      const set = await req("POST", `/api/admin/games/${row.id}/status`, { token, body: { isEnabled: false } });
      ok(set.status === 200, "an admin can disable a game", `${set.status} ${JSON.stringify(set.json)?.slice(0, 160)}`);
      const after = await req("GET", "/api/games");
      const dRow = (after.json?.data || []).find((g) => g.id === row.id);
      ok(dRow && Number(dRow.is_enabled) === 0, "the public list reflects the disabled flag", JSON.stringify(dRow));
      await req("POST", `/api/admin/games/${row.id}/status`, { token, body: { isEnabled: true } });
    } else {
      ok(false, "an admin can disable a game", "no game row returned");
    }

    const me = await req("GET", "/api/auth/me", { token });
    ok(me.status === 200, "authenticated /me answers", String(me.status));

    /* ------------------------------- bypass disabled games/pages (HTTP) --- */
    const suffix = String(Date.now()).slice(-6);
    const playerEmail = `player${suffix}@example.com`;
    const reg = await req("POST", "/api/auth/register", {
      body: { email: playerEmail, password: "PlayerPass123!", username: `player${suffix}` },
    });
    const pToken = reg.json?.data?.token || reg.json?.token;
    ok(!!pToken, "a fresh player registers + logs in", `${reg.status} ${JSON.stringify(reg.json)?.slice(0, 140)}`);

    const adminFlip = adminRows.find((g) => g.name === "flip");
    const adminCrash = adminRows.find((g) => g.name === "crash");
    await req("POST", `/api/admin/games/${adminFlip.id}/status`, { token, body: { isEnabled: false } });

    const denied = await req("POST", "/api/games/flip/play", {
      token: pToken, body: { betAmount: 1, selectedSide: "heads" },
    });
    ok(denied.status === 403, "a normal player is refused on a disabled game",
      `${denied.status} ${JSON.stringify(denied.json)?.slice(0, 140)}`);

    const users = await req("GET", "/api/admin/users", { token });
    const userRows = users.json?.data?.users || users.json?.data || [];
    const pRow = userRows.find((u) => u.email === playerEmail);
    ok(!!pRow, "the new player shows up in the admin user list", JSON.stringify(users.json)?.slice(0, 160));

    if (pRow) {
      const grant = await req("POST", `/api/admin/users/${pRow.id}/bypass-disabled`, {
        token, body: { canBypass: true },
      });
      ok(grant.status === 200, 'the owner grants "bypass disabled games/pages"',
        `${grant.status} ${JSON.stringify(grant.json)?.slice(0, 140)}`);

      const me2 = await req("GET", "/api/auth/me", { token: pToken });
      const meUser = me2.json?.data?.user || me2.json?.data;
      ok(Boolean(meUser?.can_bypass_disabled), "the permission reaches the client", JSON.stringify(meUser)?.slice(0, 160));

      const allowed = await req("POST", "/api/games/flip/play", {
        token: pToken, body: { betAmount: 1, selectedSide: "heads" },
      });
      ok(allowed.status === 200, "the permission holder bets on the disabled game",
        `${allowed.status} ${JSON.stringify(allowed.json)?.slice(0, 160)}`);

      if (adminCrash) {
        await req("POST", `/api/admin/games/${adminCrash.id}/status`, { token, body: { isEnabled: false } });
        const crashBlocked = await req("POST", "/api/games/crash/start", {
          token: pToken, body: { betAmount: 1, autoCashout: 1.5 },
        });
        // accepted for the bypass holder (200) — never a 403
        ok(crashBlocked.status !== 403, "crash honours the same permission",
          `${crashBlocked.status} ${JSON.stringify(crashBlocked.json)?.slice(0, 140)}`);
        await req("POST", "/api/games/crash/stop", { token: pToken });
      }

      const ownerBet = await req("POST", "/api/games/flip/play", { token, body: { betAmount: 1, selectedSide: "heads" } });
      ok(ownerBet.status === 200, "the owner bypasses too", `${ownerBet.status} ${JSON.stringify(ownerBet.json)?.slice(0, 120)}`);

      await req("POST", `/api/admin/users/${pRow.id}/bypass-disabled`, { token, body: { canBypass: false } });
      const revoked = await req("POST", "/api/games/flip/play", {
        token: pToken, body: { betAmount: 1, selectedSide: "heads" },
      });
      ok(revoked.status === 403, "and it is refused again once revoked", String(revoked.status));
    }

    await req("POST", `/api/admin/games/${adminFlip.id}/status`, { token, body: { isEnabled: true } });

    /* --------------------------------------- per-game mobile switch (HTTP) */
    if (adminCrash) {
      await req("POST", `/api/admin/games/${adminCrash.id}/status`, { token, body: { isEnabled: true } });
      await req("POST", `/api/admin/games/${adminCrash.id}/mobile-status`, { token, body: { isMobileEnabled: false } });
      const onPhone = await req("POST", "/api/games/crash/start", {
        token: pToken, body: { betAmount: 1, autoCashout: 1.5 }, headers: { "x-mobile": "1", "user-agent": "MobiTest" },
      });
      ok(onPhone.status === 403, "mobile is refused while the mobile switch is off",
        `${onPhone.status} ${JSON.stringify(onPhone.json)?.slice(0, 140)}`);
      const onDesktop = await req("POST", "/api/games/crash/start", {
        token: pToken, body: { betAmount: 1, autoCashout: 1.5 },
      });
      ok(onDesktop.status !== 403, "the same account still plays on desktop",
        `${onDesktop.status} ${JSON.stringify(onDesktop.json)?.slice(0, 140)}`);
      await req("POST", "/api/games/crash/stop", { token: pToken });
      await req("POST", `/api/admin/games/${adminCrash.id}/mobile-status`, { token, body: { isMobileEnabled: true } });
    }

    /* ------------------- navbar balance box: GET /api/dashboard/today --- */
    {
      const reg2 = await req("POST", "/api/auth/register", {
        body: { email: `today${suffix}@example.com`, password: "PlayerPass123!", username: `today${suffix}` },
      });
      const tToken = reg2.json?.data?.token || reg2.json?.token;
      ok(!!tToken, "a second fresh player for the today-summary checks");

      const noAuth = await req("GET", "/api/dashboard/today");
      ok(noAuth.status === 401, "today's summary needs a login", String(noAuth.status));

      const mid = new Date();
      mid.setHours(0, 0, 0, 0);
      const since = encodeURIComponent(mid.toISOString());
      const empty = await req("GET", `/api/dashboard/today?since=${since}`, { token: tToken });
      const e = empty.json?.data || {};
      ok(empty.status === 200 && e.bets === 0 && e.wagered === 0 && e.profit === 0
        && Array.isArray(e.recent) && e.recent.length === 0,
        "a new player's day starts at zero", JSON.stringify(empty.json)?.slice(0, 160));
      ok(e.since === mid.toISOString(), "the day starts at the player's LOCAL midnight", e.since);

      const bets = [];
      for (const amt of [1, 2, 3, 4]) {
        const r = await req("POST", "/api/games/dice/play", {
          token: tToken, body: { betAmount: amt, targetNumber: 50.5, rollUnder: false },
        });
        bets.push(r.json?.round);
      }
      ok(bets.every((b) => b && b.id), "four dice bets went through", JSON.stringify(bets.map((b) => b && b.id)));

      const after = await req("GET", `/api/dashboard/today?since=${since}`, { token: tToken });
      const d = after.json?.data || {};
      const wagered = bets.reduce((sum, b) => sum + Number(b?.bet_amount || 0), 0);
      const payout = bets.reduce((sum, b) => sum + Number(b?.payout_amount || 0), 0);
      ok(d.bets === 4 && Math.abs(d.wagered - wagered) < 1e-9, "wagered = the sum of today's stakes",
        `${d.bets} ${d.wagered} vs ${wagered}`);
      ok(Math.abs(d.payout - payout) < 1e-9 && Math.abs(d.profit - (payout - wagered)) < 1e-9,
        "profit = payout - wagered", `${d.profit} vs ${payout - wagered}`);
      const expectIds = [bets[3], bets[2], bets[1]].map((b) => b?.id).join();
      ok(Array.isArray(d.recent) && d.recent.length === 3 && d.recent.map((r) => r.id).join() === expectIds,
        "the 3 latest bets come newest first (same-second ties broken by id)", JSON.stringify(d.recent?.map((r) => r.id)));
      const top = d.recent?.[0] || {};
      ok(top.game_display_name === "Dice" && Number.isFinite(top.multiplier) && typeof top.created_at === "string"
        && Math.abs(top.profit - (top.payout_amount - top.bet_amount)) < 1e-9,
        "each bet carries game, stake, result, multiplier and time", JSON.stringify(top).slice(0, 200));

      const utcMid = new Date();
      utcMid.setUTCHours(0, 0, 0, 0);
      const junk = await req("GET", "/api/dashboard/today?since=not-a-date", { token: tToken });
      const future = await req("GET", "/api/dashboard/today?since=2999-01-01T00:00:00Z", { token: tToken });
      const ancient = await req("GET", "/api/dashboard/today?since=2001-01-01T00:00:00Z", { token: tToken });
      ok([junk, future, ancient].every((r) => r.json?.data?.since === utcMid.toISOString()),
        "a missing / junk / out-of-range `since` falls back to the server's UTC midnight",
        [junk, future, ancient].map((r) => r.json?.data?.since).join(" "));

      const other = await req("GET", `/api/dashboard/today?since=${since}`, { token: pToken });
      ok(other.status === 200 && !(other.json?.data?.recent || []).some((r) => bets.some((b) => b?.id === r.id)),
        "a player only ever sees their own bets");
    }

    /* ---------- multi-step Coin Flip + GET /api/games/:game/history ---- */
    {
      const reg3 = await req("POST", "/api/auth/register", {
        body: { email: `flip${suffix}@example.com`, password: "PlayerPass123!", username: `flip${suffix}` },
      });
      const fToken = reg3.json?.data?.token || reg3.json?.token;
      ok(!!fToken, "a third fresh player for the flip + history checks");
      const bal = async () => {
        const me = await req("GET", "/api/auth/me", { token: fToken });
        return Number((me.json?.data?.user || me.json?.data)?.balance);
      };

      const anon = await req("GET", "/api/games/flip/active");
      ok(anon.status === 401, "the open-round lookup needs a login", String(anon.status));
      const none = await req("GET", "/api/games/flip/active", { token: fToken });
      ok(none.status === 200 && none.json?.result === null, "no open flip round to begin with", JSON.stringify(none.json));

      const b0 = await bal();
      const start = await req("POST", "/api/games/flip/start", { token: fToken, body: { betAmount: 2 } });
      const s = start.json?.result || {};
      ok(start.status === 200 && s.inProgress === true && s.wins === 0 && s.canFlip === true && s.canCashout === false
        && Math.abs(s.nextMultiplier - 1.98) < 1e-9 && Array.isArray(s.flips) && s.flips.length === 0,
        "Bet opens a round: no call yet, the first win pays 1.98×", JSON.stringify(s).slice(0, 220));
      ok(Math.abs(s.balance - (b0 - 2)) < 1e-9 && Math.abs((await bal()) - (b0 - 2)) < 1e-9, "the stake is taken when the round opens");

      const again = await req("POST", "/api/games/flip/start", { token: fToken, body: { betAmount: 2 } });
      ok(again.status === 409 && again.json?.code === "FLIP_ROUND_OPEN", "one open round at a time (409 FLIP_ROUND_OPEN)", String(again.status));
      const active = await req("GET", "/api/games/flip/active", { token: fToken });
      ok(active.json?.result?.roundId === s.roundId && active.json.result.inProgress === true, "the open round can be fetched back (page reload)");
      const early = await req("POST", "/api/games/flip/cashout", { token: fToken, body: { roundId: s.roundId } });
      ok(early.status === 400, "no cash-out before a winning call", String(early.status));
      const badSide = await req("POST", "/api/games/flip/choose", { token: fToken, body: { roundId: s.roundId, side: "edge" } });
      ok(badSide.status === 400, "a bad side is refused", String(badSide.status));

      // Keep playing until both a win (cashed out) and a loss have happened.
      // A win after the first cash-out just keeps flipping — that exercises
      // multi-win rounds (the doubling check).
      const betOf = { [s.roundId]: 2 };
      let roundId = s.roundId;
      let sawWin = false, sawLoss = false, consistent = true, doubling = true, maxWins = 0;
      let cashedOk = null, closedOk = true, staleOk = null, flipsOk = true;
      for (let n = 0; n < 60 && !(sawWin && sawLoss); n++) {
        if (!roundId) {
          const st = await req("POST", "/api/games/flip/start", { token: fToken, body: { betAmount: 1 } });
          roundId = st.json?.result?.roundId;
          betOf[roundId] = 1;
        }
        const side = n % 2 ? "tails" : "heads";
        const c = await req("POST", "/api/games/flip/choose", { token: fToken, body: { roundId, side } });
        const r = c.json?.result || {};
        if (c.status !== 200 || r.side !== side || r.won !== (r.outcome === side)) consistent = false;
        const last = Array.isArray(r.flips) ? r.flips[r.flips.length - 1] : null;
        if (!last || last.side !== side || last.outcome !== r.outcome || last.won !== r.won) flipsOk = false;
        if (r.won) {
          maxWins = Math.max(maxWins, r.wins);
          if (Math.abs(r.currentMultiplier - 1.98 * 2 ** (r.wins - 1)) > 1e-9
            || Math.abs(r.nextMultiplier - 1.98 * 2 ** r.wins) > 1e-9 || !r.canCashout || !r.inProgress) doubling = false;
          if (!sawWin) {
            const before = await bal();
            const co = await req("POST", "/api/games/flip/cashout", { token: fToken, body: { roundId } });
            const cr = co.json?.result || {};
            cashedOk = co.status === 200 && Math.abs(cr.payout - betOf[roundId] * r.currentMultiplier) < 1e-6
              && Math.abs(cr.balance - (before + cr.payout)) < 1e-6 && Math.abs((await bal()) - cr.balance) < 1e-6;
            sawWin = true;
            roundId = null;
          }
        } else {
          sawLoss = true;
          if (r.inProgress !== false || r.canCashout !== false || r.lost !== true) closedOk = false;
          const stale = await req("POST", "/api/games/flip/choose", { token: fToken, body: { roundId, side: "heads" } });
          staleOk = stale.status === 400;
          roundId = null;
        }
      }
      ok(sawWin && sawLoss, "played until a win and a loss had both happened", `${sawWin} ${sawLoss}`);
      ok(consistent, "the coin shown always agrees with the verdict (won ⇔ outcome = call)");
      ok(flipsOk, "every call is appended to the round's flip list");
      ok(doubling, `every win doubles the multiplier: 1.98 × 2^(wins−1) (best streak here: ${maxWins})`);
      ok(cashedOk === true, "cash-out pays stake × multiplier into the balance");
      ok(closedOk, "a lost call closes the round (nothing left to cash out)");
      ok(staleOk === true, "a finished round takes no more calls (400)");
      const after = await req("GET", "/api/games/flip/active", { token: fToken });
      ok(after.status === 200 && (roundId ? after.json?.result?.roundId === roundId : after.json?.result === null),
        "/flip/active only ever reports a round that is still open");

      // …and a round with two wins in a row (≈18 % of rounds): the second
      // win doubles again, and cashing out pays the doubled amount
      if (roundId) {
        await req("POST", "/api/games/flip/cashout", { token: fToken, body: { roundId } });
        roundId = null;
      }
      let streak = null;
      for (let n = 0; n < 80 && !streak; n++) {
        if (!roundId) {
          const st = await req("POST", "/api/games/flip/start", { token: fToken, body: { betAmount: 1 } });
          roundId = st.json?.result?.roundId;
        }
        const c = (await req("POST", "/api/games/flip/choose", { token: fToken, body: { roundId, side: n % 2 ? "heads" : "tails" } })).json?.result || {};
        if (!c.won) roundId = null;
        else if (c.wins === 2) streak = c;
      }
      ok(streak && Math.abs(streak.currentMultiplier - 3.96) < 1e-9 && Math.abs(streak.nextMultiplier - 7.92) < 1e-9
        && streak.flips.length === 2 && streak.flips.every((f) => f.won), "a second win in a row doubles again: 3.96× (next 7.92×)",
        JSON.stringify(streak).slice(0, 200));
      if (streak) {
        const co = await req("POST", "/api/games/flip/cashout", { token: fToken, body: { roundId } });
        ok(co.status === 200 && Math.abs(co.json?.result?.payout - 3.96) < 1e-9 && co.json?.result?.wins === 2,
          "cashing out after two wins pays 3.96 × the stake", JSON.stringify(co.json?.result));
        roundId = null;
      }

      const rolls = [];
      for (let i = 0; i < 3; i++) {
        const r = await req("POST", "/api/games/dice/play", { token: fToken, body: { betAmount: 1, targetNumber: 50.5, rollUnder: false } });
        rolls.push({ uuid: r.json?.round?.round_uuid, roll: Number(r.json?.result?.roll), won: Boolean(r.json?.result?.won) });
      }
      const hist = await req("GET", "/api/games/dice/history?limit=2", { token: fToken });
      const h = hist.json?.data || [];
      ok(hist.status === 200 && h.length === 2 && h[0].roundId === rolls[2].uuid && h[1].roundId === rolls[1].uuid,
        "dice history: newest first, `limit` respected", JSON.stringify(h).slice(0, 220));
      ok(h[0] && Math.abs(h[0].value - rolls[2].roll) < 1e-9 && h[0].won === rolls[2].won && typeof h[0].at === "string",
        "each entry carries the roll, won / lost and the time");
      const guest = await req("GET", "/api/games/dice/history");
      ok(guest.status === 200 && Array.isArray(guest.json?.data) && guest.json.data.length === 0, "a guest gets an empty history");
      const lim = await req("POST", "/api/games/limbo/play", { token: fToken, body: { betAmount: 1, targetMultiplier: 2 } });
      const lh = await req("GET", "/api/games/limbo/history", { token: fToken });
      ok(lh.json?.data?.[0]?.roundId === lim.json?.round?.round_uuid
        && Math.abs(lh.json.data[0].value - Number(lim.json?.result?.multiplier)) < 1e-9,
        "limbo history: the multiplier that came up", JSON.stringify(lh.json?.data?.[0]));
      const noPills = await req("GET", "/api/games/mines/history", { token: fToken });
      ok(noPills.status === 404, "games without pills have no history endpoint (404)", String(noPills.status));
    }
  } catch (e) {
    ok(false, "the smoke run finished without throwing", String(e && e.stack));
  }

  srv.kill("SIGKILL");
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
})();
