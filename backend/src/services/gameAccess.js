/**
 * Game access context — who may bet on a game whose on/off switch is off.
 *
 * THE RULE
 * A game (or its mobile switch) turned off by an administrator is blocked for
 * normal players. Users with the admin-panel permission **"Bypass disabled
 * games/pages"** (`users.can_bypass_disabled`, and the owner, who always has
 * it) can keep playing — that is the whole point of the permission. Nobody has
 * it by default: it is granted per user from Admin → Users.
 *
 * WHY A REQUEST CONTEXT
 * The enabled check exists in two layers: the controllers gate every route
 * (`requireGameEnabledOrBypass`) and the engine re-checks inside each game
 * (`GameEngine.process*`), so a disabled game can never be played through a
 * code path that forgot the gate. That second layer only receives a userId, so
 * it cannot know whether THIS caller may bypass. `authenticateToken` therefore
 * opens an AsyncLocalStorage scope for the whole request and the deep checks
 * ask `isGameBlocked()` instead of reading `game.is_enabled` directly.
 *
 * Outside a request (the engine smoke test, cron-style jobs, scripts) there is
 * no store, so `canBypass` is false and behaviour is unchanged.
 */
const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

/** Owner always bypasses; everyone else needs the explicit permission. */
function canBypassUser(user) {
  if (!user) return false;
  if (user.role === "owner") return true;
  return Boolean(user.can_bypass_disabled);
}

/** Runs `fn` (and everything it awaits) with `bypass` in scope. */
function runWithGameAccess(bypass, fn) {
  return storage.run({ bypass: Boolean(bypass) }, fn);
}

/** true when the current request may bet on switched-off games. */
function isBypassActive() {
  const store = storage.getStore();
  return Boolean(store && store.bypass);
}

/**
 * true when this game must be treated as unavailable for the current request.
 * `isGameBlocked(game)` === "the game is off AND the caller may not bypass".
 */
function isGameBlocked(game) {
  if (!game) return true;
  if (game.is_enabled) return false;
  return !isBypassActive();
}

/** Same, for the per-game mobile switch (only the mobile client is blocked). */
function isMobileBlocked(game, req) {
  if (!game) return true;
  if (Number(game.is_mobile_enabled) !== 0) return false;
  if (isBypassActive()) return false;
  return isMobileRequest(req);
}

/** The frontend sends this header when it is running in a phone-sized viewport. */
function isMobileRequest(req) {
  if (!req) return false;
  const header = req.headers && (req.headers["x-mobile"] || req.headers["x-client-mobile"]);
  if (header === "1" || header === "true" || header === true) return true;
  const ua = (req.headers && req.headers["user-agent"]) || "";
  return /Mobi|Android|iPhone|iPad|Mobile/i.test(ua);
}

module.exports = { canBypassUser, runWithGameAccess, isBypassActive, isGameBlocked, isMobileBlocked, isMobileRequest };
