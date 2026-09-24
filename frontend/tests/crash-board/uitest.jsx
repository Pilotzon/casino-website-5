/* ============================================================================
 * Crash board — DOM test suite (jsdom, no browser required).
 *
 * Written against the real component: it drives the real polling, the real
 * cash-out flow and the real render pump, then measures what the board
 * actually renders — SVG path data, inline positions, colours, text.
 *
 * Every section mounts its own board and unmounts it again, so the scripted
 * server state of one section can never leak into the next one.
 *
 * Run:  npm run test:board        (from frontend/)
 * ==========================================================================*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Crash from '../../src/components/games/Crash.jsx';
import RefreshGuard from '../../src/components/common/RefreshGuard.jsx';
import { ActiveBetProvider } from '../../src/context/ActiveBetContext.jsx';
import { __api as api } from '../stubs/gamesApi.js';
import { __auth } from '../stubs/authContext.jsx';
import { __toasts as toasts } from '../stubs/toastContext.jsx';

// injected by build.mjs (the bundle is CommonJS, so `import.meta` is not available)
const here = typeof __TEST_DIR__ === 'string' ? __TEST_DIR__ : process.cwd();

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** wait until `cond()` is true (poll-schedule aware) */
const waitFor = async (cond, timeout = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (cond()) return true;
    await sleep(40);
  }
  return false;
};
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const txt = (root, cls) => root.querySelector(`.css-${cls}`)?.textContent?.trim() ?? null;
const num = (root, cls) => parseFloat((txt(root, cls) || '').replace(/[^\d.]/g, ''));
const styleNum = (el, prop) => parseFloat((el?.style?.[prop] || '').replace('%', ''));
const paths = (root) => [...root.querySelectorAll('svg.css-svg path')];
const linePath = (root) => paths(root).pop();
const shadowPath = (root) => paths(root)[1];
function lastPoint(d) {
  if (typeof d !== 'string' || !d.trim()) return { x: NaN, y: NaN };
  const last = d.trim().split(/[ML]/).filter(Boolean).pop().trim().split(',');
  return { x: parseFloat(last[0]), y: parseFloat(last[1]) };
}
const K = 0.066;

/* --------------------------------------------------------------- the page */
const gameRow = { name: 'crash', display_name: 'Crash', is_enabled: 1, is_mobile_enabled: 1 };
const T0 = Date.now();
const mounted = [];

const mountBoard = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    React.createElement(ActiveBetProvider, null,
      React.createElement(React.Fragment, null,
        React.createElement(Crash, { gameRow }),
        React.createElement(RefreshGuard, null)
      )
    )
  );
  mounted.push({ host, root });
  return host;
};
const unmountAll = () => {
  while (mounted.length) {
    const { host, root } = mounted.pop();
    try { root.unmount(); } catch { /* already gone */ }
    host.remove();
  }
};

/** One server state payload, shaped exactly like `crashHandler.buildState`. */
const liveState = (roundExtra = {}, topExtra = {}) => {
  const startedAt = roundExtra.startedAt ?? T0;
  const currentMultiplier = roundExtra.currentMultiplier
    ?? Math.floor(Math.exp(K * ((Date.now() - startedAt) / 1000)) * 100) / 100;
  return {
    serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0,
    balance: 90, active: true,
    round: {
      roundId: 'r1', hash: 'abc', betAmount: 10, autoCashout: 2, cashedOut: false,
      cashoutMultiplier: null, payout: null, ...roundExtra, startedAt, currentMultiplier,
    },
    lastRound: null, history: [], ...topExtra,
  };
};

const startRound = async (host, state) => {
  api.start = state;
  api.state = state;
  const input = host.querySelector('input[type=number]');
  if (input) setInputValue(input, '10');
  await sleep(60);
  await waitFor(() => host.querySelector('.css-betButton') && !host.querySelector('.css-betButton').disabled, 2500);
  host.querySelector('.css-betButton')?.click();
  return waitFor(() => !!host.querySelector('.css-cashoutBtn'), 2500);
};

async function main() {
  /* ------------------------------------------------------------------ §1 */
  console.log('\n=== 1. board chrome (line, single soft shadow, tick boxes, tip) ===');
  api.last = { serverNow: Date.now(), growthK: K, cooldownMs: 1000, lastRound: null, history: [] };
  api.state = { serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0, balance: 100, active: false, round: null, lastRound: null, history: [] };

  const c1 = mountBoard();
  await sleep(400);
  ok(/^Total 0s$/.test(txt(c1, 'xTotal') ?? ''), 'idle board shows "Total 0s"', txt(c1, 'xTotal'));

  ok(await startRound(c1, liveState({ startedAt: Date.now(), currentMultiplier: 1 })), 'round running');
  await sleep(300);

  const ps = paths(c1);
  ok(ps.length === 3, 'exactly 3 layers: fill + shadow + line (no stacked shadows)', `paths=${ps.length}`);
  const sh = shadowPath(c1);
  ok(sh.getAttribute('stroke') === '#000000' && sh.getAttribute('stroke-opacity') === '0.3',
    'shadow is ONE black 30% layer', `${sh.getAttribute('stroke')} @ ${sh.getAttribute('stroke-opacity')}`);
  ok((sh.getAttribute('filter') || '').includes('crashShadowBlur'), 'shadow is blurred (soft), not a hard copy');
  ok(c1.querySelector('svg.css-svg defs feGaussianBlur')?.getAttribute('stdDeviation') === '0.55',
    'blur amount is defined in the SVG');
  const ln = linePath(c1);
  ok(ln.getAttribute('stroke-width') === '8', 'curve is the thick 8px white line', ln.getAttribute('stroke-width'));
  ok((ln.getAttribute('stroke') || '').toLowerCase() === '#ffffff', 'line is white while running', ln.getAttribute('stroke'));
  ok(!!c1.querySelector('.css-tipMarker'), 'tip dot present');
  ok(c1.querySelectorAll('.css-yTickBox').length >= 3, 'Y tick labels are boxes',
    String(c1.querySelectorAll('.css-yTickBox').length));
  ok(!!c1.querySelector('.css-yAxisSpine'), 'Y axis spine present');
  ok(!c1.querySelector('.css-tipMarkerCrashed'), 'tip dot is NOT in the crashed colour while running');

  /* ----------------------------------------------------------------- §1b */
  console.log('\n=== 1b. render pump keeps the board moving with rAF frozen ===');
  {
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    global.requestAnimationFrame = () => 0;
    api.delay = { state: 1200 };                 // polls cannot be the source of motion
    const a = num(c1, 'centerMult');
    await sleep(200);
    const b = num(c1, 'centerMult');
    await sleep(200);
    const d = num(c1, 'centerMult');
    window.requestAnimationFrame = realRaf;
    global.requestAnimationFrame = realRaf.bind(window);
    ok(b > a && d > b, 'multiplier kept advancing with rAF frozen and no polls', `${a} -> ${b} -> ${d}`);
    await sleep(1300);                           // let the delayed poll resolve
    api.delay = {};
  }

  /* ------------------------------------------------------------------ §2 */
  console.log('\n=== 2. tip dot sits exactly on the curve tip ===');
  {
    let worst = 0;
    for (let i = 0; i < 6; i += 1) {
      const p = lastPoint(linePath(c1).getAttribute('d'));
      const marker = c1.querySelector('.css-tipMarker');
      worst = Math.max(worst, Math.abs(styleNum(marker, 'left') - p.x), Math.abs(styleNum(marker, 'bottom') - (100 - p.y)));
      await sleep(70);
    }
    ok(worst < 0.4, 'dot tracks the line tip while climbing', `max deviation ${worst.toFixed(3)}%`);
  }

  /* ------------------------------------------------------------------ §3 */
  console.log('\n=== 3. cash-out is immediate, and the board NEVER un-crashes ===');
  const totalBeforeCashout = num(c1, 'xTotal');
  api.delay = { cashout: 800 };                       // slow link
  // the answer the server gives when the crash beat the request
  api.cashout = {
    serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0,
    balance: 90, active: false, round: null,
    lastRound: {
      roundId: 'r1', betAmount: 10, crashPoint: 1.05, cashedOut: false, cashoutMultiplier: null,
      payout: 0, netProfit: -10, win: false, startedAt: T0, endedAt: Date.now(), own: true,
    },
    history: [{ roundId: 'r1', value: 1.05, won: false, at: 'now' }],
    crashed: true,
  };
  c1.querySelector('.css-cashoutBtn').click();
  await sleep(120);                                   // response NOT back yet
  ok(/Cashed Out/.test(txt(c1, 'statusBox') ?? ''), 'cash-out box appears IMMEDIATELY (optimistic)', txt(c1, 'statusBox'));
  ok(!!c1.querySelector('.css-statusGreen'), 'the cash-out multiplier is the green span');
  ok(num(c1, 'xTotal') >= totalBeforeCashout, 'cash-out does not reset the round clock',
    `${totalBeforeCashout} -> ${num(c1, 'xTotal')}`);

  // meanwhile the server reports the round as FINISHED (it crashed)
  api.state = {
    serverNow: Date.now() + 500, growthK: K, cooldownMs: 1000, cooldownEndsAt: Date.now() + 1500, cooldownRemainingMs: 900,
    balance: 90, active: false, round: null,
    lastRound: {
      roundId: 'r1', betAmount: 10, crashPoint: 1.05, cashedOut: false, cashoutMultiplier: null,
      payout: 0, netProfit: -10, win: false, startedAt: T0, endedAt: Date.now(), own: true,
    },
    history: [{ roundId: 'r1', value: 1.05, won: false, at: 'now' }],
  };
  ok(await waitFor(() => /Crashed/.test(txt(c1, 'statusBox') ?? ''), 2000), 'board shows Crashed once the round ended');
  ok(linePath(c1).getAttribute('stroke') === '#2E4552', 'line turns muted on crash');
  await sleep(1000);                                  // the late cash-out response lands here
  ok(/Crashed/.test(txt(c1, 'statusBox') ?? ''), 'STILL crashed after the late cash-out response', txt(c1, 'statusBox'));
  ok(linePath(c1).getAttribute('stroke') === '#2E4552', 'line is still muted (no un-crash)');
  ok(!c1.querySelector('.css-cashoutBtn'), 'no Cash Out button after the round ended');
  ok(toasts.some(([k]) => k === 'error'), 'the lost race raised an error toast', JSON.stringify(toasts.slice(-1)));
  ok(__auth.user.balance === 90, 'balance stays the server value (nothing was credited)', String(__auth.user.balance));
  unmountAll();                                       // c1 is done — no cross-talk

  /* ----------------------------------------------------------------- §3c */
  console.log('\n=== 3c. a normal cash-out (no race) confirms itself ===');
  {
    toasts.length = 0;
    const c1b = mountBoard();
    const startedAt = Date.now();
    api.delay = { cashout: 250 };
    api.cashout = {
      serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0,
      balance: 96, active: true,
      round: { roundId: 'rLive', hash: 'h', startedAt, betAmount: 10, autoCashout: 2, cashedOut: true, cashoutMultiplier: 1.04, payout: 10.4, crashPoint: 1.6 },
      lastRound: null, history: [],
      cashedOut: true, autoCashoutHit: false, multiplier: 1.04, payout: 10.4, newBalance: 96, crashPoint: 1.6,
    };
    ok(await startRound(c1b, liveState({ roundId: 'rLive', startedAt, currentMultiplier: 1 })), 'round running');
    // from here on the round is cashed out, which is what the polls report
    api.state = liveState({
      roundId: 'rLive', startedAt, currentMultiplier: 1.1,
      cashedOut: true, cashoutMultiplier: 1.04, payout: 10.4, crashPoint: 1.6,
    }, { balance: 96 });
    c1b.querySelector('.css-cashoutBtn').click();
    ok(await waitFor(() => toasts.some(([k]) => k === 'success'), 2000), 'success toast raised',
      JSON.stringify(toasts.slice(-1)));
    ok(/Cashed Out/.test(txt(c1b, 'statusBox') ?? ''), 'board shows Cashed Out', txt(c1b, 'statusBox'));
    ok(__auth.user.balance === 96, 'payout balance applied', String(__auth.user.balance));
    await sleep(400);     // …and it survives the following polls
    ok(/Cashed Out/.test(txt(c1b, 'statusBox') ?? ''), 'still Cashed Out after the next poll', txt(c1b, 'statusBox'));
    unmountAll();
    api.delay = {};
  }

  /* ------------------------------------------------------------------ §4 */
  console.log('\n=== 4. "Total Ns" is the ROUND clock (survives refresh, stops at the crash) ===');
  {
    const startedAt = Date.now() - 4000;
    const endedAt = Date.now() - 1000;
    api.state = {
      serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0,
      balance: 90, active: false, round: null,
      lastRound: { roundId: 'rEnd', betAmount: 10, crashPoint: 1.3, cashedOut: true, cashoutMultiplier: 1.24, payout: 12.4, win: true, startedAt, endedAt, own: true },
      history: [{ roundId: 'rEnd', value: 1.3, won: true, at: 'now' }],
    };
    const c2 = mountBoard();
    ok(await waitFor(() => num(c2, 'xTotal') === 3, 2500),
      'a finished round shows the seconds it actually ran (4s start, 1s ago = 3s)', String(num(c2, 'xTotal')));
    const frozen = txt(c2, 'xTotal');
    await sleep(1600);
    ok(txt(c2, 'xTotal') === frozen, 'counter stops at the crash', `${frozen} -> ${txt(c2, 'xTotal')}`);

    // a refresh in the middle of an already-running round: a fresh page load
    // (new mount) on the same round must NOT reset the counter to 0
    unmountAll();
    api.state = liveState({ roundId: 'rFresh', startedAt: Date.now() - 7000, currentMultiplier: 1.58 });
    api.last = api.state;
    const c2b = mountBoard();
    await waitFor(() => !!c2b.querySelector('.css-cashoutBtn'), 2500);
    const at = num(c2b, 'xTotal');
    ok(at >= 6 && at <= 9, 'after a refresh the counter resumes the ROUND time (≈7s), not 0', String(at));
    await sleep(1100);
    ok(num(c2b, 'xTotal') > at, 'and it keeps counting while the round is live', `${at} -> ${num(c2b, 'xTotal')}`);
    unmountAll();

    // a round restored from the database carries no timestamps — the crash
    // point still gives its length: floor(ln(crashPoint) / k)
    api.state = {
      serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0,
      balance: 90, active: false, round: null,
      lastRound: { roundId: 'rOld', betAmount: 10, crashPoint: 1.25, cashedOut: true, cashoutMultiplier: 1.2, payout: 12, win: true, own: true },
      history: [{ roundId: 'rOld', value: 1.25, won: true, at: 'old' }],
    };
    const want = Math.round(Math.log(1.25) / K);
    const c2c = mountBoard();
    ok(await waitFor(() => num(c2c, 'xTotal') === want, 2500),
      `a DB-restored round shows its own length (${want}s)`, String(num(c2c, 'xTotal')));
    unmountAll();
  }

  /* ------------------------------------------------------------------ §5 */
  console.log('\n=== 5. the curve stops dead at the crash ===');
  {
    const c3 = mountBoard();
    const startedAt = Date.now();
    ok(await startRound(c3, liveState({ roundId: 'rDead', startedAt, currentMultiplier: 1 })), 'round running');
    api.state = {
      serverNow: Date.now(), growthK: K, cooldownMs: 1000, cooldownEndsAt: null, cooldownRemainingMs: 0,
      balance: 90, active: false, round: null,
      lastRound: { roundId: 'rDead', betAmount: 10, crashPoint: 1.4, cashedOut: false, cashoutMultiplier: null, payout: 0, win: false, startedAt, endedAt: startedAt + 2000, own: true },
      history: [{ roundId: 'rDead', value: 1.4, won: false, at: 't' }],
    };
    ok(await waitFor(() => !!c3.querySelector('.css-tipMarkerCrashed'), 2500), 'round crashed');
    await sleep(300);
    const x2 = lastPoint(linePath(c3).getAttribute('d')).x;
    const y2 = lastPoint(linePath(c3).getAttribute('d')).y;
    await sleep(1200);
    const x3 = lastPoint(linePath(c3).getAttribute('d')).x;
    const y3 = lastPoint(linePath(c3).getAttribute('d')).y;
    ok(Math.abs(x3 - x2) < 0.05 && Math.abs(y3 - y2) < 0.05,
      'nothing creeps once the crash point is reached', `(${x2},${y2}) -> (${x3},${y3})`);
    const marker = c3.querySelector('.css-tipMarker');
    ok(Math.abs(styleNum(marker, 'left') - x3) < 0.4 && Math.abs(styleNum(marker, 'bottom') - (100 - y3)) < 0.4,
      'dot sits on the end of the frozen curve');
    ok(linePath(c3).getAttribute('stroke') === '#2E4552', 'line is muted');
    ok(num(c3, 'xTotal') === 2, 'the clock counts the crash moment (2s round)', String(num(c3, 'xTotal')));
    unmountAll();
  }

  /* ------------------------------------------------------------------ §6 */
  console.log('\n=== 6. new round: fresh clock, clean box, white dot ===');
  {
    const c4 = mountBoard();
    await waitFor(() => !!c4.querySelector('.css-betButton'), 2500);
    ok(await startRound(c4, liveState({ roundId: 'rNew', startedAt: Date.now(), currentMultiplier: 1 })), 'new round running');
    await sleep(150);
    ok(!c4.querySelector('.css-statusBox'), 'status box cleared for the new round');
    ok(!c4.querySelector('.css-tipMarkerCrashed'), 'tip dot is white again');
    ok(/^Total [0-2]s$/.test(txt(c4, 'xTotal') ?? ''), 'counter restarted with the new round', txt(c4, 'xTotal'));
    unmountAll();
  }

  /* ----------------------------------------------------------------- §6b */
  console.log('\n=== 6b. smoothness on a slow link (no stall, no rewind) ===');
  {
    api.delay = { state: 700 };                       // every poll answers 700ms late
    api.state = liveState({ roundId: 'rSmooth', startedAt: Date.now() - 1200, currentMultiplier: 1.08 });
    api.last = api.state;
    const c5 = mountBoard();
    ok(await waitFor(() => !!c5.querySelector('.css-cashoutBtn'), 3000), 'slow-link round running');
    await sleep(150);
    const samples = [];
    for (let i = 0; i < 30; i += 1) {
      samples.push({
        t: Date.now(),
        m: num(c5, 'centerMult'),
        x: lastPoint(linePath(c5).getAttribute('d')).x,
      });
      await sleep(50);
    }
    api.delay = {};
    const rewinds = samples.filter((s, i) => i > 0 && s.m < samples[i - 1].m - 1e-9).length;
    const xRewinds = samples.filter((s, i) => i > 0 && s.x < samples[i - 1].x - 0.02).length;
    let lastM = samples[0].m;
    let lastT = samples[0].t;
    let stall = 0;
    for (const s of samples) {
      if (s.m > lastM + 1e-9) { stall = Math.max(stall, s.t - lastT); lastT = s.t; lastM = s.m; }
    }
    stall = Math.max(stall, samples[samples.length - 1].t - lastT);
    ok(rewinds === 0, 'multiplier never walks backwards', `${rewinds} rewind(s)`);
    ok(xRewinds === 0, 'curve tip never slides left', `${xRewinds} rewind(s)`);
    ok(stall < 900, 'no frozen moment (value keeps ticking)', `longest gap ${stall}ms`);
    unmountAll();
  }

  /* ------------------------------------------------------------------ §7 */
  console.log('\n=== 7. refresh prompt: wider/taller modal with spacing ===');
  {
    const c6 = mountBoard();
    await waitFor(() => !!c6.querySelector('.css-betButton'), 2500);
    await startRound(c6, liveState({ roundId: 'rModal', startedAt: Date.now(), currentMultiplier: 1 }));
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }));
    await sleep(250);
    const heading = document.querySelector('.ui-modal-heading');
    ok(!!heading && /Refreshing the page will not save/i.test(heading.textContent), 'prompt opened');
    ok(/ui-modal-card-md/.test(document.querySelector('.ui-modal-card')?.className ?? ''),
      'modal uses the wider "md" size');
    ok(/css-body/.test(document.querySelector('.ui-modal-body')?.className ?? ''),
      'body override class applied for the extra spacing');
    ok(!!document.querySelector('.css-actions'), 'actions wrapper present');
    unmountAll();
  }

  /* ------------------------------------------------------------------ §8 */
  console.log('\n=== 8. mobile contract (stage, chart height, pill scroller) ===');
  {
    const css = readFileSync(resolve(here, '../../src/components/games/crash.module.css'), 'utf8');
    const mobile = css.slice(css.indexOf('@media (max-width: 900px)'), css.indexOf('@media (max-width: 420px)'));
    ok(mobile.length > 0, 'a phone breakpoint exists');
    ok(/\.chartWrap\s*\{[^}]*grid-template-rows:\s*minmax\(clamp\(/.test(mobile),
      'chart gets an explicit height on phones (it does not collapse)');
    ok(/\.chartWrap\s*\{[^}]*width:\s*100%/.test(mobile), 'chart fills the stage width (centred)');
    ok(/\.historyScroll\s*\{[^}]*overflow-x:\s*auto/.test(mobile), 'history pills scroll horizontally');
    ok(/scrollbar-width:\s*thin/.test(mobile), 'the pill scroller shows a thin scrollbar');
    ok(/\.historyPills\s*\{[^}]*direction:\s*rtl/.test(mobile),
      'pills keep the newest round at the right while scrolling');
    ok(/\.yTickBox\s*\{[^}]*font-size:\s*18px/.test(mobile), 'Y tick labels are bigger on phones');
    ok(/\.xTick\s*\{[^}]*font-size:\s*17px/.test(mobile), 'X tick labels are bigger on phones');
    ok(/\.xTotalTop\s*\{[^}]*font-size:\s*18px/.test(mobile), 'the top clock is bigger on phones');
    ok(/\.centerMult\s*\{[^}]*15vw/.test(mobile), 'multiplier scales up on phones');
    ok(/\.statusBox\s*\{[^}]*font-size:\s*23px/.test(mobile), 'status box text is bigger on phones');
    ok(/\.yAxisSpine\s*\{[^}]*width:\s*7px/.test(mobile), 'spine stays thicker than the labels');
    const jsx = readFileSync(resolve(here, '../../src/components/games/Crash.jsx'), 'utf8');
    ok(/historyScroll[\s\S]{0,200}historyPills/.test(jsx), 'pills live inside the scroller element');
  }

  /* ------------------------------------------------------------------ §9 */
  console.log('\n=== 9. X axis: seconds are real (perpendicular from the tip) ===');
  {
    const startedAt = Date.now() - 7000;          // a round that is 7s old
    api.state = liveState({ roundId: 'rAxis', startedAt, currentMultiplier: 1.58 });
    api.last = api.state;
    const c7 = mountBoard();
    ok(await waitFor(() => !!c7.querySelector('.css-cashoutBtn'), 3000), 'round running');
    await sleep(120);

    const tipX = lastPoint(linePath(c7).getAttribute('d')).x;
    const drawnAt = Date.now();
    const expectedSeconds = (drawnAt - startedAt) / 1000;
    const ticks = [...c7.querySelectorAll('.css-xTick')].map((el) => ({
      sec: parseFloat(el.textContent),
      pct: styleNum(el, 'left'),
    }));
    ok(ticks.length >= 3, 'the axis has ticks', String(ticks.length));
    // 1) every label sits at its own second, on ONE shared scale
    const rates = ticks.map((t) => t.sec / t.pct);        // seconds per percent
    const spread = Math.max(...rates) - Math.min(...rates);
    ok(spread < 1e-6, 'all labels share exactly one time scale', `spread=${spread}`);
    // 2) …and that scale is the curve's scale: a perpendicular dropped from the
    //    tip of the graph lands on the seconds that have really passed
    const rate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const secondsAtTip = tipX * rate;
    console.log(`    [axis] tip sits at ${secondsAtTip.toFixed(2)}s on the axis, ${expectedSeconds.toFixed(2)}s elapsed;`
      + ` ticks: ${ticks.map((t) => t.sec).join(',')}`);
    ok(Math.abs(secondsAtTip - expectedSeconds) < 0.25,
      'perpendicular from the graph tip hits the true elapsed second',
      `${secondsAtTip.toFixed(2)}s at tip vs ${expectedSeconds.toFixed(2)}s elapsed`);
    // 3) fine enough to read: 1-second ticks while the span is short
    const gaps = ticks.slice(1).map((t, i) => t.sec - ticks[i].sec);
    ok(gaps.every((g) => g === 1), 'short rounds get one tick per second', JSON.stringify(gaps));
    ok(ticks[ticks.length - 1].sec >= Math.floor(secondsAtTip) - 1,
      'ticks reach the tip, so the position can be read off',
      `last tick ${ticks[ticks.length - 1].sec}s vs tip ${secondsAtTip.toFixed(1)}s`);
    // 4) the clock reads the same second the axis shows at the tip
    const clock = num(c7, 'xTotalAxis') ?? num(c7, 'xTotal');
    ok(Math.abs(clock - Math.round(secondsAtTip)) <= 1,
      'the "Total Ns" clock matches the axis reading at the tip',
      `clock=${clock}s, axis at tip=${secondsAtTip.toFixed(2)}s`);
    unmountAll();
  }

  /* ----------------------------------------------------------------- §10 */
  console.log('\n=== 10. multiplier + status box are the top layer ===');
  {
    const css = readFileSync(resolve(here, '../../src/components/games/crash.module.css'), 'utf8');
    const z = (sel) => {
      const m = new RegExp(`\\${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css);
      return m ? Number(m[1]) : NaN;
    };
    const overlay = z('.centerOverlay');
    const tip = z('.tipMarker');
    ok(Number.isFinite(overlay) && Number.isFinite(tip) && overlay > tip,
      'the multiplier/status layer is above the tip dot', `overlay=${overlay} tip=${tip}`);

    const c8 = mountBoard();
    await waitFor(() => !!c8.querySelector('.css-betButton'), 2500);
    ok(await startRound(c8, liveState({ roundId: 'rLayer', startedAt: Date.now(), currentMultiplier: 1 })), 'round running');
    await sleep(150);
    ok(!!c8.querySelector('.css-centerOverlay') && !!c8.querySelector('.css-tipMarker'),
      'both the overlay and the dot are rendered');
    unmountAll();
  }

  /* ----------------------------------------------------------------- §11 */
  console.log('\n=== 11. mobile: the round clock sits top right, under the pills ===');
  {
    const css = readFileSync(resolve(here, '../../src/components/games/crash.module.css'), 'utf8');
    const mobile = css.slice(css.indexOf('@media (max-width: 900px)'), css.indexOf('@media (max-width: 420px)'));
    ok(/\.stageTotal\s*\{[^}]*display:\s*flex/.test(mobile), 'the top clock row is shown on phones');
    ok(/\.stageTotal\s*\{[^}]*justify-content:\s*flex-end/.test(mobile), 'and it is right-aligned');
    ok(/\.xTotalAxis\s*\{[^}]*display:\s*none/.test(mobile), 'the axis copy is hidden on phones');
    ok(/\.stageTotal\s*\{\s*display:\s*none/.test(css), 'the top clock is hidden on desktop');

    const c9 = mountBoard();
    await waitFor(() => !!c9.querySelector('.css-betButton'), 2500);
    ok(await startRound(c9, liveState({ roundId: 'rTop', startedAt: Date.now(), currentMultiplier: 1 })), 'round running');
    await sleep(150);
    const topClock = c9.querySelector('.css-xTotalTop');
    ok(!!topClock, 'the top-right clock is in the DOM');
    ok(topClock?.textContent?.trim() === txt(c9, 'xTotal'), 'both clocks show the same seconds',
      `${topClock?.textContent} / ${txt(c9, 'xTotal')}`);
    const stageHtml = c9.querySelector('.css-gameStage')?.innerHTML ?? '';
    ok(stageHtml.indexOf('css-historyRow') < stageHtml.indexOf('css-stageTotal')
      && stageHtml.indexOf('css-stageTotal') < stageHtml.indexOf('css-chartWrap'),
      'it sits between the pills row and the chart');
    unmountAll();
  }

  /* ----------------------------------------------------------------- §12 */
  console.log('\n=== 12. cooldown: the button counts down on its own ===');
  {
    api.state = {
      serverNow: Date.now(), growthK: K, cooldownMs: 1000,
      cooldownEndsAt: Date.now() + 1500, cooldownRemainingMs: 1500,
      balance: 90, active: false, round: null,
      lastRound: {
        roundId: 'rCool', betAmount: 10, crashPoint: 1.2, cashedOut: false, cashoutMultiplier: null,
        payout: 0, netProfit: -10, win: false, startedAt: Date.now() - 3000, endedAt: Date.now(), own: true,
      },
      history: [{ roundId: 'rCool', value: 1.2, won: false, at: 'now' }],
    };
    const c10 = mountBoard();
    ok(await waitFor(() => /^Wait \ds$/.test(txt(c10, 'betButton') ?? ''), 2500),
      'the button itself counts the cooldown down', txt(c10, 'betButton'));
    ok(!/Next round available/i.test(c10.textContent || ''),
      'the "Next round available in Ns" sentence is gone completely');
    unmountAll();
  }

  /* ----------------------------------------------------------------- §13 */
  console.log('\n=== 13. round-6 polish (tip dot size, cash-out label) ===');
  {
    const css = readFileSync(resolve(here, '../../src/components/games/crash.module.css'), 'utf8');
    const tip = css.slice(css.indexOf('.tipMarker {'), css.indexOf('.tipMarkerCrashed'));
    ok(/\.tipMarker\s*\{[^}]*width:\s*24px/.test(css), 'tip dot is 24px wide', tip.replace(/\s+/g, ' ').slice(0, 120));
    ok(/\.tipMarker\s*\{[^}]*height:\s*24px/.test(css), 'tip dot is 24px tall');
    ok(/\.tipMarker\s*\{[^}]*transition:\s*background\s+180ms\s+ease/.test(css),
      'its colour change eases in over 180ms');
    ok(!/\n\s*\.tipMarker\s*\{\s*width:\s*21px/.test(css), 'no phone rule shrinks the dot again');
    ok(/\.tipMarkerCrashed\s*\{[^}]*background/.test(css), 'crashed state is still a background swap only');

    const jsx = readFileSync(resolve(here, '../../src/components/games/Crash.jsx'), 'utf8');
    ok(/phase === 'cashedOut'\)\s*\{\s*actionLabel = 'End Animation';/.test(jsx),
      'cash-out turns the button into "End Animation"');
    ok(/actionLabel = 'End Animation';\s*\n\s*actionClass = styles\.stopBtn;/.test(jsx),
      'it keeps the stop button styling');
  }


  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('RUNNER FAILED', e); process.exit(1); });
