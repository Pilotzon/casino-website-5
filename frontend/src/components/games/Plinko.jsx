import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./plinko.module.css";
import Modal from "../common/Modal";

import useGameAudio from "../../hooks/useGameAudio";

// ✅ Plinko win sound
import plinkoWinMp3 from "../../assets/plinko/Win.mp3";
import CurrencyIcon from "../common/CurrencyIcon";
import { IconCaretDoubleDown } from "../common/Icons";

function stepIsRight(step) {
  if (typeof step === "string") return step.toLowerCase() === "right";
  if (typeof step === "boolean") return step;
  if (typeof step === "number") return step === 1;
  return false;
}

// MUST match backend tables (RNG.getPlinkoMultipliers)
const multiplierSets = {
  low: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    9: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6],
    10: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
    11: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    13: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1],
    14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
    15: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    9: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
    10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    11: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    13: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
    14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
    15: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    9: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
    10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    11: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    13: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
    14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

const getLocalMultipliers = (diff, r) => multiplierSets[diff]?.[r] ?? multiplierSets.low[16];

function bucketClassByIndex(index, count, stylesObj) {
  const center = (count - 1) / 2;
  const dist = Math.abs(index - center);
  const t = dist / (center || 1);

  if (t >= 0.88) return stylesObj.bucketRed;
  if (t >= 0.68) return stylesObj.bucketRed2;
  if (t >= 0.48) return stylesObj.bucketOrange;
  if (t >= 0.28) return stylesObj.bucketAmber;
  return stylesObj.bucketYellow;
}

function formatBucketLabel(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return String(m);

  if (n === 1000) return "1K";
  if (n === 620) return "620";
  if (n === 130) return "130";
  if (n === 110) return "110";

  return `${n}×`;
}

const format8 = (n) => Number(n || 0).toFixed(2); // 2 decimals everywhere

// Probability of landing in bucket k out of (rows+1) buckets
// In Plinko with n rows, ball makes n binary choices (L/R each 50%)
// Bucket k (0-indexed) = number of R choices = k
// P(bucket k) = C(n, k) / 2^n
function logGamma(z) {
  const p = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function plinkoBucketProbability(rowCount, bucketIndex) {
  // P = C(rows, bucketIndex) / 2^rows
  const lp = logChoose(rowCount, bucketIndex) - rowCount * Math.LN2;
  return Math.exp(lp);
}

const MAX_ACTIVE_BALLS = 28;
const CLICK_COOLDOWN_MS = 120;

const HISTORY_MAX = 4;
const HISTORY_ANIM_MS = 260;
const HISTORY_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function isMobileNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
}

function Plinko({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  // ✅ audio
  const sfx = useGameAudio(
    { win: plinkoWinMp3 },
    { enabled: soundEnabled, volume: soundVolume }
  );

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [betAmount, setBetAmount] = useState("");

  const [betError, setBetError] = useState(null);

  // inline bet errors clear themselves as soon as they are resolved

  useEffect(() => {

    setBetError((cur) => {

      if (!cur) return cur;

      if (cur === "Log in to place a bet") return isAuthenticated ? null : cur;

      const amt = parseFloat(betAmount) || 0;

      return amt > 0 && amt <= (user?.balance ?? 0) ? null : cur;

    });

  }, [betAmount, isAuthenticated, user?.balance]);
  const [rows, setRows] = useState(16);
  const [difficulty, setDifficulty] = useState("low");

  const [activeBucket, setActiveBucket] = useState(null);
  const [multipliers, setMultipliers] = useState(() => getLocalMultipliers(difficulty, rows));

  const [history, setHistory] = useState([]);
  const histIdRef = useRef(0);

  const [outgoing, setOutgoing] = useState(null);

  const [ripples, setRipples] = useState([]);
  const rippleIdRef = useRef(0);

  const [balls, setBalls] = useState([]);
  const ballRefs = useRef(new Map());
  const rafRefs = useRef(new Map());

  const lastClickRef = useRef(0);
  const idRef = useRef(0);

  const boardWrapRef = useRef(null);
  const BASE = 640;
  const [boardScale, setBoardScale] = useState(1);

  const historyRailRef = useRef(null);
  const prevRectsRef = useRef(new Map());
  const outgoingRef = useRef(null);
  const historySlotRef = useRef(null);

  // ===== Hover panel state =====
  const [hoverBucket, setHoverBucket] = useState(null); // bucket index or null
  const [hoverBucketRect, setHoverBucketRect] = useState(null); // { left, width } relative to bucketBar

  // ===== Mobile modal state =====
  const [modalBucket, setModalBucket] = useState(null); // bucket index or null
  const [modalOpen, setModalOpen] = useState(false);
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);

  const bucketBarRef = useRef(null);

  const bet = useMemo(() => parseFloat(betAmount) || 0, [betAmount]);

  // Hover info computation
  const hoverInfo = useMemo(() => {
    if (hoverBucket == null || isMobile) return null;
    const m = multipliers[hoverBucket];
    if (m == null) return null;
    const payout = bet * m;
    const profit = payout - bet;
    const chance = plinkoBucketProbability(rows, hoverBucket) * 100;
    return { multiplier: m, payout, profit, chance };
  }, [hoverBucket, multipliers, bet, rows, isMobile]);

  // Modal info computation
  const modalInfo = useMemo(() => {
    if (modalBucket == null) return null;
    const m = multipliers[modalBucket];
    if (m == null) return null;
    const payout = bet * m;
    const profit = payout - bet;
    const chance = plinkoBucketProbability(rows, modalBucket) * 100;
    return { bucketIndex: modalBucket, multiplier: m, payout, profit, chance };
  }, [modalBucket, multipliers, bet, rows]);

  // Arrow position for hover panel
  const hoverArrowLeftPercent = useMemo(() => {
    if (hoverBucket == null || !hoverBucketRect) return 50;
    // We position relative to the bucket bar width
    const barEl = bucketBarRef.current;
    if (!barEl) return 50;
    const barRect = barEl.getBoundingClientRect();
    const bucketCenterX = hoverBucketRect.left + hoverBucketRect.width / 2;
    const percent = ((bucketCenterX - barRect.left) / barRect.width) * 100;
    return Math.max(5, Math.min(95, percent));
  }, [hoverBucket, hoverBucketRect]);

  // Close modal on resize
  useEffect(() => {
    const onResize = () => setModalOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const measureRects = () => {
    const rail = historyRailRef.current;
    if (!rail) return new Map();
    const map = new Map();
    rail.querySelectorAll("[data-hist-id]").forEach((el) => {
      const id = el.getAttribute("data-hist-id");
      map.set(id, el.getBoundingClientRect());
    });
    return map;
  };

  const startOutgoingIfNeeded = () => {
    if (history.length < HISTORY_MAX) return;

    const last = history[HISTORY_MAX - 1];
    if (!last) return;

    const rail = historyRailRef.current;
    if (!rail) return;

    const lastEl = rail.querySelector(`[data-hist-id="${String(last.id)}"]`);
    if (!lastEl) return;

    const rect = lastEl.getBoundingClientRect();
    const slotRect = historySlotRef.current.getBoundingClientRect();

    setOutgoing({
      id: last.id,
      m: last.m,
      bucketIndex: last.bucketIndex,
      left: rect.left - slotRect.left,
      top: rect.top - slotRect.top,
      width: rect.width,
      height: rect.height,
    });
  };

  const pushHistory = (m, bucketIndex) => {
    startOutgoingIfNeeded();
    prevRectsRef.current = measureRects();

    const id = ++histIdRef.current;
    const item = { id, m, bucketIndex };
    setHistory((prev) => [item, ...prev].slice(0, HISTORY_MAX));
  };

  useLayoutEffect(() => {
    if (!outgoing) return;

    requestAnimationFrame(() => {
      const el = outgoingRef.current;
      if (!el) return;

      const itemH =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hist-item-h")) ||
        46;

      el.animate([{ transform: "translateY(0px)" }, { transform: `translateY(${itemH}px)` }], {
        duration: HISTORY_ANIM_MS,
        easing: HISTORY_EASING,
        fill: "forwards",
      });

      const t = setTimeout(() => setOutgoing(null), HISTORY_ANIM_MS);
      return () => clearTimeout(t);
    });
  }, [outgoing]);

  useLayoutEffect(() => {
    const rail = historyRailRef.current;
    if (!rail) return;

    const newRects = measureRects();
    const prevRects = prevRectsRef.current;

    if (!prevRects || prevRects.size === 0) {
      prevRectsRef.current = newRects;
      return;
    }

    rail.querySelectorAll("[data-hist-id]").forEach((el) => {
      const id = el.getAttribute("data-hist-id");
      const prevRect = prevRects.get(id);
      const newRect = newRects.get(id);

      if (!prevRect && newRect) {
        const itemH =
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hist-item-h")) ||
          46;

        el.animate([{ transform: `translateY(${-itemH}px)` }, { transform: "translateY(0px)" }], {
          duration: HISTORY_ANIM_MS,
          easing: HISTORY_EASING,
          fill: "both",
        });
        return;
      }

      if (prevRect && newRect) {
        const dy = prevRect.top - newRect.top;
        if (Math.abs(dy) < 0.5) return;

        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }], {
          duration: HISTORY_ANIM_MS,
          easing: HISTORY_EASING,
          fill: "both",
        });
      }
    });

    prevRectsRef.current = newRects;
  }, [history]);

  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || BASE;
      const h = el.clientHeight || BASE;

      const scaleW = w / BASE;
      const scaleH = h / BASE;

      const scale = Math.min(scaleW, scaleH * 1.08);
      // mobile: fit the FULL width exactly (no 0.96 shrink); the wrap's
      // height follows the scale so the board is centred with no gaps
      const finalScale = isMobile ? scaleW : scale * 0.96;

      setBoardScale(Math.max(isMobile ? 0.3 : 0.55, Math.min(isMobile ? 1.4 : 1, finalScale)));
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  const geom = useMemo(() => {
    const TOP_PINS = 3;

    const width = BASE;
    const height = BASE;

    const topPad = 46;
    const bottomPad = 74;
    const sidePad = 18;

    const usableW = width - sidePad * 2;
    const usableH = height - topPad - bottomPad;

    const rowGap = usableH / (rows - 1);
    const maxPinsInAnyRow = (rows - 1) + TOP_PINS;
    const colGap = usableW / (maxPinsInAnyRow - 1);

    const pins = [];
    for (let r = 0; r < rows; r++) {
      const countInRow = r + TOP_PINS;
      for (let c = 0; c < countInRow; c++) {
        const x = width / 2 + (c - (countInRow - 1) / 2) * colGap;
        const y = topPad + r * rowGap;
        pins.push({ r, c, x, y });
      }
    }

    const bucketCenters = Array.from({ length: rows + 1 }, (_, i) => {
      const x = width / 2 + (i - rows / 2) * colGap;
      const y = height - bottomPad + 18;
      return { x, y };
    });

    return { width, height, topPad, bottomPad, sidePad, rowGap, colGap, pins, bucketCenters };
  }, [rows]);

  const bucketW = useMemo(() => {
    const w = geom.colGap - 8;
    return Math.max(22, Math.min(70, w));
  }, [geom.colGap]);

  useEffect(() => {
    setMultipliers(getLocalMultipliers(difficulty, rows));
  }, [difficulty, rows]);

  useEffect(() => {
    for (const rafId of rafRefs.current.values()) cancelAnimationFrame(rafId);
    rafRefs.current.clear();
    ballRefs.current.clear();
    setBalls([]);
    setActiveBucket(null);
    setRipples([]);
    setHistory([]);
    setOutgoing(null);
    prevRectsRef.current = new Map();
    setHoverBucket(null);
    setHoverBucketRect(null);
    setModalOpen(false);
    setModalBucket(null);
  }, [rows, difficulty]);

  const adjustBet = (mult) => {
    const curr = Number.parseFloat(betAmount) || 0;
    setBetAmount((curr * mult).toFixed(2));
  };

  const spawnRipple = (x, y) => {
    const id = ++rippleIdRef.current;
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 240);
  };

  const setBallPos = (id, x, y) => {
    const el = ballRefs.current.get(id);
    if (!el) return;
    el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const simulateDrop = (ballId, path, finalIndex) =>
    new Promise((resolve) => {
      const g = 0.0045;
      const restitution = 0.62;
      const upKick = 0.085;
      const impulse = 0.395;
      const vxDamp = 0.896;
      const vyAirDamp = 0.999;
      const impactVyMin = 0.2;

      const maxVx = 0.26;
      const maxVy = 0.62;

      const ballRadius = 7;
      const pad = 14;

      let x = geom.width / 2;
      let y = geom.topPad - 28;

      let vx = 0;
      let vy = 0.06;

      const rowYs = Array.from({ length: rows }, (_, r) => geom.topPad + r * geom.rowGap);
      let nextRow = 0;
      let slot = 0;

      const bucket = geom.bucketCenters[finalIndex] ?? geom.bucketCenters[0];
      const bucketY = bucket.y - 8;

      let lastT = performance.now();

      setBallPos(ballId, x, y);

      const step = (t) => {
        if (!ballRefs.current.get(ballId)) return resolve(false);

        const dt = Math.min(18, t - lastT);
        lastT = t;

        vy = Math.min(maxVy, vy + g * dt);

        vx *= vxDamp;
        vy *= vyAirDamp;

        x += vx * dt;
        y += vy * dt;

        const minX = geom.sidePad + pad + ballRadius;
        const maxXb = geom.width - geom.sidePad - pad - ballRadius;

        if (x <= minX) {
          x = minX;
          vx = Math.abs(vx) * 0.55;
        } else if (x >= maxXb) {
          x = maxXb;
          vx = -Math.abs(vx) * 0.55;
        }

        if (nextRow < rows && y >= rowYs[nextRow] - 2 && vy > impactVyMin) {
          const goRight = stepIsRight(path[nextRow]);
          slot += goRight ? 1 : 0;

          const r = nextRow;
          const c = slot - (goRight ? 1 : 0);
          const pinX = geom.width / 2 + (c - r / 2) * geom.colGap;
          const pinY = rowYs[nextRow];

          x = x + (pinX - x) * 0.72;

          spawnRipple(pinX, pinY);

          vx += goRight ? impulse : -impulse;
          vx = clamp(vx, -maxVx, maxVx);

          vy = -Math.abs(vy) * restitution;
          vy -= upKick;

          nextRow += 1;
        }

        if (y >= bucketY) {
          setBallPos(ballId, bucket.x, bucketY);

          setActiveBucket(finalIndex);
          setTimeout(() => setActiveBucket(null), 180);

          return resolve(true);
        }

        setBallPos(ballId, x, y);
        const rafId = requestAnimationFrame(step);
        rafRefs.current.set(ballId, rafId);
      };

      const rafId = requestAnimationFrame(step);
      rafRefs.current.set(ballId, rafId);
    });

  const removeBall = (id) => {
    const rafId = rafRefs.current.get(id);
    if (rafId) cancelAnimationFrame(rafId);
    rafRefs.current.delete(id);
    ballRefs.current.delete(id);
    setBalls((prev) => prev.filter((b) => b.id !== id));
  };

  const handleBucketEnter = (index, e) => {
    if (isMobile) return;
    setHoverBucket(index);
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverBucketRect({ left: rect.left, width: rect.width });
  };

  const handleBucketLeave = () => {
    if (isMobile) return;
    setHoverBucket(null);
    setHoverBucketRect(null);
  };

  const handleBucketClick = (index) => {
    if (!isMobile) return;
    setModalBucket(index);
    setModalOpen(true);
  };

  const handleDrop = async () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }

    const now = Date.now();
    if (now - lastClickRef.current < CLICK_COOLDOWN_MS) return;
    lastClickRef.current = now;

    const amount = Number.parseFloat(betAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }
    if (balls.length >= MAX_ACTIVE_BALLS) return toast.error("Too many balls active");

    updateBalance((b) => b - amount);

    const id = ++idRef.current;
    setBalls((prev) => [...prev, { id }]);

    await new Promise((r) => requestAnimationFrame(r));

    let payoutForThisBall = 0;

    try {
      const response = await gamesAPI.playPlinko({ betAmount: amount, rows, difficulty });
      const res = response.data.result;

      payoutForThisBall = Number(res.payout) || 0;
      if (Array.isArray(res.multipliers)) setMultipliers(res.multipliers);

      const path = Array.isArray(res.path) ? res.path.slice(0, rows) : [];
      if (path.length !== rows) throw new Error("Invalid plinko path from server");

      const finalIndex = Number(res.finalPosition);
      if (!Number.isFinite(finalIndex)) throw new Error("Invalid final position");

      const ok = await simulateDrop(id, path, finalIndex);
      if (!ok) return;

      // ✅ play win sound when ball lands AND it is a win
      sfx.play("win", { volume: 1 });

      const mFromServer = Number(res.multiplier);
      const m = Number.isFinite(mFromServer)
        ? mFromServer
        : Number((res.multipliers ?? multipliers)?.[finalIndex] ?? 0);

      pushHistory(m, finalIndex);

      updateBalance((b) => b + payoutForThisBall);
    } catch (error) {
      updateBalance((b) => b + amount);
      toast.error(error.response?.data?.message || error.message || "Drop failed");
    } finally {
      setTimeout(() => removeBall(id), 120);
    }
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("plinko", balls.length > 0);


  const desktopHoverActive = !isMobile && hoverBucket != null && hoverInfo != null;

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${styles.active}`}>Manual</button>
          <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} type="button" disabled>Auto</button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Bet Amount</span>
            <span>$0.00</span>
          </div>

          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                placeholder="0.00" value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                step="0.00000001"
                              />
              <CurrencyIcon className={styles.btcIcon} />
            </div>

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)}>
                ½
              </button>
              <div className={styles.divider} />
              <button onClick={() => adjustBet(2)}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Risk</span>
          </div>
          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Rows</span>
          </div>
          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select
              value={rows}
              onChange={(e) => setRows(parseInt(e.target.value, 10))}
                          >
              {[8, 9, 10, 11, 12, 13, 14, 15, 16].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <span className="ui-bet-wrap">
          <button className={styles.betButton} disabled={isLocked || bet <= 0}
            onClick={handleDrop}
            data-bet-sound="true"
            title={isLocked ? betErrorMessage : undefined}>
          Bet
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <div className={styles.stageCard}>
            <div
              className={styles.boardWrap}
              ref={boardWrapRef}
              style={isMobile ? { height: Math.round(BASE * boardScale) } : undefined}
            >
              <div
                className={styles.boardStage}
                style={
                  isMobile
                    ? { width: "100%", display: "flex", justifyContent: "center" }
                    : undefined
                }
              >
                <div
                  className={styles.board}
                  style={{
                    width: geom.width,
                    height: geom.height,
                    transform: isMobile ? `translateX(-50%) scale(${boardScale})` : `scale(${boardScale})`,
                    transformOrigin: "top center",
                    ...(isMobile ? { position: "absolute", left: "50%", top: 0 } : null),
                    "--bucket-w": `${bucketW}px`,
                    "--bucket-h": rows <= 10 ? "32px" : "30px",
                  }}
                >
                  {geom.pins.map((p, idx) => (
                    <div key={idx} className={styles.pin} style={{ left: p.x, top: p.y }} />
                  ))}

                  {ripples.map((r) => (
                    <div key={r.id} className={styles.ripple} style={{ left: r.x, top: r.y }} />
                  ))}

                  {balls.map(({ id }) => (
                    <div
                      key={id}
                      ref={(el) => {
                        if (el) ballRefs.current.set(id, el);
                      }}
                      className={styles.ballInstance}
                    />
                  ))}

                  {/* Hover panel positioned above bucket bar — shared
                      read-only-input design (global.css), like Keno/Limbo */}
                  <div
                    className={`${styles.bucketHoverPanel} ${desktopHoverActive ? styles.bucketHoverPanelVisible : ""}`}
                  >
                    <div className={styles.bucketHoverBoxes}>
                      <div className={styles.bucketHoverBox}>
                        <div className={styles.bucketHoverLabel}>Payout</div>
                        <div className={styles.bucketHoverField}>
                          <input
                            className={styles.bucketHoverInput}
                            type="text"
                            readOnly
                            value={(hoverInfo ? hoverInfo.multiplier : 0).toFixed(2)}
                          />
                          <span className={styles.bucketHoverSuffix}>×</span>
                        </div>
                      </div>
                      <div className={styles.bucketHoverBox}>
                        <div className={styles.bucketHoverLabel}>Profit on Win</div>
                        <div className={styles.bucketHoverField}>
                          <input
                            className={styles.bucketHoverInput}
                            type="text"
                            readOnly
                            value={format8(hoverInfo ? hoverInfo.profit : 0)}
                          />
                          <span className={styles.bucketHoverSuffix}><CurrencyIcon /></span>
                        </div>
                      </div>
                      <div className={styles.bucketHoverBox}>
                        <div className={styles.bucketHoverLabel}>Chance</div>
                        <div className={styles.bucketHoverField}>
                          <input
                            className={styles.bucketHoverInput}
                            type="text"
                            readOnly
                            value={hoverInfo ? hoverInfo.chance.toFixed(9) : "0.000000000"}
                          />
                          <span className={styles.bucketHoverSuffix}>%</span>
                        </div>
                      </div>
                    </div>
                    <div
                      className={styles.bucketHoverArrow}
                      style={{ left: `${hoverArrowLeftPercent}%` }}
                      aria-hidden="true"
                    />
                  </div>

                  <div className={styles.bucketBar} ref={bucketBarRef}>
                    {multipliers.map((m, i) => {
                      const cx = geom.bucketCenters[i]?.x ?? 0;
                      const colorClass = bucketClassByIndex(i, multipliers.length, styles);
                      return (
                        <div
                          key={i}
                          className={`${styles.bucketWrap} ${activeBucket === i ? styles.bucketPressed : ""}`}
                          style={{ left: cx }}
                          onMouseEnter={(e) => handleBucketEnter(i, e)}
                          onMouseLeave={handleBucketLeave}
                          onClick={() => handleBucketClick(i)}
                        >
                          <div className={`${styles.bucket} ${colorClass}`}>{formatBucketLabel(m)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className={styles.historySlot} ref={historySlotRef}>
                {outgoing && (
                  <div
                    ref={outgoingRef}
                    className={styles.historyOutgoing}
                    style={{
                      left: outgoing.left,
                      top: outgoing.top,
                      width: outgoing.width,
                      height: outgoing.height,
                    }}
                  >
                    <div
                      className={`${styles.historyPill} ${bucketClassByIndex(
                        outgoing.bucketIndex,
                        multipliers.length,
                        styles
                      )}`}
                      style={{ height: "100%" }}
                    >
                      {formatBucketLabel(outgoing.m)}
                    </div>
                  </div>
                )}

                <div
                  ref={historyRailRef}
                  className={`${styles.historyRail} ${history.length === 0 ? styles.historyRailHidden : ""}`}
                  aria-label="Multiplier history"
                >
                  {history.map((h) => {
                    const colorClass = bucketClassByIndex(h.bucketIndex, multipliers.length, styles);
                    return (
                      <div key={h.id} data-hist-id={String(h.id)} className={styles.historyItem}>
                        <div className={`${styles.historyPill} ${colorClass}`}>{formatBucketLabel(h.m)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mobile modal for bucket info */}
        <Modal
          isOpen={modalOpen && !!modalInfo}
          onClose={() => setModalOpen(false)}
          title="Bucket"
          icon={<IconCaretDoubleDown />}
          description="Payout when the ball lands here."
        >
          {modalInfo && (
            <>
              <div className={styles.bucketModalNumber}>{modalInfo.multiplier}×</div>
              <div className={styles.bucketModalGrid}>
                <div className={styles.bucketModalItem}>
                  <div className={styles.bucketModalItemLabel}>Payout</div>
                  <div className={styles.bucketModalItemValue}>{modalInfo.multiplier.toFixed(2)}×</div>
                </div>

                <div className={styles.bucketModalItem}>
                  <div className={styles.bucketModalItemLabel}>Profit on Win</div>
                  <div className={styles.bucketModalItemValue}>
                    {format8(modalInfo.profit)}
                    <CurrencyIcon className={styles.bucketModalBtc} />
                  </div>
                </div>

                <div className={styles.bucketModalItem}>
                  <div className={styles.bucketModalItemLabel}>Chance</div>
                  <div className={styles.bucketModalItemValue}>{modalInfo.chance.toFixed(9)}%</div>
                </div>
              </div>

              <button
                className={styles.bucketModalBtnPrimary}
                onClick={() => setModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}

export default Plinko;