// ============================================================
// Roulette.jsx — European Roulette (Casino-style)
// ============================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./roulette.module.css";

// Assets
import wheelPng from "../../assets/roulette/wheel.png";
import ballPng from "../../assets/roulette/Ball.png";

import chip1 from "../../assets/roulette/Chip1.png";
import chip5 from "../../assets/roulette/Chip5.png";
import chip10 from "../../assets/roulette/Chip10.png";
import chip50 from "../../assets/roulette/Chip50.png";
import chip100 from "../../assets/roulette/Chip100.png";
import chip500 from "../../assets/roulette/Chip500.png";
import chip1000 from "../../assets/roulette/Chip1000.png";
import chip5000 from "../../assets/roulette/Chip5000.png";
import chip10000 from "../../assets/roulette/Chip10000.png";

// ============================================================
// Constants
// ============================================================

const CHIP_VALUES = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];

const CHIP_IMG = {
  1: chip1, 5: chip5, 10: chip10, 50: chip50, 100: chip100,
  500: chip500, 1000: chip1000, 5000: chip5000, 10000: chip10000,
};

/** European wheel pocket order (0 at 12 o'clock, clockwise) */
const EURO_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const NUM_POCKETS = EURO_WHEEL_ORDER.length; // 37
const DEG_PER_POCKET = 360 / NUM_POCKETS;

/** Red numbers on a European wheel */
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/**
 * Board rows (top to bottom on horizontal board):
 *   Row 0 (top):    3,6,9…36   → column 3 (n%3===0)
 *   Row 1 (middle): 2,5,8…35   → column 2 (n%3===2)
 *   Row 2 (bottom): 1,4,7…34   → column 1 (n%3===1)
 */
const TABLE_ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];

const HISTORY_MAX = 6;
const WIN_POPUP_DURATION = 3000;
const SPIN_MIN_MS = 5000;
const SPIN_MAX_MS = 10000;
const BALL_OUTER_R = 165;
const BALL_INNER_R = 110;

// ============================================================
// Helpers
// ============================================================

function isMobileNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(max-width: 700px)").matches;
}

function betKeyToPayload(betKey) {
  const i = betKey.indexOf(":");
  if (i === -1) return null;
  return { type: betKey.slice(0, i), value: betKey.slice(i + 1) };
}

function numberColor(n) {
  if (n === 0) return "green";
  return REDS.has(n) ? "red" : "black";
}

/** Return all straight:N keys covered by a given betKey (for hover highlighting) */
function coveredNumbers(betKey) {
  if (!betKey) return [];
  const colon = betKey.indexOf(":");
  if (colon === -1) return [];
  const type = betKey.slice(0, colon);
  const value = betKey.slice(colon + 1);

  switch (type) {
    case "straight":
      return [`straight:${value}`];
    case "split":
    case "corner":
    case "street":
    case "sixline":
      return value.split("-").map((n) => `straight:${n}`);
    case "column": {
      const col = Number(value);
      const mod = col === 3 ? 0 : col;
      const keys = [];
      for (let n = 1; n <= 36; n++) if (n % 3 === mod) keys.push(`straight:${n}`);
      return keys;
    }
    case "dozen": {
      const d = Number(value);
      const start = (d - 1) * 12 + 1;
      const keys = [];
      for (let n = start; n < start + 12; n++) keys.push(`straight:${n}`);
      return keys;
    }
    case "even": {
      const keys = [];
      if (value === "low") for (let n = 1; n <= 18; n++) keys.push(`straight:${n}`);
      else if (value === "high") for (let n = 19; n <= 36; n++) keys.push(`straight:${n}`);
      else if (value === "even") for (let n = 2; n <= 36; n += 2) keys.push(`straight:${n}`);
      else if (value === "odd") for (let n = 1; n <= 36; n += 2) keys.push(`straight:${n}`);
      else if (value === "red") REDS.forEach((n) => keys.push(`straight:${n}`));
      else if (value === "black") for (let n = 1; n <= 36; n++) { if (!REDS.has(n)) keys.push(`straight:${n}`); }
      return keys;
    }
    default:
      return [];
  }
}

/** Build inside bet definitions (splits, corners, streets, sixlines) */
function buildInsideBets() {
  const bets = [];
  const numAt = (r, c) => TABLE_ROWS[r]?.[c];

  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 11; c++)
      bets.push({ kind: "splitH", r, c, betKey: `split:${numAt(r, c)}-${numAt(r, c + 1)}` });

  for (let c = 0; c < 12; c++) {
    bets.push({ kind: "splitV", r: 0, c, betKey: `split:${numAt(0, c)}-${numAt(1, c)}` });
    bets.push({ kind: "splitV", r: 1, c, betKey: `split:${numAt(1, c)}-${numAt(2, c)}` });
  }

  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 11; c++) {
      const nums = [numAt(r, c), numAt(r, c + 1), numAt(r + 1, c), numAt(r + 1, c + 1)];
      bets.push({ kind: "corner", r, c, betKey: `corner:${nums.join("-")}` });
    }

  for (let c = 0; c < 12; c++)
    bets.push({ kind: "street", c, betKey: `street:${numAt(2, c)}-${numAt(1, c)}-${numAt(0, c)}` });

  for (let c = 0; c < 11; c++) {
    const colA = [numAt(2, c), numAt(1, c), numAt(0, c)];
    const colB = [numAt(2, c + 1), numAt(1, c + 1), numAt(0, c + 1)];
    bets.push({ kind: "sixline", c, betKey: `sixline:${[...colA, ...colB].join("-")}` });
  }

  return bets;
}

// ============================================================
// Board cell definitions
// ============================================================

function getNumberDefs() {
  const defs = [];
  for (const row of TABLE_ROWS)
    for (const n of row)
      defs.push({
        betKey: `straight:${n}`,
        label: String(n),
        dataNum: n,
        cls: REDS.has(n) ? styles.pocketRed : styles.pocketBlack,
      });
  return defs;
}

const COL_DEFS = [
  { area: "row1", betKey: "column:3", label: "2:1" },
  { area: "row2", betKey: "column:2", label: "2:1" },
  { area: "row3", betKey: "column:1", label: "2:1" },
];

const DOZEN_DEFS = [
  { betKey: "dozen:1", label: "1 to 12", area: "range0112" },
  { betKey: "dozen:2", label: "13 to 24", area: "range1324" },
  { betKey: "dozen:3", label: "25 to 36", area: "range2536" },
];

const EVEN_DEFS = [
  { betKey: "even:low", label: "1 to 18", area: "range0118" },
  { betKey: "even:even", label: "Even", area: "parityEven" },
  { betKey: "even:red", label: "", area: "colorRed", cls: styles.pocketRedSolid },
  { betKey: "even:black", label: "", area: "colorBlack", cls: styles.pocketBlackSolid },
  { betKey: "even:odd", label: "Odd", area: "parityOdd" },
  { betKey: "even:high", label: "19 to 36", area: "range1936" },
];

// ============================================================
// Main Component
// ============================================================

export default function Roulette({ gameRow }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  // ---- Responsive ----
  const [isMobile, setIsMobile] = useState(isMobileNow());
  useEffect(() => {
    const h = () => setIsMobile(isMobileNow());
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // ---- Chip selection ----
  const [chipIndex, setChipIndex] = useState(0);
  // navigation direction of the LAST arrow click (-1 prev / +1 next) —
  // drives the slide-in animation of the chip row
  const [chipDir, setChipDir] = useState(0);
  const selectedChip = CHIP_VALUES[chipIndex] ?? 1;
  const shiftChip = (dir) => {
    setChipDir(dir);
    setChipIndex((i) => (i + dir + CHIP_VALUES.length) % CHIP_VALUES.length);
  };

  // ---- Placed bets ----
  const [placed, setPlaced] = useState(() => new Map());
  const chipIdRef = useRef(0);

  const totalBet = useMemo(() => {
    let s = 0;
    for (const v of placed.values()) s += Number(v.amount) || 0;
    return s;
  }, [placed]);

  const [betError, setBetError] = useState(null);
  // inline bet errors clear themselves as soon as they are resolved
  useEffect(() => {
    setBetError((cur) => {
      if (!cur) return cur;
      if (cur === "Log in to place a bet") return isAuthenticated ? null : cur;
      if (cur === "Place a bet first") return totalBet > 0 ? null : cur;
      return totalBet > 0 && totalBet <= (user?.balance ?? 0) ? null : cur;
    });
  }, [totalBet, isAuthenticated, user?.balance]);

  const betsPayload = useMemo(() => {
    const arr = [];
    for (const [betKey, data] of placed.entries()) {
      const amount = Number(data?.amount) || 0;
      if (amount <= 0) continue;
      const p = betKeyToPayload(betKey);
      if (p) arr.push({ ...p, amount });
    }
    return arr;
  }, [placed]);

  const clearBets = () => {
    betLogRef.current = [];
    setPlaced(new Map());
  };

  // chronological log of every chip placement — powers Undo
  const betLogRef = useRef([]);

  const undoBet = () => {
    const last = betLogRef.current.pop();
    if (!last) return;
    setPlaced((prev) => {
      const next = new Map(prev);
      const curr = next.get(last.betKey);
      if (!curr) return prev;
      const stacks = (curr.stacks || []).filter((st) => st.id !== last.id);
      const amount = Math.max(0, (Number(curr.amount) || 0) - last.value);
      if (!stacks.length || amount <= 0) next.delete(last.betKey);
      else next.set(last.betKey, { amount, stacks });
      return next;
    });
  };

  const addChipToBet = useCallback((betKey, chipValue) => {
    if (!chipValue) chipValue = CHIP_VALUES[chipIndex] ?? 1;
    const v = Number(chipValue);
    if (!Number.isFinite(v) || v <= 0) return;
    const id = ++chipIdRef.current;
    betLogRef.current.push({ betKey, id, value: v });
    setPlaced((prev) => {
      const next = new Map(prev);
      const curr = next.get(betKey) || { amount: 0, stacks: [] };
      next.set(betKey, {
        amount: (Number(curr.amount) || 0) + v,
        stacks: [...(curr.stacks || []), { id, value: v }],
      });
      return next;
    });
  }, [chipIndex]);

  // ---- Game state ----
  const [spinning, setSpinning] = useState(false);
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  // Roulette has no single betAmount input; error is shown via betError, but keep betLockedError for consistency
  useEffect(() => {
    if (isLocked) setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [isLocked, betErrorMessage]);
  const [ballVisible, setBallVisible] = useState(false);
  const [shownResult, setShownResult] = useState(null);
  const [winningNumber, setWinningNumber] = useState(null);
  const [lastPayout, setLastPayout] = useState(0);
  const [showWinPopup, setShowWinPopup] = useState(false);
  const winPopupTimer = useRef(null);
  const [historyShown, setHistoryShown] = useState([]);
  const [mobileWheelOpen, setMobileWheelOpen] = useState(false);

  // Idle is a one-shot: once disabled, never re-enabled
  const hasSpunRef = useRef(false);

  // ---- Hover state ----
  const [hoverBetKey, setHoverBetKey] = useState(null);
  const [hoverHighlightKeys, setHoverHighlightKeys] = useState(new Set());

  const onEnterBet = useCallback((betKey) => {
    setHoverBetKey(betKey);
    setHoverHighlightKeys(new Set(coveredNumbers(betKey)));
  }, []);

  const onLeaveBet = useCallback(() => {
    setHoverBetKey(null);
    setHoverHighlightKeys(new Set());
  }, []);

  // ---- Refs ----
  const wheelRef = useRef(null);
  const ballOrbitRef = useRef(null);
  const boardRef = useRef(null);
  const insideHitOverlayRef = useRef(null);
  const insideChipOverlayRef = useRef(null);

  // ---- Inside bets ----
  const insideBets = useMemo(() => buildInsideBets(), []);
  const [insideLayout, setInsideLayout] = useState({ hitZones: [], chipAnchors: new Map() });
  const numberDefs = useMemo(() => getNumberDefs(), []);

  // ---- Drag & drop ----
  const dragRef = useRef({ active: false, value: 0, img: null, x: 0, y: 0 });
  const [, forceDragTick] = useState(0);
  const onDragMoveRef = useRef(null);
  const onDragEndRef = useRef(null);

  onDragMoveRef.current = (e) => {
    if (!dragRef.current.active) return;
    e.preventDefault();
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    forceDragTick((t) => t + 1);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el?.closest?.("[data-betkey]")?.getAttribute?.("data-betkey") || null;
    setHoverBetKey(k);
    setHoverHighlightKeys(new Set(coveredNumbers(k)));
  };

  onDragEndRef.current = (e) => {
    if (!dragRef.current.active) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const betKey = el?.closest?.("[data-betkey]")?.getAttribute?.("data-betkey") || null;
    if (betKey) addChipToBet(betKey, dragRef.current.value);
    dragRef.current.active = false;
    setHoverBetKey(null);
    setHoverHighlightKeys(new Set());
    forceDragTick((t) => t + 1);
    window.removeEventListener("pointermove", stableDragMove);
    window.removeEventListener("pointerup", stableDragEnd);
    window.removeEventListener("pointercancel", stableDragEnd);
  };

  const stableDragMove = useCallback((e) => onDragMoveRef.current?.(e), []);
  const stableDragEnd = useCallback((e) => onDragEndRef.current?.(e), []);

  const beginDragChip = useCallback((chipValue, e) => {
    if (spinning) return;
    e.preventDefault();
    dragRef.current = { active: true, value: chipValue, img: CHIP_IMG[chipValue], x: e.clientX, y: e.clientY };
    forceDragTick((t) => t + 1);
    window.addEventListener("pointermove", stableDragMove, { passive: false });
    window.addEventListener("pointerup", stableDragEnd, { passive: false });
    window.addEventListener("pointercancel", stableDragEnd, { passive: false });
  }, [spinning, stableDragMove, stableDragEnd]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", stableDragMove);
    window.removeEventListener("pointerup", stableDragEnd);
    window.removeEventListener("pointercancel", stableDragEnd);
  }, [stableDragMove, stableDragEnd]);

  // ============================================================
  // Inside bet overlay measurement (desktop only)
  // ============================================================

  const measureInsideLayout = useCallback(() => {
    if (isMobile) return;
    const boardEl = boardRef.current;
    const hitOverlay = insideHitOverlayRef.current;
    const chipOverlay = insideChipOverlayRef.current;
    if (!boardEl || !hitOverlay || !chipOverlay) return;

    const boardRect = boardEl.getBoundingClientRect();
    const rectOf = {};
    boardEl.querySelectorAll("[data-num]").forEach((el) => {
      const n = Number(el.getAttribute("data-num"));
      if (!isNaN(n)) rectOf[n] = el.getBoundingClientRect();
    });
    if (Object.keys(rectOf).length < 36) return;

    const numAt = (r, c) => TABLE_ROWS[r]?.[c];
    const hitZones = [];
    const chipAnchors = new Map();

    for (const b of insideBets.filter((x) => x.kind === "splitH")) {
      const ra = rectOf[numAt(b.r, b.c)];
      const rb = rectOf[numAt(b.r, b.c + 1)];
      if (!ra || !rb) continue;
      const cx = (ra.right + rb.left) / 2 - boardRect.left;
      const cy = ra.top - boardRect.top + ra.height / 2;
      hitZones.push({ betKey: b.betKey, left: cx - 10, top: ra.top - boardRect.top + 4, width: 20, height: ra.height - 8 });
      chipAnchors.set(b.betKey, { x: cx, y: cy });
    }

    for (const b of insideBets.filter((x) => x.kind === "splitV")) {
      const ra = rectOf[numAt(b.r, b.c)];
      const rb = rectOf[numAt(b.r + 1, b.c)];
      if (!ra || !rb) continue;
      const cy = (ra.bottom + rb.top) / 2 - boardRect.top;
      const cx = ra.left - boardRect.left + ra.width / 2;
      hitZones.push({ betKey: b.betKey, left: ra.left - boardRect.left + 4, top: cy - 10, width: ra.width - 8, height: 20 });
      chipAnchors.set(b.betKey, { x: cx, y: cy });
    }

    for (const b of insideBets.filter((x) => x.kind === "corner")) {
      const ra = rectOf[numAt(b.r, b.c)];
      const rr = rectOf[numAt(b.r, b.c + 1)];
      const rd = rectOf[numAt(b.r + 1, b.c)];
      if (!ra || !rr || !rd) continue;
      const cx = (ra.right + rr.left) / 2 - boardRect.left;
      const cy = (ra.bottom + rd.top) / 2 - boardRect.top;
      hitZones.push({ betKey: b.betKey, left: cx - 12, top: cy - 12, width: 24, height: 24 });
      chipAnchors.set(b.betKey, { x: cx, y: cy });
    }

    for (const b of insideBets.filter((x) => x.kind === "street")) {
      const ra = rectOf[numAt(2, b.c)];
      if (!ra) continue;
      const cx = ra.left - boardRect.left + ra.width / 2;
      const y = ra.bottom - boardRect.top + 2;
      hitZones.push({ betKey: b.betKey, left: ra.left - boardRect.left + 6, top: y - 8, width: ra.width - 12, height: 16 });
      chipAnchors.set(b.betKey, { x: cx, y });
    }

    for (const b of insideBets.filter((x) => x.kind === "sixline")) {
      const ra = rectOf[numAt(2, b.c)];
      const rb = rectOf[numAt(2, b.c + 1)];
      if (!ra || !rb) continue;
      const cx = (ra.right + rb.left) / 2 - boardRect.left;
      const y = ra.bottom - boardRect.top + 2;
      hitZones.push({ betKey: b.betKey, left: cx - 14, top: y - 8, width: 28, height: 16 });
      chipAnchors.set(b.betKey, { x: cx, y });
    }

    hitOverlay.style.width = `${boardRect.width}px`;
    hitOverlay.style.height = `${boardRect.height}px`;
    chipOverlay.style.width = `${boardRect.width}px`;
    chipOverlay.style.height = `${boardRect.height}px`;

    setInsideLayout({ hitZones, chipAnchors });
  }, [insideBets, isMobile]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      measureInsideLayout();
      requestAnimationFrame(measureInsideLayout);
    });
    return () => cancelAnimationFrame(raf);
  }, [measureInsideLayout]);

  useEffect(() => {
    window.addEventListener("resize", measureInsideLayout);
    return () => window.removeEventListener("resize", measureInsideLayout);
  }, [measureInsideLayout]);

  // ============================================================
  // Wheel & Ball Animation
  // ============================================================

  const wheelAngleRef = useRef(0);
  const ballAngleRef = useRef(0);

  const stopAnim = (el) => {
    if (!el) return;
    try { el.getAnimations().forEach((a) => a.cancel()); } catch { }
  };

  const spinTo = async (number) => {
    const wheel = wheelRef.current;
    const orbit = ballOrbitRef.current;
    if (!wheel || !orbit) return;

    // Scale ball radius for mobile (smaller wheel)
    const outerR = isMobile ? 115 : BALL_OUTER_R;
    const innerR = isMobile ? 85 : BALL_INNER_R;

    // Mark that we've spun — idle never comes back
    hasSpunRef.current = true;

    // Stop idle animation and remove the class permanently
    wheel.classList.remove(styles.wheelIdleAnim);
    stopAnim(wheel);
    stopAnim(orbit);

    setBallVisible(true);

    const idx = EURO_WHEEL_ORDER.indexOf(number);
    if (idx === -1) return;

    const pocketAngle = idx * DEG_PER_POCKET;
    const randomBallLanding = Math.random() * 360;
    const targetWheelMod = ((randomBallLanding - pocketAngle) % 360 + 360) % 360;

    const wheelSpins = 5 + Math.floor(Math.random() * 3);
    const ballSpins = 7 + Math.floor(Math.random() * 3);

    const startWheel = wheelAngleRef.current;
    const startBall = ballAngleRef.current;

    const curWheelMod = ((startWheel % 360) + 360) % 360;
    let finalWheel = startWheel + wheelSpins * 360 + (targetWheelMod - curWheelMod);
    while (finalWheel < startWheel + wheelSpins * 360) finalWheel += 360;

    const targetBallMod = ((randomBallLanding % 360) + 360) % 360;
    const curBallMod = ((startBall % 360) + 360) % 360;
    let finalBall = startBall - ballSpins * 360 + (targetBallMod - curBallMod);
    while (finalBall > startBall - ballSpins * 360) finalBall -= 360;

    const duration = SPIN_MIN_MS + Math.random() * (SPIN_MAX_MS - SPIN_MIN_MS);

    // Ball starts at outer radius, no transition
    const ballImg = orbit.querySelector(`.${styles.ball}`);
    if (ballImg) ballImg.style.transition = "none";
    orbit.style.setProperty("--ball-r", `${outerR}px`);

    // Set starting transforms explicitly
    wheel.style.transform = `rotate(${startWheel}deg)`;
    orbit.style.transform = `rotate(${startBall}deg)`;

    // Force reflow so transition:none takes effect
    if (ballImg) void ballImg.offsetHeight;

    // Enable smooth radius transition for the entire drop
    const radiusTransitionMs = duration * 0.6;
    if (ballImg) {
      ballImg.style.transition = `transform ${radiusTransitionMs}ms cubic-bezier(0.33, 1, 0.68, 1)`;
    }

    // Start shrinking ball radius at 35% of the way through
    const radiusTimeout = setTimeout(() => {
      orbit.style.setProperty("--ball-r", `${innerR}px`);
    }, duration * 0.35);

    // Animate wheel & ball
    wheel.animate(
      [{ transform: `rotate(${startWheel}deg)` }, { transform: `rotate(${finalWheel}deg)` }],
      { duration, easing: "cubic-bezier(0.07, 0.75, 0.14, 1)", fill: "forwards" }
    );

    orbit.animate(
      [{ transform: `rotate(${startBall}deg)` }, { transform: `rotate(${finalBall}deg)` }],
      { duration, easing: "cubic-bezier(0.07, 0.75, 0.14, 1)", fill: "forwards" }
    );

    await new Promise((r) => setTimeout(r, duration + 200));
    clearTimeout(radiusTimeout);

    // Commit final state — ball stays put
    stopAnim(wheel);
    stopAnim(orbit);
    wheel.style.transform = `rotate(${finalWheel}deg)`;
    orbit.style.transform = `rotate(${finalBall}deg)`;
    orbit.style.setProperty("--ball-r", `${innerR}px`);
    if (ballImg) ballImg.style.transition = "none";

    // Save for next spin
    wheelAngleRef.current = finalWheel;
    ballAngleRef.current = finalBall;
  };

  // Idle: only on initial load, never after first spin
  useEffect(() => {
    const wheel = wheelRef.current;
    if (!wheel) return;

    if (!isMobile && !hasSpunRef.current && !spinning) {
      wheel.classList.add(styles.wheelIdleAnim);
    } else {
      wheel.classList.remove(styles.wheelIdleAnim);
    }
  }, [isMobile, spinning]);

  // Cleanup win popup timer
  useEffect(() => {
    return () => { if (winPopupTimer.current) clearTimeout(winPopupTimer.current); };
  }, []);

  // ============================================================
  // Bet Handler
  // ============================================================

  const handleBet = async () => {
    if (spinning) return;
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (betsPayload.length === 0) { setBetError("Place a bet first"); return; }
    if (totalBet <= 0) { setBetError("Invalid bet amount"); return; }
    if (totalBet > user.balance) { setBetError("Insufficient balance"); return; }

    setSpinning(true);
    setShownResult(null);
    setWinningNumber(null);
    setShowWinPopup(false);
    if (winPopupTimer.current) clearTimeout(winPopupTimer.current);

    updateBalance((b) => b - totalBet);

    try {
      const response = await gamesAPI.playRoulette({ bets: betsPayload });
      const number = response.data?.result?.number;

      if (!Number.isInteger(number) || number < 0 || number > 36) {
        throw new Error("Invalid result from server");
      }

      await spinTo(number);

      setShownResult(number);
      setWinningNumber(number);
      setHistoryShown((prev) => [number, ...prev].slice(0, HISTORY_MAX));

      const payout = Number(response.data?.result?.totalPayout) || 0;
      updateBalance((b) => b + payout);

      if (payout > 0) {
        setLastPayout(payout);
        setShowWinPopup(true);
        winPopupTimer.current = setTimeout(() => setShowWinPopup(false), WIN_POPUP_DURATION);
      }
    } catch (error) {
      updateBalance((b) => b + totalBet);
      toast.error(error.response?.data?.message || error.message || "Roulette failed");
    } finally {
      setSpinning(false);
    }
  };

  const handleMobileBet = async () => {
    setMobileWheelOpen(true);
    await handleBet();
    setTimeout(() => setMobileWheelOpen(false), 650);
  };

  // ============================================================
  // Render helpers
  // ============================================================

  const renderStackAt = (betKey, x, y) => {
    const data = placed.get(betKey);
    if (!data?.stacks?.length) return null;
    return (
      <div key={betKey} className={styles.anchorStack} style={{ left: x, top: y }}>
        <div className={styles.stackImgs}>
          {data.stacks.slice(-4).map((s, i) => (
            <img key={s.id} src={CHIP_IMG[s.value]} className={styles.stackChip}
              style={{ transform: `translateY(${-i * 5}px)` }} alt="" draggable={false} />
          ))}
        </div>
        <span className={styles.stackAmt}>{data.amount}</span>
      </div>
    );
  };

  /** Shared props for all PocketBtn instances */
  const pocketShared = {
    hoverBetKey, hoverHighlightKeys, winningNumber,
    onEnter: onEnterBet, onLeave: onLeaveBet,
    onClick: addChipToBet, disabled: spinning, placed,
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("roulette", spinning);


  // ============================================================
  // JSX
  // ============================================================

  return (
    <div className={styles.container}>

      {/* ==================== SIDEBAR ==================== */}
      <div className={styles.sidebar}>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${styles.active}`}>Manual</button>
          <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} type="button" disabled>Auto</button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Chip Value</span>
            <span>${selectedChip.toFixed(2)}</span>
          </div>
          <div className={styles.chipSelector}>
            <button type="button" className={`${styles.chipNav} ${styles.chipNavLeft}`} onClick={() => shiftChip(-1)} disabled={spinning} aria-label="Previous chip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14.5 6.5L9 12l5.5 5.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            <div
              key={chipIndex}
              className={`${styles.chipRow} ${chipDir > 0 ? styles.chipSlideNext : chipDir < 0 ? styles.chipSlidePrev : ""}`}
            >
              {Array.from({ length: 4 }).map((_, i) => {
                const idx = (chipIndex - 1 + i + CHIP_VALUES.length) % CHIP_VALUES.length;
                const v = CHIP_VALUES[idx];
                const isActive = idx === chipIndex;
                return (
                  <button key={`${v}-${idx}`} type="button"
                    className={`${styles.chipBtn} ${isActive ? styles.chipBtnActive : ""}`}
                    onClick={() => setChipIndex(idx)}
                    onPointerDown={(e) => beginDragChip(v, e)}
                    disabled={spinning}>
                    <img src={CHIP_IMG[v]} alt={`$${v}`} draggable={false} />
                  </button>
                );
              })}
            </div>
            <button type="button" className={`${styles.chipNav} ${styles.chipNavRight}`} onClick={() => shiftChip(1)} disabled={spinning} aria-label="Next chip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9.5 6.5L15 12l-5.5 5.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Total Bet</span>
            <span>${totalBet.toFixed(2)}</span>
          </div>
          <div className={styles.betInputRow}>
            <div className={styles.betInputLike}>
              {totalBet.toFixed(2)}
              <span className={styles.btcIcon}>$</span>
            </div>
            <div className={styles.splitButtons}>
              <button type="button" disabled>½</button>
              <div className={styles.divider} />
              <button type="button" disabled>2×</button>
            </div>
          </div>
        </div>

        <button className={styles.betButton} onClick={isMobile ? handleMobileBet : handleBet} disabled={isLocked || spinning} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          Bet
        </button>
      </div>

      {/* ==================== GAME STAGE ==================== */}
      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Win popup — direct child of the stage, dead-centre overlay */}
        {showWinPopup && (
          <div className={styles.winPopup}>
            <div className={styles.winPopupTitle}>YOU WON</div>
            <div className={styles.winPopupAmount}>{Number(lastPayout).toFixed(2)} $</div>
          </div>
        )}

        <div className={styles.stageCard}>

          {/* Desktop wheel row */}
          {!isMobile && (
            <div className={styles.topRow}>
              <div className={styles.resultBox}>
                {shownResult != null && (
                  <span className={`${styles.resultNum} ${styles[`resultColor_${numberColor(shownResult)}`]}`}>
                    {shownResult}
                  </span>
                )}
              </div>
              <div className={styles.wheelWrap}>
                <div className={styles.wheel} ref={wheelRef}>
                  <img src={wheelPng} alt="Roulette wheel" draggable={false} />
                </div>
                <div className={`${styles.ballOrbit} ${!ballVisible ? styles.ballHidden : ""}`} ref={ballOrbitRef}>
                  <img src={ballPng} className={styles.ball} alt="Ball" draggable={false} />
                </div>
              </div>
              <div className={styles.historyCol}>
                <div className={styles.historyLabel}>History</div>
                <div className={styles.historyStack}>
                  {historyShown.map((n, idx) => (
                    <div key={`${n}-${idx}-${historyShown.length}`}
                      className={`${styles.histBall} ${styles[`histColor_${numberColor(n)}`]}`}>{n}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Board */}
          <div className={styles.tableWrap}>
            <div className={styles.boardOuter} ref={boardRef}>

              {/* Desktop horizontal */}
              {!isMobile && (
                <div className={styles.board}>
                  <PocketBtn betKey="straight:0" gridArea="number0" label="0"
                    colorCls={styles.pocketGreen} dataNum={0} {...pocketShared} />

                  {numberDefs.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={`number${d.dataNum}`}
                      label={d.label} colorCls={d.cls} dataNum={d.dataNum} {...pocketShared} />
                  ))}

                  {COL_DEFS.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={d.area}
                      label={d.label} colorCls={styles.pocketCol} {...pocketShared} />
                  ))}

                  {DOZEN_DEFS.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={d.area}
                      label={d.label} colorCls={styles.pocketDark} {...pocketShared} />
                  ))}

                  {EVEN_DEFS.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={d.area}
                      label={d.label} colorCls={d.cls || styles.pocketDark}
                      ariaLabel={d.label || d.betKey} {...pocketShared} />
                  ))}
                </div>
              )}

              {/* Mobile vertical */}
              {isMobile && (
                <div className={styles.boardMobile}>
                  <PocketBtn betKey="straight:0" gridArea="number0" label="0"
                    colorCls={styles.pocketGreen} dataNum={0} {...pocketShared} />

                  {numberDefs.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={`number${d.dataNum}`}
                      label={d.label} colorCls={d.cls} dataNum={d.dataNum} {...pocketShared} />
                  ))}

                  {COL_DEFS.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={d.area}
                      label={d.label} colorCls={styles.pocketCol} {...pocketShared} />
                  ))}

                  {DOZEN_DEFS.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={d.area}
                      label={d.label} colorCls={styles.pocketDark} {...pocketShared} vertical />
                  ))}

                  {EVEN_DEFS.map((d) => (
                    <PocketBtn key={d.betKey} betKey={d.betKey} gridArea={d.area}
                      label={d.label} colorCls={d.cls || styles.pocketDark}
                      ariaLabel={d.label || d.betKey} {...pocketShared} vertical />
                  ))}
                </div>
              )}

              {/* Inside bet overlays (desktop only) */}
              {!isMobile && (
                <>
                  <div className={styles.insideHitOverlay} ref={insideHitOverlayRef}>
                    {insideLayout.hitZones.map((z, i) => (
                      <button key={`${z.betKey}-${i}`} type="button"
                        className={`${styles.zone} ${hoverBetKey === z.betKey ? styles.zoneHover : ""}`}
                        data-betkey={z.betKey}
                        style={{ left: z.left, top: z.top, width: z.width, height: z.height }}
                        onMouseEnter={() => onEnterBet(z.betKey)}
                        onMouseLeave={onLeaveBet}
                        onClick={() => addChipToBet(z.betKey)}
                        disabled={spinning} />
                    ))}
                  </div>
                  <div className={styles.insideChipOverlay} ref={insideChipOverlayRef}>
                    {Array.from(placed.keys())
                      .filter((k) => /^(split|corner|street|sixline):/.test(k))
                      .map((betKey) => {
                        const a = insideLayout.chipAnchors.get(betKey);
                        if (!a) return null;
                        return renderStackAt(betKey, a.x, a.y);
                      })}
                  </div>
                </>
              )}
            </div>

            <div className={styles.tableFooter}>
              <button type="button" className={styles.undoBtn} onClick={undoBet} disabled={spinning}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 5L4 9l4 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 9h9.5a5.5 5.5 0 1 1 0 11H8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Undo
              </button>
              <button type="button" className={styles.clearBtn} onClick={clearBets} disabled={spinning}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Mobile wheel overlay */}
        {isMobile && mobileWheelOpen && (
          <div className={styles.mobileWheelOverlay}>
            <div className={styles.mobileWheelCard}>
              <div className={styles.mobileWheelInner}>
                <div className={styles.mobileResultBox}>
                  {shownResult != null && (
                    <span className={`${styles.resultNum} ${styles[`resultColor_${numberColor(shownResult)}`]}`}>
                      {shownResult}
                    </span>
                  )}
                </div>
                <div className={styles.mobileWheelWrap}>
                  <div className={styles.wheel} ref={wheelRef}>
                    <img src={wheelPng} alt="Wheel" draggable={false} />
                  </div>
                  <div className={`${styles.ballOrbit} ${!ballVisible ? styles.ballHidden : ""}`} ref={ballOrbitRef}>
                    <img src={ballPng} className={styles.ball} alt="Ball" draggable={false} />
                  </div>
                </div>
                <div className={styles.historyRow}>
                  {historyShown.map((n, idx) => (
                    <div key={`${n}-${idx}-m`} className={`${styles.histBall} ${styles[`histColor_${numberColor(n)}`]}`}>{n}</div>
                  ))}
                </div>
              </div>
              <button className={styles.mobileCloseBtn} type="button" onClick={() => setMobileWheelOpen(false)}>
                Close
              </button>
            </div>
          </div>
        )}

        {/* Floating drag chip */}
        {dragRef.current.active && dragRef.current.img && (
          <div className={styles.floatingChip} style={{ left: dragRef.current.x, top: dragRef.current.y }}>
            <img src={dragRef.current.img} alt="" draggable={false} />
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PocketBtn — A single board cell
// ============================================================

function PocketBtn({ 
  betKey, gridArea, label, cls, colorCls,
  hoverBetKey, hoverHighlightKeys, winningNumber,
  dataNum, onEnter, onLeave, onClick,
  disabled, placed, ariaLabel, vertical,
}) {
  const actualCls = colorCls || cls || "";
  const isHovered = hoverBetKey === betKey || hoverHighlightKeys.has(betKey);
  const isWinner = winningNumber != null && betKey === `straight:${winningNumber}`;

  const data = placed.get(betKey);
  const hasChips = data?.stacks?.length > 0;

  let className = `${styles.pocket} ${actualCls}`;
  if (isHovered) className += ` ${styles.pocketHover}`;
  if (isWinner) className += ` ${styles.pocketWinner}`;

  return (
    <button type="button" className={className} style={{ gridArea }}
      data-betkey={betKey}
      {...(dataNum != null ? { "data-num": dataNum } : {})}
      onMouseEnter={() => onEnter(betKey)}
      onMouseLeave={onLeave}
      onClick={() => onClick(betKey)}
      disabled={disabled}
      aria-label={ariaLabel || label || betKey}>
      <span className={styles.pocketName}
        style={vertical ? { writingMode: "vertical-lr" } : undefined}>
        {label}
      </span>
      {hasChips && (
        <div className={styles.stack}>
          <div className={styles.stackImgs}>
            {data.stacks.slice(-4).map((s, i) => (
              <img key={s.id} src={CHIP_IMG[s.value]} className={styles.stackChip}
                style={{ transform: `translateY(${-i * 5}px)` }} alt="" draggable={false} />
            ))}
          </div>
          <span className={styles.stackAmt}>{data.amount}</span>
        </div>
      )}
    </button>
  );
}