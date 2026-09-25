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
  } catch (e) {
    ok(false, "the smoke run finished without throwing", String(e && e.stack));
  }

  srv.kill("SIGKILL");
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
})();
