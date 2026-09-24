/* ============================================================================
 * Site-wide UI suite (jsdom).
 *
 * Covers the things that are not specific to the Crash board:
 *   §1  the "Loss" toast kind (title, card class, icon) — real ToastProvider
 *   §2  games page: filter-row spacing (desktop) + centring (mobile)
 *   §3  admin panel: nothing scrolls sideways on a phone, icon-only row buttons
 *   §4  the hazard badge on the bet button opens the explanation modal —
 *       checked on EVERY game that has a bet button
 *
 * Run:  npm run test:ui        (from frontend/)
 * ==========================================================================*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToastProvider, useToast } from '../../src/context/ToastContext.jsx';
import { ActiveBetProvider } from '../../src/context/ActiveBetContext.jsx';
import { __toasts as stubToasts } from '../stubs/toastContext.jsx';
import { __auth } from '../stubs/authContext.jsx';
import { __site as __siteStatus } from '../stubs/gamesApi.js';
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
    ok(/toast\.loss\('Crashed before your cash out went through'\)/.test(crash),
      'Crash reports the lost cash-out race as a Loss');

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
    ok(/\.smallBtn\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s.test(mobile), 'row buttons become square tiles');
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
    ok(/M12 3\.5v8/.test(jsx), 'a power icon was added to the enable/disable buttons');
    ok(/x1="4" y1="4" x2="20" y2="20"/.test(jsx), 'the phone icon gets a slash when mobile is on');

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

  // the badge must be a sibling (a disabled button swallows clicks)  // the badge must be a sibling (a disabled button swallows clicks)
  const global = readCss('src/styles/global.css');
  ok(/\.ui-bet-wrap\s*\{[^}]*position:\s*relative/.test(global), '.ui-bet-wrap is a positioned host');
  const badgeSrc = readCss('src/components/common/BetLockBadge.jsx');
  ok(/<HazardBadge corner/.test(badgeSrc) && /<Modal/.test(badgeSrc),
    'BetLockBadge renders the badge + the shared Modal');
  ok(/description=\{body\}/.test(badgeSrc), 'the modal uses the same icon/title/description anatomy');

  console.log(`\n──────────── ${pass} passed, ${fail} failed ────────────\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('RUNNER FAILED', e); process.exit(1); });
