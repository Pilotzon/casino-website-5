/**
 * Test double for `src/services/api.js` — only the crash endpoints matter for
 * the board tests. `__api` lets a test drive the server side directly.
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

export const gamesAPI = {
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
