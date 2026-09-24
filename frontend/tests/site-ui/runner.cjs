/**
 * Runs `dist/uitest.cjs` inside a jsdom document that looks like the Crash page.
 *
 * There is no real browser in this environment, so jsdom is the closest thing:
 * it gives React a DOM, timers, requestAnimationFrame and the same event model,
 * and the suite then measures what the board ACTUALLY renders (SVG path data,
 * inline positions, class names, text) instead of what it is supposed to render.
 */
const { JSDOM } = require('jsdom');
const path = require('node:path');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000/games/crash',
  pretendToBeVisual: true,
});

const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.localStorage = window.localStorage;
global.sessionStorage = window.sessionStorage;
global.location = window.location;
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
global.Event = window.Event;
global.MouseEvent = window.MouseEvent;
global.KeyboardEvent = window.KeyboardEvent;
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = false;
// the games create `new Audio(...)` for their sound effects; jsdom can do that,
// but the constructor has to be reachable as a global too
global.Audio = window.Audio;
global.MutationObserver = window.MutationObserver;
global.Image = window.Image;
global.HTMLImageElement = window.HTMLImageElement;
// jsdom throws "Not implemented" for media playback; the games only ever
// pause/play their bet sounds, so no-op both.
if (window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = function () {
    // record every play() so tests can assert which sound a game fired
    (global.__playedAudio = global.__playedAudio || []).push(String(this.src || ''));
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLMediaElement.prototype.load = function () {};
}
global.HTMLMediaElement = window.HTMLMediaElement;
global.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
global.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
global.HTMLMediaElement = window.HTMLMediaElement;

window.scrollTo = () => {};
// bundles (react-hot-toast, the games) call the BARE `matchMedia`, which in
// jsdom is only reachable through window
global.matchMedia = window.matchMedia ? window.matchMedia.bind(window) : () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.__DBG = true;
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

require(path.join(__dirname, 'dist', 'uitest.cjs'));
