/* ============================================================================
 * Site-wide UI suite (jsdom).
 *
 * Covers the things that are not specific to the Crash board:
 *   §1  the "Loss" toast kind (title, card class, icon) — real ToastProvider
 *   §2  games page: filter-row spacing (desktop) + centring (mobile)
 *   §3  admin panel: nothing scrolls sideways on a phone, icon-only row buttons
 *   §4  the hazard badge on the bet button opens the explanation modal —
 *       checked on EVERY game that has a bet button (and the button keeps its
 *       full sidebar width inside the new wrapper)
 *   §5  the app-wide "Scroll up" pill (bottom right, tooltip, mobile offset)
 *   §6  the "bypass disabled games/pages" permission in the UI
 *   §7  filled icons everywhere, the green currency mark, the mobile bottom
 *       nav (white bold labels) and the navbar balance box + today panel
 *
 * Run:  npm run test:ui        (from frontend/)
 * ==========================================================================*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

import { ToastProvider, useToast } from '../../src/context/ToastContext.jsx';
import { ActiveBetProvider } from '../../src/context/ActiveBetContext.jsx';
import { __toasts as stubToasts } from '../stubs/toastContext.jsx';
import { __auth } from '../stubs/authContext.jsx';
import { __site as __siteStatus, __dash } from '../stubs/gamesApi.js';
import { refreshSiteStatus } from '../../src/hooks/useSiteStatus.js';

const here = typeof __TEST_DIR__ === 'string' ? __TEST_DIR__ : process.cwd();

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, timeout = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (cond()) return true;
    await sleep(40);
  }
  return false;
};
const readCss = (rel) => readFileSync(resolve(here, '../..', rel), 'utf8');
const block = (css, header) => {
  const i = css.indexOf(header);
  if (i < 0) return '';
  // pseudo-block for media queries: take the whole rest, the regexes are specific
  return css.slice(i);
};
const firstRule = (css, selector) => {
  const m = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : '';
};

const mounted = [];
const mount = (node) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(node);
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

/* ---------------------------------------------------------------- §1 loss */
function LossTrigger() {
  const toast = useToast();
  return React.createElement(
    'button',
    { className: 'css-lossBtn', onClick: () => toast.loss('You lost 20.00 $ this round') },
    'fire'
  );
}

async function main() {
  console.log('\n=== 1. the "Loss" toast kind ===');
  {
    const host = mount(
      React.createElement(ToastProvider, null, React.createElement(LossTrigger))
    );
    await sleep(120);
    host.querySelector('.css-lossBtn').click();
    const shown = await waitFor(() => !!document.querySelector('.appToast--loss'), 2000);
    ok(shown, 'a loss toast appears');
    const card = document.querySelector('.appToast--loss');
    ok(!!card, 'toast uses the loss variant class', card?.className);
    ok(card?.querySelector('.appToast__title')?.textContent === 'Loss',
      'its title is "Loss", not "Error"', card?.querySelector('.appToast__title')?.textContent);
    ok(/You lost 20\.00 \$/.test(card?.querySelector('.appToast__msg')?.textContent ?? ''),
      'the message is the round result', card?.querySelector('.appToast__msg')?.textContent);
    ok(!!card?.querySelector('.appToast__accent svg'), 'it carries its own icon');
    ok(!document.querySelector('.appToast--error'), 'nothing was rendered as an error');

    const css = readCss('src/context/toast.css');
    ok(/\.appToast--loss\s+\.appToast__accent\s+\.appToast__icon/.test(css), 'loss has its own icon colour');
    ok(/\.appToast--loss\s+\.appToast__progress/.test(css), 'loss has its own progress colour');

    const ctx = readCss('src/context/ToastContext.jsx');
    ok(/loss: <IconTrendDown \/>/.test(ctx), 'the loss icon is a falling chart, not a cross');
    ok(/const loss = \(message, opts\)/.test(ctx) && /title: opts\?\.title \|\| "Loss"/.test(ctx),
      'the provider exposes loss() with a "Loss" default title');

    // the games that used to report a loss as an error
    const rr = readCss('src/components/games/RussianRoulette.jsx');
    ok(!/toast\.error\(`You lost/.test(rr) && (rr.match(/toast\.loss\(/g) || []).length === 2,
      'Russian Roulette reports losses with the Loss kind');
    const crash = readCss('src/components/games/Crash.jsx');
    // Crash is a NO-TOAST game: a lost cash-out race is an outcome, not an
    // error or a loss notification — the board (and the tip dot) say it.
    ok(!/toast\.loss\(/.test(crash) && !/toast\.success\(/.test(crash),
      'Crash raises no win/loss toasts at all');
    ok(/sfx\.play\('win'\)/.test(crash) && /assets\/crash\/Win\.mp3/.test(crash),
      'Cash Out plays assets/crash/Win.mp3 instead');

    unmountAll();
    // clean up any lingering toast container
    await sleep(3200);
  }

  /* ------------------------------------------------- games page filter row */
  console.log('\n=== 2. games page: Search + Sort row ===');
  {
    const css = readCss('src/pages/games.module.css');
    const base = firstRule(css, '.searchFilterRow');
    ok(/margin-top:\s*1[0-9]px/.test(base), 'desktop: the row has breathing room above it', base);
    const mobile = block(css, '@media (max-width: 600px)');
    const rowRule = /\.searchFilterRow\s*\{([^}]*)\}/.exec(mobile)?.[1] ?? '';
    ok(/margin:\s*0 auto/.test(rowRule), 'mobile: the row is centred, not shifted sideways', rowRule);
    ok(!/margin:\s*0 -/.test(rowRule), 'mobile: the old negative-margin offset is gone', rowRule);
    ok(/width:\s*100%/.test(rowRule), 'mobile: it spans the container (same axis as the grid)', rowRule);
    ok(/justify-content:\s*center/.test(rowRule), 'mobile: contents centred in the row', rowRule);
  }

  /* ------------------------------------------------------ admin on phones */
  console.log('\n=== 3. admin panel: no sideways scrolling on a phone ===');
  {
    const css = readCss('src/pages/admin.module.css');
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    ok(mobile.length > 0, 'a phone breakpoint block exists for tables');
    ok(/\.table\s*\{[^}]*overflow:\s*hidden/.test(mobile), 'the table card clips instead of scrolling');
    ok(/\.tableHead\s*\{\s*display:\s*none/.test(mobile), 'column headers are dropped on phones');
    ok(/\.tableRow[^{]*\{[^}]*flex-wrap:\s*wrap/.test(mobile), 'rows wrap into two lines');
    ok(/\.tableRow\s*>\s*div:first-child\s*\{[^}]*flex:\s*1 1 100%/.test(mobile),
      'the first cell owns the whole first line');
    ok(/\.tableActions\s*\{[^}]*margin-left:\s*auto/.test(mobile), 'actions are pushed to the right');
    ok(/\.smallBtn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s.test(mobile), 'row buttons become square tiles');
    ok(/\.btnText\s*\{\s*display:\s*none/.test(mobile), 'their text label is hidden (icon-only)');

    // no rule may force a width wider than a phone any more
    ok(!/min-width:\s*480px/.test(css), 'the old 480px row floor is gone');
    ok(/@media \(min-width: 641px\)[\s\S]*?min-width:\s*520px/.test(css),
      'the wide-screen row floor only applies above the phone breakpoint');

    // the buttons really are icon-only capable + accessible
    const jsx = readCss('src/pages/Admin.jsx');
    ok(/aria-label=\{g\.is_enabled \? "Disable game" : "Enable game"\}/.test(jsx),
      'the game toggle button is labelled for screen readers');
    ok(/aria-label=\{g\.is_mobile_enabled !== 0 \? "Disable mobile" : "Enable mobile"\}/.test(jsx),
      'the mobile toggle button is labelled too');
    ok(/aria-label=\{p\.is_enabled \? "Disable page" : "Enable page"\}/.test(jsx),
      'the page toggle button is labelled too');
    const labels = (jsx.match(/styles\.btnText/g) || []).length;
    ok(labels >= 3, 'every row button wraps its text in the hideable span', String(labels));
    ok((jsx.match(/<IconPower size=\{16\} \/>/g) || []).length >= 2,
      'a (filled) power icon is on the enable/disable buttons');
    ok(/g\.is_mobile_enabled !== 0 \? <IconDeviceMobileSlash size=\{16\} \/> : <IconDeviceMobile size=\{16\} \/>/.test(jsx),
      'the phone icon gets a slash when mobile is on');

    // nothing else in the panel may reintroduce a sideways scrollbar
    const phoneCss = css.slice(css.indexOf('@media (max-width: 640px)'));
    const bases = css.slice(0, css.indexOf('@media (max-width: 640px)'));
    ok(!/overflow-x:\s*(auto|scroll)/.test(phoneCss),
      'no rule after the breakpoint turns a scroller back on', (phoneCss.match(/overflow-x:[^;]+/g) || []).join(' | '));
    const floors = (phoneCss.match(/min-width:\s*(\d+)px/g) || [])
      .map((m) => parseInt(m.match(/(\d+)px/)[1], 10)).filter((n) => n >= 300);
    ok(floors.length === 0, 'no phone-block rule forces a width a phone cannot fit', floors.join(','));
    ok(/overflow-x:\s*auto/.test(bases), 'the desktop table keeps its scroll fallback', '');
    ok(!/\.smallBtn\s*\{[^}]*height:\s*34px/s.test(phoneCss),
      'the 34px text-button sizing no longer squashes the icon tiles');
    ok(/\.smallBtn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s.test(phoneCss),
      'the icon tiles are a comfortable 44x44 tap target');
    ok(/\.smallBtn\s+svg\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/s.test(phoneCss),
      'the icon inside them is 24px (not the 16px inline attribute)');
  }

  /* ------------------------------------------- hazard badge on every game */
  console.log('\n=== 4. the bet-button hazard badge opens the explanation modal ===');
  const games = [
    'Blackjack', 'Crash', 'Dice', 'Flip', 'Keno', 'Limbo', 'Mines', 'Plinko',
    'RPS', 'Roulette', 'RussianRoulette', 'Snakes', 'Tower', 'Wheel',
  ];
  let mountedCount = 0;
  for (const name of games) {
    let Game;
    try {
      ({ default: Game } = await import(`../../src/components/games/${name}.jsx`));
    } catch (e) {
      ok(false, `${name}: module loads`, String(e).slice(0, 160));
      continue;
    }
    // 1) not locked: no badge at all
    let host;
    try {
      host = mount(
        React.createElement(ToastProvider, null,
          React.createElement(ActiveBetProvider, null,
            React.createElement(Game, {
              gameRow: { name: name.toLowerCase(), display_name: name, is_enabled: 1, is_mobile_enabled: 1 },
            })
          )
        )
      );
      await sleep(120);
    } catch (e) {
      ok(false, `${name}: mounts unlocked`, String(e).slice(0, 160));
      unmountAll();
      continue;
    }
    const unlockedBadge = host.querySelector('.ui-hazard-corner');
    const btn = host.querySelector('.css-uitest-bet') || host.querySelector('button');
    ok(!unlockedBadge, `${name}: no hazard badge while the game is enabled`);
    unmountAll();

    // 2) disabled by the admin: badge on the bet button, click → modal
    try {
      host = mount(
        React.createElement(ToastProvider, null,
          React.createElement(ActiveBetProvider, null,
            React.createElement(Game, {
              gameRow: { name: name.toLowerCase(), display_name: name, is_enabled: 0, is_mobile_enabled: 1 },
            })
          )
        )
      );
      await sleep(160);
    } catch (e) {
      ok(false, `${name}: mounts when disabled`, String(e).slice(0, 160));
      unmountAll();
      continue;
    }
    const wrap = host.querySelector('.css-ui-bet-wrap') || host.querySelector('.ui-bet-wrap');
    const badge = host.querySelector('.ui-hazard-corner');
    const lockedBtn = wrap?.querySelector('button');
    ok(!!wrap && !!badge, `${name}: hazard badge sits next to the bet button`);
    ok(lockedBtn?.disabled === true, `${name}: the bet button is disabled`);
    if (badge) {
      badge.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      const card = document.querySelector('.ui-modal-card');
      const heading = document.querySelector('.ui-modal-heading')?.textContent ?? '';
      ok(!!card, `${name}: clicking the badge opens a modal`);
      ok(/disabled/i.test(heading), `${name}: the modal explains why`, heading);
      ok(/ui-modal-icon|ui-modal-head/.test(card?.innerHTML ?? '') || !!card?.querySelector('svg'),
        `${name}: the modal has the hazard icon`);
      // close it again
      const x = document.querySelector('.ui-modal-close') || document.querySelector('.ui-modal-card button');
      x?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(120);
    }
    mountedCount += 1;
    unmountAll();
    await sleep(30);
  }
  ok(mountedCount === games.length, 'every game with a bet button was checked', `${mountedCount}/${games.length}`);

  /* maintenance mode: same badge, maintenance wording, even though the game
     itself is enabled */
  {
    __siteStatus.status = { signup_enabled: true, maintenance_mode: true };
    await refreshSiteStatus();          // push the switch through the shared cache
    const { default: Crash } = await import('../../src/components/games/Crash.jsx');
    const host = mount(
      React.createElement(ToastProvider, null,
        React.createElement(ActiveBetProvider, null,
          React.createElement(Crash, { gameRow: { name: 'crash', display_name: 'Crash', is_enabled: 1, is_mobile_enabled: 1 } })
        )
      )
    );
    ok(await waitFor(() => !!host.querySelector('.ui-hazard-corner'), 2500),
      'maintenance mode shows the badge on an enabled game');
    host.querySelector('.ui-hazard-corner')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(150);
    const heading = document.querySelector('.ui-modal-heading')?.textContent ?? '';
    ok(/maintenance/i.test(heading), 'its modal explains maintenance', heading);
    unmountAll();
    await sleep(200);
    __siteStatus.status = { signup_enabled: true, maintenance_mode: false };
    await refreshSiteStatus();
  }

  // the badge must be a sibling (a disabled button swallows clicks)
  const global = readCss('src/styles/global.css');
  ok(/\.ui-bet-wrap\s*\{[^}]*position:\s*relative/.test(global), '.ui-bet-wrap is a positioned host');
  ok(/\.ui-bet-wrap\s*>\s*button\s*\{[^}]*width:\s*100%/s.test(global),
    'the action button stretches to the wrapper width (no shrink-wrapped button)');
  {
    // …and in the real DOM the button really is a direct child of the wrapper
    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100 };
    const { default: Dice } = await import('../../src/components/games/Dice.jsx');
    const host = mount(
      React.createElement(ToastProvider, null,
        React.createElement(ActiveBetProvider, null,
          React.createElement(Dice, { gameRow: { name: 'dice', display_name: 'Dice', is_enabled: 1, is_mobile_enabled: 1 } })
        )
      )
    );
    await sleep(160);                       // let React flush the tree
    const wrap = host.querySelector('.css-ui-bet-wrap') || host.querySelector('.ui-bet-wrap');
    ok(!!wrap, 'the wrapper is rendered', host.innerHTML.slice(0, 120));
    ok(!!wrap?.querySelector(':scope > button'),
      'the bet button is a direct child of .ui-bet-wrap (so width:100% lands on it)');
    ok(wrap?.children.length === 1,
      'nothing else sits in the wrapper next to the button while betting is allowed',
      String(wrap?.children.length));
    unmountAll();
  }

  const badgeSrc = readCss('src/components/common/BetLockBadge.jsx');
  ok(/<HazardBadge corner/.test(badgeSrc) && /<Modal/.test(badgeSrc),
    'BetLockBadge renders the badge + the shared Modal');
  ok(/description=\{body\}/.test(badgeSrc), 'the modal uses the same icon/title/description anatomy');

  /* ------------------------------------------------------- §5 scroll up pill */
  console.log('\n=== 5. the app-wide "Scroll up" pill ===');
  {
    const css = readCss('src/components/common/BackToTop.module.css');
    const rule = firstRule(css, '.backToTop');
    ok(/position:\s*fixed/.test(rule), 'it is pinned to the viewport');
    ok(/right:\s*18px/.test(rule), 'it sits in the bottom-RIGHT corner', rule.replace(/\s+/g, ' ').slice(0, 90));
    ok(/bottom:\s*18px/.test(rule), 'and at the bottom edge');
    ok(!/^\s*left:/m.test(css) || /right:\s*14px/.test(css), 'it is never anchored to the left edge');
    ok(/border-radius:\s*999px/.test(rule), 'it is a pill', rule.replace(/\s+/g, ' ').slice(0, 120));
    ok(/transform:\s*translateY\(28px\)/.test(rule), 'it starts parked below the fold', '');
    ok(/\.backToTop\.visible\s*\{[^}]*translateY\(0\)/s.test(css), 'and slides up into view');

    // tooltip: same white plate as the game-toolbar icon buttons, PC only
    const toolbar = firstRule(readCss('src/pages/games.module.css'), '.toolBtn::after');
    const hover = css.slice(css.indexOf('@media (hover: hover) and (pointer: fine)'));
    const tip = firstRule(hover, '.backToTop::after');
    ok(/content:\s*attr\(data-tip\)/.test(tip), 'the tooltip text comes from data-tip');
    for (const prop of ['background: #fff', 'color: #0f212e', 'font-size: 12px', 'font-weight: 700',
      'padding: 4px 8px', 'border-radius: 4px', 'white-space: nowrap']) {
      ok(new RegExp(prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ';?').test(toolbar), `toolbar tooltip uses ${prop}`, toolbar.replace(/\s+/g, ' '));
      ok(new RegExp(prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ';?').test(tip), `the pill tooltip matches: ${prop}`, tip.replace(/\s+/g, ' '));
    }
    ok(/\.backToTop:hover::after\s*\{\s*opacity:\s*1/s.test(hover), 'it appears on hover');
    ok(/@media \(hover: hover\) and \(pointer: fine\)/.test(css), 'and only on devices that really hover (a PC)');

    // mobile: above the fixed bottom navigation bar
    const phone = css.slice(css.indexOf('@media (max-width: 1024px)'));
    ok(/\.backToTop\s*\{[^}]*bottom:\s*calc\(64px/.test(phone),
      'on phones it floats above the 64px bottom nav', phone.slice(0, 140).replace(/\s+/g, ' '));

    const jsx = readCss('src/components/common/BackToTop.jsx');
    ok(/data-tip="Scroll up"/.test(jsx) && /aria-label="Scroll up"/.test(jsx),
      'the label is "Scroll up" (tooltip + screen readers)');
    ok(/<IconArrowUp \/>/.test(jsx) && /IconArrowUp = createIcon\("IconArrowUp", "[^"]+"\); \/\/ arrow-up-bold/.test(readCss('src/components/common/Icons.jsx')),
      'the icon is a solid (bold, filled-path) arrow pointing up');
    ok(/SHOW_AFTER = 300/.test(jsx) && /window\.scrollY > SHOW_AFTER/.test(jsx),
      'it only appears once the user actually scrolls down');
    ok(/window\.addEventListener\("scroll"/.test(jsx) && /removeEventListener\("scroll"/.test(jsx),
      'the scroll listener is cleaned up');
    ok(/scrollTo\(\{ top: 0, behavior: "smooth" \}\)/.test(jsx), 'clicking it scrolls back to the top');

    const app = readCss('src/App.jsx');
    ok(/<BackToTop \/>/.test(app), 'App renders the pill for every route');

    // no page may carry a second, competing back-to-top button
    const betJsx = readCss('src/components/customBets/Pages/Bet.jsx');
    const betCss = readCss('src/components/customBets/Pages/Bet.module.css');
    ok(!/backTop/.test(betJsx) && !/backTop/.test(betCss),
      'the custom-bets page dropped its duplicate back-to-top (one pill per page)');

    // --- behaviour in the DOM
    const { default: BackToTop } = await import('../../src/components/common/BackToTop.jsx');
    let scrolled = null;
    window.scrollTo = (opts) => { scrolled = opts; };
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });

    const host = mount(React.createElement(BackToTop));
    await sleep(80);
    ok(!host.querySelector('button'), 'it is not rendered while the page is at the top');

    window.scrollY = 900;
    window.dispatchEvent(new window.Event('scroll'));
    ok(await waitFor(() => /visible/.test(host.querySelector('button')?.className ?? ''), 1500),
      'scrolling down brings it in');
    const pill = host.querySelector('button');
    ok(pill?.getAttribute('data-tip') === 'Scroll up', 'it carries the tooltip text', pill?.getAttribute('data-tip'));
    pill.click();
    ok(scrolled && scrolled.top === 0 && scrolled.behavior === 'smooth', 'clicking scrolls to the top', JSON.stringify(scrolled));

    window.scrollY = 0;
    window.dispatchEvent(new window.Event('scroll'));
    ok(await waitFor(() => !host.querySelector('button'), 1500), 'scrolling back to the top hides it again');
    unmountAll();
  }

  /* ------------------------------------------------- §6 bypass permission */
  console.log('\n=== 6. the "bypass disabled games/pages" permission ===');
  {
    const { default: Dice } = await import('../../src/components/games/Dice.jsx');
    const row = { name: 'dice', display_name: 'Dice', is_enabled: 0, is_mobile_enabled: 1 };
    const mountDice = () => mount(
      React.createElement(ToastProvider, null,
        React.createElement(ActiveBetProvider, null, React.createElement(Dice, { gameRow: row }))
      )
    );

    // a normal player: the game is locked
    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100 };
    let host = mountDice();
    await sleep(120);
    ok(await waitFor(() => !!host.querySelector('.ui-hazard-corner'), 2000),
      'a player without the permission gets the hazard badge');
    ok(host.querySelector('.ui-bet-wrap > button')?.disabled === true, 'and a disabled bet button');
    unmountAll();

    // the permission holder: nothing is locked
    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100, can_bypass_disabled: 1 };
    host = mountDice();
    await sleep(120);
    ok(!host.querySelector('.ui-hazard-corner'), 'a permission holder sees no badge on a disabled game');
    ok(host.querySelector('.ui-bet-wrap > button')?.disabled === false, 'and can press the bet button');
    unmountAll();

    // the owner always has it
    __auth.user = { id: 1, username: 'owner', role: 'owner', balance: 100 };
    host = mountDice();
    await sleep(120);
    ok(!host.querySelector('.ui-hazard-corner'), 'the owner bypasses disabled games too');
    unmountAll();
    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100 };

    // the games grid must not call a bypassable game "Unavailable"
    const games = readCss('src/pages/Games.jsx');
    ok(/canBypassDisabled = user\?\.role === "owner" \|\| Boolean\(user\?\.can_bypass_disabled\)/.test(games),
      'the games grid reads the permission');
    ok(/!isImplemented \|\| \(!Boolean\(game\.is_enabled\) && !canBypassDisabled\)/.test(games),
      'and only marks a game Unavailable when the player cannot bypass it');

    // the backend: the same rule, everywhere a game is checked
    const access = readCss('../backend/src/services/gameAccess.js');
    ok(/function canBypassUser\(user\)/.test(access) && /user\.role === "owner"/.test(access),
      'the backend has one bypass rule (owner or the explicit permission)');
    ok(/AsyncLocalStorage/.test(access), 'it travels with the request instead of a global flag');
    const engine = readCss('../backend/src/services/gameEngine.js');
    ok(!/!game\.is_enabled/.test(engine), 'every engine check goes through isGameBlocked()');
    ok((engine.match(/isGameBlocked\(game\)/g) || []).length >= 17,
      'all of them, in all games', String((engine.match(/isGameBlocked\(game\)/g) || []).length));
    const crash = readCss('../backend/src/services/crashHandler.js');
    ok(/if \(isGameBlocked\(game\)\) return fail\(res, 403/.test(crash),
      'crash honours the permission on its own start route');
    const auth = readCss('../backend/src/middleware/auth.js');
    ok(/runWithGameAccess\(canBypassUser\(user\)/.test(auth),
      'authenticateToken opens the scope for the whole request');
  }


  /* ------------------------ §7 filled icons, currency mark, nav + balance */
  console.log('\n=== 7. filled icons, the currency mark, bottom nav + balance box ===');
  {
    const SRC = resolve(here, '../../src');
    const rel = (p) => relative(SRC, p);
    // dead code that nothing imports (see README) is not part of the live UI
    const DEAD = /[/\\](autobet|stocks)[/\\]|components[/\\]dashboard[/\\]|Poker/;
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const files = walk(SRC).filter((p) => !DEAD.test(p));
    const jsxFiles = files.filter((p) => /\.jsx?$/.test(p));
    const cssFiles = files.filter((p) => /\.css$/.test(p));
    const read = (p) => readFileSync(p, 'utf8');
    const global = readCss('src/styles/global.css');

    // --- 7a: no outlined icon survives anywhere in the live UI
    const outlined = jsxFiles.filter((p) => {
      const t = read(p);
      return /fill="none"\s+stroke="currentColor"/.test(t)
        || /<(path|line|polyline|rect|circle)\b[^>]*\bstroke="currentColor"/.test(t)
        || /<svg\b[^>]*\bstrokeWidth=/.test(t);
    });
    ok(outlined.length === 0, 'no outlined (stroke-drawn) icon is left in any component', outlined.map(rel).join(', '));
    const forced = cssFiles.filter((p) => /svg\s*\{[^}]*(fill:\s*none|stroke:\s*currentColor)/.test(read(p)));
    ok(forced.length === 0, 'no stylesheet forces fill:none / stroke on icon svgs', forced.map(rel).join(', '));
    const strokedUris = cssFiles.filter((p) => /data:image\/svg\+xml[^")]*stroke=/.test(read(p)));
    ok(strokedUris.length === 0, 'CSS data-URI icons (select carets, maintenance badge) are filled too', strokedUris.map(rel).join(', '));

    // --- 7b: the shared icon set: every icon is a solid currentColor shape
    const iconsSrc = readCss('src/components/common/Icons.jsx');
    ok(!/stroke/i.test(iconsSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'the icon module contains no strokes at all');
    ok(/Phosphor Icons/.test(iconsSrc) && /MIT License/.test(iconsSrc), 'the icon source + licence are credited');
    const Icons = await import('../../src/components/common/Icons.jsx');
    const names = Object.keys(Icons).filter((k) => /^Icon[A-Z]/.test(k));
    ok(names.length >= 50, 'the set covers the whole site', String(names.length));
    {
      const host = mount(React.createElement('div', null, names.map((n) => React.createElement(Icons[n], { key: n }))));
      await sleep(60);
      const svgs = [...host.querySelectorAll('svg')];
      const bad = svgs.filter((svg) => svg.getAttribute('fill') !== 'currentColor'
        || svg.querySelectorAll('path').length !== 1
        || !(svg.querySelector('path')?.getAttribute('d') || '').length
        || svg.querySelector('[stroke]'));
      ok(svgs.length === names.length && bad.length === 0, 'every icon renders ONE filled currentColor path',
        bad.map((b) => b.getAttribute('data-icon')).join(','));
      ok(svgs.every((svg) => svg.getAttribute('aria-hidden') === 'true'), 'icons are decorative by default (aria-hidden)');
      unmountAll();
    }

    // --- 7c: the currency mark: green disc with the "$" cut out
    const { default: CurrencyIcon, CURRENCY_COLOR } = await import('../../src/components/common/CurrencyIcon.jsx');
    {
      const host = mount(React.createElement('div', null,
        React.createElement(CurrencyIcon),
        React.createElement(CurrencyIcon, { size: 20, className: 'extra' })));
      await sleep(40);
      const [a, b] = host.querySelectorAll('svg');
      const path = a?.querySelector('path');
      ok(a?.classList.contains('currency-icon') && a?.getAttribute('viewBox') === '0 0 24 24', 'CurrencyIcon renders the 24x24 mark');
      ok(CURRENCY_COLOR.toUpperCase() === '#25E801' && path?.getAttribute('fill')?.toUpperCase() === '#25E801', 'it is #25E801 green');
      ok(path?.getAttribute('fill-rule') === 'evenodd' && (path?.getAttribute('d').match(/Z/g) || []).length === 2,
        'the "$" is a HOLE in the disc (two contours, even-odd), not paint on top');
      ok(b?.classList.contains('extra') && b?.style.width === '20px' && b?.style.height === '20px', 'size + className props work');
      unmountAll();
    }
    ok(/--color-currency:\s*#25E801/i.test(global) && /\.currency-icon path\s*\{\s*fill:\s*var\(--color-currency\)/.test(global),
      'one token drives the colour of every currency mark');

    // --- 7d: no "$" glyph is used as the currency icon any more
    const moneyFiles = jsxFiles.filter((p) => /[/\\](games|layout)[/\\]|pages[/\\](Home|Dashboard|Admin)\.jsx$/.test(p));
    const glyphs = moneyFiles.filter((p) => { const t = read(p); return />\s*\$\s*<\//.test(t) || /\}\s+\$<\//.test(t); });
    ok(glyphs.length === 0, 'no "$" text glyph stands in for the currency icon', glyphs.map(rel).join(', '));
    {
      __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100 };
      const { default: Dice } = await import('../../src/components/games/Dice.jsx');
      const host = mount(
        React.createElement(ToastProvider, null,
          React.createElement(ActiveBetProvider, null,
            React.createElement(Dice, { gameRow: { name: 'dice', display_name: 'Dice', is_enabled: 1, is_mobile_enabled: 1 } })))
      );
      await sleep(160);
      const coins = host.querySelectorAll('svg.currency-icon');
      ok(coins.length >= 2, 'the game sidebar shows the green mark (bet amount + profit)', String(coins.length));
      const bare = [...host.querySelectorAll('span, div')].filter((el) => !el.children.length && el.textContent.trim() === '$');
      ok(bare.length === 0, 'and no bare "$" is left in it', String(bare.length));
      unmountAll();
    }

    // --- 7e: blackjack action icons use their signature colours
    // (Hit orange, Stand purple — Split/Double stay white)
    const bj = readCss('src/components/games/blackjack.module.css');
    const bjHit = firstRule(bj, '.actionHit .actionIcon');
    const bjStand = firstRule(bj, '.actionStand .actionIcon');
    ok(/invert\(67%\)/.test(bjHit) && /hue-rotate\(360deg\)/.test(bjHit),
      'Blackjack: Hit icon is orange #ff9d00');
    ok(/invert\(18%\)/.test(bjStand) && /hue-rotate\(265deg\)/.test(bjStand),
      'Blackjack: Stand icon is purple #9000ff');
    ok(/filter:\s*brightness\(0\) invert\(1\)/.test(firstRule(bj, '.actionSplit .actionIcon'))
      && /filter:\s*brightness\(0\) invert\(1\)/.test(firstRule(bj, '.actionDouble .actionIcon')),
      'Blackjack: Split / Double icons stay white');
    ok(/filter:\s*brightness\(0\) invert\(1\)/.test(firstRule(readCss('src/components/games/RPS.module.css'), '.choiceSmallIcon')),
      'RPS: the rock / paper / scissors marks are white');
    const flipCss = readCss('src/components/games/flip.module.css');
    ok(/background:\s*var\(--color-text-primary\)/.test(firstRule(flipCss, '.dotHeads'))
      && /background:\s*var\(--color-text-primary\)/.test(firstRule(flipCss, '.dotTails')), 'Flip: the heads / tails markers are white');
    ok(/\.multSuffix\s*\{\s*composes:\s*sidebar-input-suffix from global/.test(readCss('src/components/games/crash.module.css'))
      && /color:\s*var\(--color-text-primary\)/.test(firstRule(global, '.sidebar-input-suffix')), "Crash: the × suffix is plain white");
    ok(!/--bitcoin|--accent-warning|color:/.test(firstRule(global, '.sidebar-currency-icon')), 'the sidebar currency slot is no longer orange');

    // --- 7f: mobile bottom nav — labels always white + bold, only icons change
    const bn = readCss('src/components/layout/BottomNav.module.css');
    const label = firstRule(bn, '.label');
    ok(/color:\s*var\(--color-text-primary\)/.test(label), 'bottom-nav labels are always white');
    ok(/font-weight:\s*700/.test(label) && /-webkit-text-stroke:\s*0\.25px currentColor/.test(label), 'and bold (heaviest face + hairline)');
    ok(!/\.(tabActive|tab:hover|tab:active)[^{]*\.label/.test(bn), 'no tab state re-colours the label');
    ok(/color:\s*var\(--color-text-secondary\)/.test(firstRule(bn, '.tab'))
      && /color:\s*var\(--color-text-primary\)/.test(firstRule(bn, '.tabActive')), 'the icon goes secondary -> white on the active tab');
    ok(!/fill:\s*none/.test(bn) && !/(^|[^-])stroke:/.test(bn.replace(/-webkit-text-stroke[^;]*;/g, '')), 'no outline styling on the tab icons');
    const { MemoryRouter, useLocation } = await import('react-router-dom');
    {
      const { default: BottomNav } = await import('../../src/components/layout/BottomNav.jsx');
      const host = mount(React.createElement(MemoryRouter, { initialEntries: ['/games/dice'] }, React.createElement(BottomNav)));
      await sleep(100);
      const tabs = [...host.querySelectorAll('nav button')];
      ok(tabs.length === 4, 'a player sees Home, Casino, Dashboard, Custom Bets', String(tabs.length));
      const active = tabs.filter((b) => b.getAttribute('aria-current') === 'page');
      ok(active.length === 1 && /Casino/.test(active[0].textContent), 'Casino is active on a game route');
      ok(tabs.every((b) => b.querySelector('svg[fill="currentColor"][data-icon]') && !b.querySelector('[stroke]')), 'every tab icon is filled');
      const labelClasses = new Set(tabs.map((b) => b.lastElementChild?.className));
      ok(labelClasses.size === 1, 'active and inactive labels share one class (same white, bold look)', [...labelClasses].join('|'));
      unmountAll();
    }

    // --- 7g: navbar balance box
    const navSrc = readCss('src/components/layout/Navigation.jsx');
    ok(/<BalanceBox \/>/.test(navSrc) && !/styles\.balanceLabel/.test(navSrc), 'the navbar renders the new balance box (readonly field gone)');
    const bcss = readCss('src/components/layout/balanceBox.module.css');
    const boxRule = firstRule(bcss, '.box');
    ok(/border:\s*none/.test(boxRule) && /box-shadow:\s*none/.test(boxRule), 'the box has no border and no shadow');
    ok(/border-radius:\s*var\(--radius-md\)/.test(boxRule), 'its corners are slightly rounded (8px)');
    ok(/background:\s*var\(--color-balance-box-bg\)/.test(firstRule(bcss, '.balanceBtn'))
      && /--color-balance-box-bg:\s*#102230/i.test(global), 'the amount side is #102230');
    ok(/background:\s*var\(--color-balance-wallet-bg\)/.test(firstRule(bcss, '.walletBtn'))
      && /--color-balance-wallet-bg:\s*#2874E1/i.test(global), 'the wallet side is #2874E1');
    const minW = Number((/min-width:\s*(\d+)px/.exec(firstRule(bcss, '.balanceBtn')) || [])[1]);
    const walletW = Number((/width:\s*(\d+)px/.exec(firstRule(bcss, '.walletBtn')) || [])[1]);
    const share = minW / (minW + walletW);
    ok(share >= 0.6 && share <= 0.72, 'the amount side takes ~60-70% of the box', share.toFixed(2));
    ok(/@media \(max-width: 768px\)/.test(bcss) && /@media \(max-width: 380px\)/.test(bcss) && /@media \(max-width: 480px\)/.test(bcss),
      'it has phone breakpoints (and a full-width panel on small phones)');

    const { default: BalanceBox } = await import('../../src/components/layout/BalanceBox.jsx');
    let where = '';
    function Where() { where = useLocation().pathname; return null; }
    const sqlAgo = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
    const TODAY = {
      since: new Date().toISOString(), bets: 6, wagered: 9.5, payout: 12, profit: 2.5,
      recent: [
        { id: 6, game_name: 'limbo', game_display_name: 'Limbo', bet_amount: 2, payout_amount: 0, profit: -2, multiplier: 0, created_at: sqlAgo(120000) },
        { id: 5, game_name: 'dice', game_display_name: 'Dice', bet_amount: 1.5, payout_amount: 3, profit: 1.5, multiplier: 2, created_at: sqlAgo(3 * 3600000) },
        { id: 4, game_name: 'mines', game_display_name: 'Mines', bet_amount: 1, payout_amount: 1, profit: 0, multiplier: 1, created_at: sqlAgo(10000) },
      ],
    };
    const mountBox = () => mount(React.createElement(MemoryRouter, { initialEntries: ['/games/dice'] },
      React.createElement(BalanceBox), React.createElement(Where)));
    const q = (host, id) => host.querySelector(`[data-testid="${id}"]`);

    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 1234.5 };
    __dash.calls.length = 0;
    __dash.fail = false;
    __dash.today = TODAY;
    {
      const host = mountBox();
      await sleep(80);
      const toggle = q(host, 'balance-toggle');
      ok(!!toggle && /1,234\.50/.test(toggle.textContent), 'the amount side shows the balance', toggle?.textContent);
      const order = [...(toggle?.children || [])].map((el) => el.getAttribute('data-icon') || el.querySelector('svg')?.getAttribute('data-icon') || 'amount');
      ok(order.join('>') === 'amount>CurrencyIcon>IconCaretDown', 'amount, then the currency mark, then the small dropdown caret', order.join('>'));
      const wallet = q(host, 'balance-wallet');
      ok(!!wallet?.querySelector('svg[data-icon="IconWallet"]'), 'the right part is a wallet button');
      ok(!q(host, 'balance-panel') && toggle.getAttribute('aria-expanded') === 'false', 'the panel starts closed');
      ok(__dash.calls.length === 0, 'nothing is fetched until it is opened');

      toggle.click();
      ok(await waitFor(() => !!q(host, 'balance-recent'), 2000), "opening it loads today's activity");
      ok(toggle.getAttribute('aria-expanded') === 'true', 'the toggle reports it is open');
      const mid = new Date(); mid.setHours(0, 0, 0, 0);
      ok(__dash.calls.length === 1 && __dash.calls[0]?.since === mid.toISOString(),
        '"today" starts at the LOCAL midnight', JSON.stringify(__dash.calls));
      const panel = q(host, 'balance-panel');
      ok(/\+2\.50/.test(q(host, 'balance-profit')?.textContent), "today's profit, signed", q(host, 'balance-profit')?.textContent);
      ok(/9\.50/.test(q(host, 'balance-wagered')?.textContent) && /6 bets/.test(q(host, 'balance-wagered')?.textContent),
        "today's wagered amount (and bet count)", q(host, 'balance-wagered')?.textContent);
      const rows = [...panel.querySelectorAll('[data-testid="balance-recent"] li')];
      ok(rows.length === 3, 'the 3 most recent bets are listed', String(rows.length));
      ok(/Limbo/.test(rows[0]?.textContent) && /\u22122\.00/.test(rows[0]?.textContent) && /0\.00×/.test(rows[0]?.textContent)
        && /2m ago/.test(rows[0]?.textContent) && /Bet 2\.00/.test(rows[0]?.textContent),
        'each row: game, result, multiplier, time, stake', rows[0]?.textContent);
      ok(/\+1\.50/.test(rows[1]?.textContent) && /3h ago/.test(rows[1]?.textContent), 'wins read as +, older ones in hours', rows[1]?.textContent);
      ok(/just now/.test(rows[2]?.textContent), 'and a moment ago reads "just now"', rows[2]?.textContent);
      ok(panel.querySelectorAll('svg.currency-icon').length >= 5, 'amounts carry the green currency mark');
      ok(!panel.querySelector('input'), 'no readonly-input look: the panel has no inputs at all');

      panel.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      await sleep(60);
      ok(!!q(host, 'balance-panel'), 'pressing inside the panel keeps it open');
      document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      ok(await waitFor(() => !q(host, 'balance-panel'), 1000), 'pressing outside closes it');

      toggle.click();
      ok(await waitFor(() => __dash.calls.length === 2, 1000), 'reopening fetches fresh numbers');
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ok(await waitFor(() => !q(host, 'balance-panel'), 1000), 'Escape closes it');

      toggle.click();
      await waitFor(() => !!q(host, 'balance-panel'), 1000);
      wallet.click();
      ok(await waitFor(() => where === '/dashboard', 1000), 'the wallet button opens the Dashboard', where);
      ok(await waitFor(() => !q(host, 'balance-panel'), 1000), 'and navigating away closes the panel');
      unmountAll();
    }
    {
      // failure -> message + Retry; retry recovers
      __dash.fail = true;
      const host = mountBox();
      await sleep(60);
      q(host, 'balance-toggle').click();
      ok(await waitFor(() => /Stats are down/.test(q(host, 'balance-panel')?.textContent || ''), 1500), 'a failed load says so');
      const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      ok(!!retry, 'and offers Retry');
      __dash.fail = false;
      retry?.click();
      ok(await waitFor(() => !!q(host, 'balance-recent'), 1500), 'Retry loads the stats');
      unmountAll();
    }
    {
      // a new player: zeros + a friendly empty state
      __dash.today = { since: TODAY.since, bets: 0, wagered: 0, payout: 0, profit: 0, recent: [] };
      const host = mountBox();
      await sleep(60);
      q(host, 'balance-toggle').click();
      ok(await waitFor(() => /No bets yet/.test(q(host, 'balance-panel')?.textContent || ''), 1500), 'no bets -> an empty state, not a blank list');
      ok(/0\.00/.test(q(host, 'balance-profit')?.textContent) && !/[+\u2212]/.test(q(host, 'balance-profit')?.textContent),
        'zero profit is unsigned', q(host, 'balance-profit')?.textContent);
      unmountAll();
    }
    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100 };
    __dash.today = null;
  }

  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('RUNNER FAILED', e); process.exit(1); });
