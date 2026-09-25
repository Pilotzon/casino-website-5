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
 *   §8  Round 10: the shared win popup, the history pills, Limbo's digit
 *       slots, rows that lock mid-bet (Limbo / Dice / steppers), the Mines
 *       end-of-round board, Blackjack (deal order, totals, push outline) and
 *       the multi-flip Coin Flip round
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
import { __site as __siteStatus, __dash, __api } from '../stubs/gamesApi.js';
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

    // --- 7e: sidebar icons are white — except Blackjack's coloured action icons (Round 10)
    const bj = readCss('src/components/games/blackjack.module.css');
    ok(/hue-rotate\(360deg\)/.test(firstRule(bj, '.actionHit .actionIcon'))
      && /hue-rotate\(265deg\)/.test(firstRule(bj, '.actionStand .actionIcon'))
      && /\.actionSplit \.actionIcon,\s*\.actionDouble \.actionIcon\s*\{\s*filter:\s*brightness\(0\) invert\(1\)/.test(bj),
      'Blackjack: Hit is orange, Stand purple, Split / Double white (the old coloured icons are back)');
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


  /* ------------------------------------------------------------ §8 Round 10 */
  console.log('\n=== 8. Round 10: win popup, history pills, locked rows, Mines, Blackjack, Flip ===');
  {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const btnIn = (host, re) => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
    const mountGame = (Game, name) => mount(
      React.createElement(ToastProvider, null,
        React.createElement(ActiveBetProvider, null,
          React.createElement(Game, { gameRow: { name, display_name: name, is_enabled: 1, is_mobile_enabled: 1 } })))
    );
    const g8 = readCss('src/styles/global.css');
    __auth.user = { id: 1, username: 'tester', role: 'user', balance: 100 };

    // --- 8a: the shared win popup
    const { default: WinPopup, formatPopupMultiplier } = await import('../../src/components/common/WinPopup.jsx');
    {
      const host = mount(React.createElement(WinPopup, { multiplier: 3.964, amount: 12.5 }));
      await sleep(20);
      const pop = host.querySelector('[data-win-popup]');
      ok(pop?.dataset.winPopup === 'win' && pop.classList.contains('ui-win-popup'), 'win popup: the shared overlay, tone "win"');
      const kids = pop ? [...pop.children].map((c) => c.className).join('|') : '';
      ok(kids === 'ui-win-popup-multiplier|ui-win-popup-divider|ui-win-popup-amount', 'multiplier on top, the divider, then the amount', kids);
      ok(pop?.querySelector('.ui-win-popup-multiplier').textContent === '3.96×', 'the multiplier reads 3.96×');
      ok(pop?.querySelector('.ui-win-popup-amount span').textContent === '12.50' && !!pop.querySelector('.ui-win-popup-amount svg.currency-icon'),
        'the amount won + the green currency mark');
      unmountAll();
      const h2 = mount(React.createElement(React.Fragment, null,
        React.createElement(WinPopup, { multiplier: 1, amount: 5, tone: 'push' }),
        React.createElement(WinPopup, { multiplier: 0, amount: 5, tone: 'lose', amountPrefix: '-' })));
      await sleep(20);
      const [push, lose] = h2.querySelectorAll('[data-win-popup]');
      ok(push?.classList.contains('ui-win-popup--push') && lose?.classList.contains('ui-win-popup--lose'), 'push / lose tones (Blackjack)');
      ok(lose?.querySelector('.ui-win-popup-multiplier').textContent === '0.00×' && lose.querySelector('.ui-win-popup-amount span').textContent === '-5.00',
        'a loss reads 0.00× / -5.00');
      ok(formatPopupMultiplier(NaN) === '0.00×' && formatPopupMultiplier(2) === '2.00×', 'formatPopupMultiplier guards bad input');
      unmountAll();
      const pr = firstRule(g8, '.ui-win-popup');
      ok(/background:\s*var\(--color-win-popup-bg\)/.test(pr) && /border:\s*3px solid var\(--color-win-popup-border\)/.test(pr),
        'popup: #1A3242 fill, thicker (3px) green border');
      ok(/--color-win-popup-bg:\s*#1A3242/i.test(g8) && /--color-win-popup-divider:\s*#415B69/i.test(g8)
        && /background:\s*var\(--color-win-popup-divider\)/.test(firstRule(g8, '.ui-win-popup-divider')), 'tokens: #1A3242 fill, #415B69 divider');
      const games12 = ['Blackjack', 'Dice', 'Flip', 'Keno', 'Limbo', 'Mines', 'RPS', 'Roulette', 'RussianRoulette', 'Snakes', 'Tower', 'Wheel'];
      const stale = games12.filter((n) => { const t = readCss(`src/components/games/${n}.jsx`); return !/<WinPopup\b/.test(t) || /YOU WON/.test(t); });
      ok(stale.length === 0, 'all 12 games with a win show the shared popup (no "YOU WON" markup left)', stale.join(', '));
    }

    // --- 8b: history pills — one component, Crash's system
    const { default: HistoryPills } = await import('../../src/components/common/HistoryPills.jsx');
    {
      const host = mount(React.createElement(HistoryPills, { items: [{ key: 'b', label: '2.00×', won: true }, { key: 'a', label: '0.50×', won: false }] }));
      await sleep(20);
      const pills = [...host.querySelectorAll('[data-history-pills] .css-histPill')];
      ok(pills.map((x) => x.textContent).join(' ') === '2.00× 0.50×' && pills[0].classList.contains('css-histGreen') && pills[1].classList.contains('css-histGray'),
        'history pills: newest first, green = won, gray = lost');
      unmountAll();
      ok(/direction:\s*rtl/.test(firstRule(readCss('src/components/common/historyPills.module.css'), '.historyScroll')),
        'the scroller itself runs right-to-left (newest pinned right; older rounds scroll)');
      const users = ['Crash', 'Wheel', 'Dice', 'Limbo'].filter((n) => /import HistoryPills from/.test(readCss(`src/components/games/${n}.jsx`)));
      ok(users.length === 4, 'Crash, Wheel, Dice and Limbo share the one pill row', users.join(','));
    }

    // --- 8c: a disabled stepper stays (dimmed) instead of vanishing
    const { default: Stepper } = await import('../../src/components/common/Stepper.jsx');
    {
      const host = mount(React.createElement(Stepper, { value: '1', onChange: () => {}, disabled: true }));
      await sleep(20);
      const b = [...host.querySelectorAll('.ui-stepper button')];
      ok(!!host.querySelector('.ui-stepper--disabled') && b.length === 2 && b.every((x) => x.disabled), 'a disabled stepper stays put, dimmed and inert');
      unmountAll();
    }

    // --- 8d: Limbo — digit slots, locked row, pills, popup
    {
      __api.limbo = { success: true, result: { multiplier: 1234.56, won: true, payout: 2, balance: 101 }, round: { round_uuid: 'limbo-u1' } };
      __api.delay.limbo = 150;
      const { default: Limbo } = await import('../../src/components/games/Limbo.jsx');
      const host = mountGame(Limbo, 'limbo');
      await sleep(80);
      setVal(host.querySelector('input[type=number]'), '1');
      await sleep(30);
      btnIn(host, /^Bet$/).click();
      await sleep(50);
      const row = host.querySelector('.ui-stats-locked');
      ok(!!row && [...row.querySelectorAll('input')].every((i) => i.disabled), 'Limbo: the bottom row locks (inputs disabled) mid-bet');
      ok(await waitFor(() => !!host.querySelector('[data-limbo-number="1234.56×"]'), 3000), 'the result counts up to 1234.56×');
      const digits = host.querySelectorAll('[data-limbo-number] .css-slotDigit').length;
      ok(digits === 6, 'one fixed-width slot per digit (6 for 1234.56)', String(digits));
      ok(await waitFor(() => !host.querySelector('.ui-stats-locked'), 1500), 'the row unlocks once the round is over');
      ok(/1234\.56×/.test(host.querySelector('[data-history-pills]')?.textContent || ''), 'the round lands in the top history pills');
      ok(/2\.00×/.test(host.querySelector('[data-win-popup="win"]')?.textContent || ''), 'the win popup shows the multiplier won (the target)');
      const lc = firstRule(readCss('src/components/games/limbo.module.css'), '.slotDigit');
      ok(/width:\s*1ch/.test(lc) && /tabular-nums/.test(lc), 'digit slots: 1ch wide, tabular figures');
      __api.delay.limbo = 0;
      unmountAll();
    }

    // --- 8e: Dice — the row locks mid-bet, the hexagon lands green, pills
    {
      __api.dice = { success: true, result: { roll: 73.5, won: true, payout: 1.98, multiplier: 1.98, balance: 100.98 }, round: { round_uuid: 'dice-u1' } };
      __api.delay.dice = 200;
      const { default: Dice } = await import('../../src/components/games/Dice.jsx');
      const host = mountGame(Dice, 'dice');
      await sleep(80);
      setVal(host.querySelector('input[type=number]'), '1');
      await sleep(30);
      btnIn(host, /^Bet$/).click();
      await sleep(50);
      const panel = host.querySelector('.ui-stats-locked');
      ok(!!panel && [...panel.querySelectorAll('input')].every((i) => i.disabled), 'Dice: the bottom row locks (inputs disabled) mid-bet');
      ok(!!panel && [...panel.querySelectorAll('.ui-stepper button')].length > 0 && [...panel.querySelectorAll('.ui-stepper button')].every((b) => b.disabled),
        'its steppers stay visible but disabled');
      ok(host.querySelector('[data-dice-cube]')?.dataset.tone === 'moving', 'the hexagon is in its "moving" (gray) state');
      ok(await waitFor(() => host.querySelector('[data-dice-cube]')?.dataset.tone === 'win', 3000), 'it lands green on a win');
      ok(await waitFor(() => !host.querySelector('.ui-stats-locked'), 1500), 'and the row unlocks');
      ok(/73\.50/.test(host.querySelector('[data-history-pills]')?.textContent || ''), 'the roll lands in the top history pills');
      __api.delay.dice = 0;
      unmountAll();
    }

    // --- 8f: Mines — a mine opens the whole board; unopened tiles are dimmed
    {
      __api.minesStart = { success: true, gameState: { roundId: 5, currentMultiplier: 1, revealedCells: [], balanceAfterBet: 99 } };
      __api.minesReveal = { success: true, hitMine: true, minePositions: [0, 3, 7] };
      const { default: Mines } = await import('../../src/components/games/Mines.jsx');
      const host = mountGame(Mines, 'mines');
      await sleep(80);
      setVal(host.querySelector('input[type=number]'), '1');
      await sleep(30);
      btnIn(host, /^Bet$/).click();
      ok(await waitFor(() => { const t = host.querySelector('[data-cell]'); return t && !t.disabled; }, 1500), 'Mines: the round opens');
      host.querySelectorAll('[data-cell]')[0].click();
      await sleep(30);
      ok(host.querySelectorAll('[data-cell]')[0].dataset.cell === 'pending', 'the pressed tile lifts first (pending)');
      ok(await waitFor(() => host.querySelectorAll('[data-cell="mine"]').length === 3, 2000), 'hitting a mine reveals the whole board (all 3 mines)');
      const tiles = [...host.querySelectorAll('[data-cell]')];
      ok(tiles.filter((t) => t.dataset.cell === 'gem').length === 22, 'and every gem');
      ok(!tiles[0].classList.contains('css-tileDim') && tiles.slice(1).every((t) => t.classList.contains('css-tileDim')),
        'the pressed tile stays full strength, the rest are dimmed');
      ok(/opacity:\s*0\.7/.test(firstRule(readCss('src/components/games/mines.module.css'), '.tileRevealed.tileDim .hole')), 'dimmed = 0.7 opacity');
      unmountAll();
    }

    // --- 8g: Blackjack — totals, deal order, hole card, push outline
    {
      const { default: Blackjack, handTotalLabel } = await import('../../src/components/games/Blackjack.jsx');
      const C = (r) => ({ r, s: 'spades' });
      ok(handTotalLabel([C('A'), C('6')]) === '7, 17', 'Blackjack: A+6 shows both totals: "7, 17"');
      ok(handTotalLabel([C('A'), C('6')], true) === '17', 'a finished soft hand shows its best total');
      ok(handTotalLabel([C('A'), C('K')]) === '21', 'a soft 21 is just "21"');
      ok(handTotalLabel([C('A'), C('A')]) === '2, 12', 'A+A: "2, 12"');
      ok(handTotalLabel([C('A'), C('6'), C('K')]) === '17', 'the ace counts 1 once 11 would bust');
      ok(handTotalLabel([C('K'), C('Q'), C('5')]) === '25', 'a bust shows the plain total');
      ok(handTotalLabel([{ hidden: true }, C('9')]) === '9' && handTotalLabel([]) === null, 'face-down cards do not count; no cards -> no label');

      const card = (r, s) => ({ r, s });
      const base = { roundId: 'bj1', activeHandIndex: 0, handBets: [1] };
      const bodies = [
        { success: true, gameState: { ...base, status: 'active', dealerHand: [card('5', 'hearts'), { hidden: true }], playerHands: [[card('A', 'clubs'), card('6', 'diamonds')]], handOutcomes: [], payout: 0, balance: 99 } },
        { success: true, gameState: { ...base, status: 'finished', dealerHand: [card('5', 'hearts'), card('K', 'clubs'), card('2', 'spades')], playerHands: [[card('A', 'clubs'), card('6', 'diamonds')]], handOutcomes: ['push'], payout: 1, balance: 100 } },
      ];
      // (`global` is shadowed by a CSS string in main() — use globalThis)
      const prevFetch = globalThis.fetch;
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => bodies.shift() });
      const host = mountGame(Blackjack, 'blackjack');
      await sleep(60);
      const order = [];
      const mo = new MutationObserver((ms) => ms.forEach((m) => {
        if (m.attributeName === 'data-face' && m.target.dataset.face === 'up') order.push(m.target.dataset.bjCard);
      }));
      mo.observe(host, { subtree: true, attributes: true, attributeFilter: ['data-face'] });
      setVal(host.querySelector('input[type=number]'), '1');
      await sleep(30);
      btnIn(host, /^Bet$/).click();
      await sleep(80);
      const faces = () => [...host.querySelectorAll('[data-bj-card]')].map((c) => `${c.dataset.bjCard}:${c.dataset.face}`).join(' ');
      ok(faces() === '5h:down hidden:down Ac:down 6d:down', 'every card leaves the deck face-down', faces());
      ok(btnIn(host, /^Hit/).disabled && btnIn(host, /^Stand/).disabled, 'no actions while the cards are still being dealt');
      ok(await waitFor(() => host.querySelector('[data-bj-total="hand-0"]')?.textContent === '7, 17', 2500), 'the player total counts up to "7, 17" as the cards turn');
      ok(order.join(' ') === 'Ac 5h 6d', 'cards turn in deal order: player, dealer, player (the hole card stays down)', order.join(' '));
      ok(host.querySelector('[data-bj-total="dealer"]')?.textContent === '5', 'the dealer total counts only his face-up card');
      ok(await waitFor(() => !btnIn(host, /^Stand/).disabled, 1500), 'actions unlock once the deal is done');
      btnIn(host, /^Stand/).click();
      ok(await waitFor(() => !!host.querySelector('[data-win-popup]'), 4000), 'standing settles the round');
      ok(order.slice(3).join(' ') === 'Kc 2s', 'the hole card turns over in place, then the dealer draws', order.join(' '));
      ok(host.querySelector('[data-bj-total="dealer"]')?.textContent === '17', 'dealer: 17');
      const pill = host.querySelector('[data-bj-total="hand-0"]');
      ok(pill?.textContent === '17' && pill.dataset.outline === 'push' && pill.classList.contains('css-totalPillPush'),
        'a push: the finished soft hand reads 17 and its pill is outlined orange');
      ok(host.querySelectorAll('.css-cardOutlinePush').length === 2, "the player's cards are outlined orange too");
      const pop = host.querySelector('[data-win-popup]');
      ok(pop?.dataset.winPopup === 'push' && /1\.00×/.test(pop.textContent), 'the result is the shared popup: push tone, 1.00×');
      mo.disconnect();
      globalThis.fetch = prevFetch;
      unmountAll();
      const bjCss = readCss('src/components/games/blackjack.module.css');
      const pillRule = firstRule(bjCss, '.totalPillPlayer');
      ok(/--pill-bg:\s*#364E5C/i.test(bjCss) && /background:\s*var\(--pill-bg\)/.test(pillRule) && /font-weight:\s*700/.test(pillRule)
        && /box-shadow:\s*var\(--pill-shadow\)/.test(pillRule), 'total pill: #364E5C fill, bold, drop shadow');
      ok(/var\(--accent-orange\)/.test(firstRule(bjCss, '.cardOutlinePush')) && /var\(--accent-orange\)/.test(firstRule(bjCss, '.totalPillPush')),
        'push outlines use the orange accent');
    }

    // --- 8h: Coin Flip — call after Bet, keep flipping on wins, history per round
    {
      const R = (o) => ({ roundId: 7, betAmount: 1, inProgress: true, wins: 0, currentMultiplier: 1, nextMultiplier: 1.98, flips: [], canCashout: false, canFlip: true, maxFlips: 20, ...o });
      __api.flipActive = { success: true, result: null };
      __api.flipStart = { success: true, result: { ...R(), balance: 99 } };
      const { default: Flip } = await import('../../src/components/games/Flip.jsx');
      let host = mountGame(Flip, 'flip');
      await sleep(80);
      const b = (n) => btnIn(host, new RegExp(`^${n}`));
      const clip = () => host.querySelector('[data-flip-clip]')?.dataset.flipClip;
      const slots = () => [...host.querySelectorAll('[data-flip-slot]')].map((x) => x.dataset.flipSlot).join(',');
      const land = () => [...host.querySelectorAll('video')].find((v) => v.className.includes('coinVideoActive'))?.dispatchEvent(new Event('ended'));
      ok(b('Heads').disabled && b('Tails').disabled && b('Random Pick').disabled, 'Flip: Heads / Tails / Random Pick wait for a bet');
      setVal(host.querySelector('input[type=number]'), '1');
      await sleep(30);
      b('Bet').click();
      ok(await waitFor(() => !b('Heads').disabled), 'after Bet the player calls it');
      ok(clip() === 'h2h', 'the coin waits on the first frame of its next flip');
      ok(b('Cashout')?.disabled === true && host.querySelector('input[type=number]').disabled, 'Cashout replaces Bet (locked until a win); the stake is locked');

      __api.flipChoose = { success: true, result: { ...R({ wins: 1, currentMultiplier: 1.98, nextMultiplier: 3.96, canCashout: true, flips: [{ side: 'heads', outcome: 'heads', won: true }] }), won: true, lost: false, side: 'heads', outcome: 'heads' } };
      b('Heads').click();
      await sleep(60);
      ok(b('Heads').disabled && slots() === '', 'while the coin is in the air: no calls, the history waits for the landing');
      ok(clip() === 'h2h', 'heads -> heads plays');
      land();
      ok(await waitFor(() => !b('Heads').disabled), 'a win keeps the round open');
      ok(slots() === 'heads-won', 'the flip is in the history bar', slots());
      ok(!b('Cashout').disabled && /3\.96×/.test(host.querySelector('[data-flip-next]')?.textContent || ''), 'Cashout unlocks; the next call pays 3.96× (doubled)');

      __api.flipChoose = { success: true, result: { ...R({ inProgress: false, currentMultiplier: 0, wins: 1, canCashout: false, canFlip: false, flips: [{ side: 'heads', outcome: 'heads', won: true }, { side: 'tails', outcome: 'heads', won: false }] }), won: false, lost: true, side: 'tails', outcome: 'heads' } };
      b('Tails').click();
      await sleep(60);
      land();
      ok(await waitFor(() => !!b('Bet')), 'a lost call ends the round');
      ok(slots() === 'heads-won,heads-lost', 'both flips stay listed, the lost one marked', slots());

      __api.flipStart = { success: true, result: { ...R({ roundId: 8 }), balance: 98 } };
      b('Bet').click();
      ok(await waitFor(() => !b('Heads').disabled), 'next round');
      ok(slots() === '', 'the history bar starts over with every round');
      __api.flipChoose = { success: true, result: { ...R({ roundId: 8, wins: 1, currentMultiplier: 1.98, nextMultiplier: 3.96, canCashout: true, flips: [{ side: 'tails', outcome: 'tails', won: true }] }), won: true, lost: false, side: 'tails', outcome: 'tails' } };
      b('Tails').click();
      await sleep(60);
      ok(clip() === 'h2t', 'from heads a tails result plays heads -> tails');
      land();
      ok(await waitFor(() => b('Cashout') && !b('Cashout').disabled), 'won the call');
      ok(clip() === 't2t', 'the coin now waits on the tails first frame');
      __api.flipCashout = { success: true, result: { roundId: 8, inProgress: false, status: 'cashed_out', wins: 1, multiplier: 1.98, payout: 1.98, profit: 0.98, balance: 100.98 } };
      b('Cashout').click();
      ok(await waitFor(() => !!host.querySelector('[data-win-popup="win"]')), 'Cashout shows the win popup');
      ok(/1\.98×/.test(host.querySelector('.ui-win-popup-multiplier')?.textContent || '') && host.querySelector('.ui-win-popup-amount span')?.textContent === '1.98',
        '1.98× over 1.98 won');
      ok(!!b('Bet'), 'and the round is closed');
      unmountAll();

      __api.flipActive = { success: true, result: R({ roundId: 9, betAmount: 3, wins: 2, currentMultiplier: 3.96, nextMultiplier: 7.92, canCashout: true, flips: [{ side: 'heads', outcome: 'heads', won: true }, { side: 'tails', outcome: 'tails', won: true }] }) };
      host = mountGame(Flip, 'flip');
      ok(await waitFor(() => !!b('Cashout')), 'an open round comes back after a reload');
      ok(host.querySelector('input[type=number]').value === '3' && slots() === 'heads-won,tails-won' && /7\.92×/.test(host.querySelector('[data-flip-next]')?.textContent || ''),
        'with its stake, its flips and the next multiplier');
      ok(clip() === 't2t', 'the coin waits on the side it last landed on');
      unmountAll();

      let activeCalls = 0;
      __api.flipActive = () => (activeCalls++ === 0 ? { success: true, result: null } : { success: true, result: R({ roundId: 10, betAmount: 2 }) });
      __api.flipStart = { __error: Object.assign(new Error('409'), { response: { status: 409, data: { success: false, code: 'FLIP_ROUND_OPEN', message: 'Finish your current flip round first' } } }) };
      host = mountGame(Flip, 'flip');
      await sleep(80);
      setVal(host.querySelector('input[type=number]'), '1');
      await sleep(30);
      b('Bet').click();
      ok(await waitFor(() => !!b('Cashout')), 'Bet while a round is open elsewhere (409) loads that round');
      ok(host.querySelector('input[type=number]').value === '2', 'with its own stake');
      unmountAll();
      ok(/background:\s*var\(--color-text-muted\)/.test(firstRule(readCss('src/components/games/flip.module.css'), '.sideBtn:disabled .dotHeads,\n.sideBtn:disabled .dotTails')),
        'outside a round the side buttons read as disabled (text + marker muted)');
    }

    // --- 8i: Wheel + the navbar
    {
      const wheel = readCss('src/components/games/Wheel.jsx');
      const wcss = readCss('src/components/games/wheel.module.css');
      ok(!/animation|transition/.test(firstRule(wcss, '.pointerWrap')) && !/animation|transition/.test(firstRule(wcss, '.pointerSvg')),
        'Wheel: the pointer has no animation or rotation');
      ok(/viewBox="0 0 28 50"/.test(wheel) && /#d9415b/i.test(wheel), 'a taller 28×50 pointer with the darker inner circle');
      ok(/SPIN_EASE\s*=\s*"cubic-bezier\(0\.15,\s*0\.75,\s*0\.2,\s*1\)"/.test(wheel), 'a faster spin with a long ease-out');
      ok(/<HistoryPills\b/.test(wheel) && !/resultLine/.test(wheel), 'the result line is gone; results are top pills');
      const nav = readCss('src/components/layout/navigation.module.css');
      ok(/grid-template-columns:\s*1fr auto 1fr/.test(nav), 'navbar: a 1fr | auto | 1fr grid keeps the balance box dead-centre');
    }
    __api.flipActive = null;
    __api.flipStart = null;
  }

  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('RUNNER FAILED', e); process.exit(1); });
