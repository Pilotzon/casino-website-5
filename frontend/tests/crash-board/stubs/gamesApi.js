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
  crashState: () => respond('state'),
  crashActive: () => respond('state'),
  crashStart: () => respond('start'),
  crashCashout: () => respond('cashout'),
  crashStop: () => respond('stop'),
};
