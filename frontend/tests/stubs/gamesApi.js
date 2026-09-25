/**
 * Test double for `src/services/api.js` — the crash endpoints for the board
 * tests, plus the game endpoints the site-wide suite drives (flip, limbo,
 * dice, mines, history pills). `__api` lets a test play the server side.
 */
export const __api = {
  last: null, state: null, start: null, cashout: null, stop: null,
  calls: [],
  delay: {},        // per-endpoint artificial latency, e.g. { state: 700 }
};

function respond(key) {
  __api.calls.push(key);
  const v = __api[key];
  const d = __api.delay[key] || 0;
  // A real server stamps the payload when it is BUILT; a slow link delivers it
  // later. Keeping that distinction is what makes the staleness tests honest.
  const stamp = Date.now();
  const finish = () => {
    if (v && v.__error) return Promise.reject(v.__error);
    const payload = v && typeof v === 'object' && 'serverNow' in v ? { ...v, serverNow: stamp } : v;
    return { data: { success: true, data: payload } };
  };
  if (d > 0) {
    return new Promise((res, rej) => setTimeout(() => (v && v.__error ? rej(v.__error) : res(finish())), d));
  }
  return Promise.resolve(finish());
}

/* Raw bodies for the endpoints whose callers read `res.data.<field>` directly
   (flip / limbo / dice / mines): `__api[key]` is the whole response body, a
   function of the request data, or `{ __error }` to reject. */
function respondRaw(key, args) {
  __api.calls.push(key);
  (__api.args[key] = __api.args[key] || []).push(args);
  let v = __api[key];
  if (typeof v === 'function') v = v(args);
  const d = __api.delay[key] || 0;
  const finish = () => (v && v.__error ? Promise.reject(v.__error) : Promise.resolve({ data: v }));
  return d > 0 ? new Promise((r) => setTimeout(r, d)).then(finish) : finish();
}
__api.args = {};

export const gamesAPI = {
  // the history pills above the board (useGameHistory): rows in `__api.history`
  getGameHistory: (game, params) => {
    (__api.args.history = __api.args.history || []).push([game, params]);
    return respond('history');
  },
  // Coin Flip rounds
  startFlip: (d) => respondRaw('flipStart', d),
  chooseFlip: (d) => respondRaw('flipChoose', d),
  cashoutFlip: (d) => respondRaw('flipCashout', d),
  activeFlip: () => respondRaw('flipActive'),
  // single-shot games + mines
  playLimbo: (d) => respondRaw('limbo', d),
  playDice: (d) => respondRaw('dice', d),
  startMines: (d) => respondRaw('minesStart', d),
  revealMinesCell: (d) => respondRaw('minesReveal', d),
  cashoutMines: (d) => respondRaw('minesCashout', d),
  crashLast: () => respond('last'),
  // record the options so tests can assert the live long-poll (`hold`) wiring
  crashState: (opts) => {
    (global.__crashStateOpts = global.__crashStateOpts || []).push(opts);
    return respond('state');
  },
  crashActive: () => respond('state'),
  crashStart: () => respond('start'),
  crashCashout: () => respond('cashout'),
  crashStop: () => respond('stop'),
};

/* ---- dashboard: only the navbar balance box's `today` summary ----
   `__dash.today` is the payload, `__dash.fail` makes the call reject, and
   every call's params are recorded in `__dash.calls`. */
export const __dash = { today: null, fail: false, calls: [] };

export const dashboardAPI = {
  getToday: (params) => {
    __dash.calls.push(params);
    if (__dash.fail) {
      return Promise.reject(Object.assign(new Error('boom'), { response: { data: { message: 'Stats are down' } } }));
    }
    return Promise.resolve({ data: { success: true, data: __dash.today } });
  },
};

/* ---- the axios-like default export used by plain modules (useSiteStatus …) */
export const __site = {
  status: { signup_enabled: true, maintenance_mode: false },
  calls: [],
};

const client = {
  get: (url) => {
    __site.calls.push(url);
    if (/pages\/status/.test(url)) {
      return Promise.resolve({ data: { success: true, data: { ...__site.status } } });
    }
    return Promise.resolve({ data: { success: true, data: null } });
  },
  post: () => Promise.resolve({ data: { success: true, data: null } }),
  put: () => Promise.resolve({ data: { success: true, data: null } }),
  patch: () => Promise.resolve({ data: { success: true, data: null } }),
  delete: () => Promise.resolve({ data: { success: true, data: null } }),
  interceptors: { request: { use() {} }, response: { use() {} } },
};

export default client;
