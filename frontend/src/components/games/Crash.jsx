import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { gamesAPI } from '../../services/api';
import Stepper from "../common/Stepper";
import useGameDisabled from "../../hooks/useGameDisabled";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import styles from './crash.module.css';

/**
 * ===========================================================================
 *  Crash — solo round, Stake-style board.
 * ===========================================================================
 *  The BACKEND is the source of truth (see backend/src/services/crashHandler.js):
 *   • every endpoint answers with one identical "state" payload, and the UI is
 *     rendered straight from it — no guessing, no duplicated money logic;
 *   • the crash point is never known client-side before it happens, so the
 *     board simply polls `/crash/state` (~4/s) while a round is live and is
 *     corrected immediately when the round ends — even in another tab;
 *   • a round that ended is *always* re-renderable (last round + history come
 *     with every payload), which is what makes a page refresh safe: nothing is
 *     drawn until that payload exists (`phase === 'boot'`).
 *
 *  Chart notes (see crash.module.css for the visual spec):
 *   • area under the curve = SOLID #FB9D08 (no gradient), white curve;
 *   • no grid lines — only the two axis lines of the board;
 *   • the "camera" (visible span) only ever grows, and it grows by 10% BEFORE
 *     the tip touches the right wall, then eases into place over ~160ms, so
 *     the tip can never jump backwards when it reaches the wall.
 */

const GROWTH_K_DEFAULT = 0.066; // m(t) = e^(k*t) — mirrors the backend
const X_MIN_SPAN_S = 12;        // first 12s of every round are shown 1:1
const Y_MIN_CEIL = 2.3;         // visible multiplier ceiling at the start
const X_HEADROOM = 1.1;         // camera grows 10% ahead of the tip
const Y_HEADROOM = 1.1;
const CAMERA_TAU_MS = 160;      // camera easing (never a jump)
const MULT_TAU_MS = 70;         // tiny numeric smoothing (hides poll jitter)
const POLL_LIVE_MS = 250;       // reconciliation poll while a round is live
const POLL_IDLE_MS = 4000;      // slow poll while nothing is happening
const POLL_HIDDEN_MS = 2000;    // tab in background
const CRASH_RED = '#EF005E'; // crashed multiplier / red text

/* ------------------------------------------------------------------ utils */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (m) => Number(m ?? 1).toFixed(2);

/** Y label set: nice steps, at most ~9 labels (positions use the smooth span). */
function yTickValues(ceiling) {
  const ceilingSafe = Math.max(1.05, ceiling);
  const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (ceilingSafe / s <= 10) { step = s; break; }
  }
  const out = [];
  for (let i = 0; i * step < ceilingSafe + step * 0.35; i += 1) {
    const v = 1 + i * step;
    if (v > ceilingSafe + step * 0.349) break;
    out.push(Math.round(v * 1000) / 1000);
  }
  return out.slice(0, 10);
}

function yTickLabel(v) {
  if (v < 10) return `${v.toFixed(2)}×`;
  if (v < 100) return `${v.toFixed(1)}×`;
  return `${v.toFixed(0)}×`;
}

/** Snap the visible ceiling onto a stable ladder so the label set rarely changes. */
function snapCeilY(v) {
  const ladder = [2.3, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80,
    100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000,
    15000, 20000, 50000, 100000, 200000, 500000, 1000000];
  for (const l of ladder) if (l >= v - 1e-9) return l;
  return 1000000;
}

function xTickValues(span) {
  const spanSafe = Math.max(1, span);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (spanSafe / s <= 10) { step = s; break; }
  }
  const out = [];
  // keep the label row clear of the "Total Ns" label on the right
  for (let t = step; t <= spanSafe * 0.86; t += step) out.push(Math.round(t));
  return out;
}

/** Build the SVG path of the curve for the currently visible window. */
function buildCurve({ elapsed, dispX, dispY, k, tipMult }) {
  const tMax = Math.max(0, Math.min(elapsed, dispX));
  const toX = (t) => (t / dispX) * 100;
  const toY = (m) => 100 - ((Math.min(Math.max(m, 1), dispY) - 1) / (dispY - 1)) * 100;

  if (tMax <= 0.001) return { line: '', area: '', tipX: 0, tipY: 100 };

  const SAMPLES = 140;
  let line = '';
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = (i / SAMPLES) * tMax;
    const x = toX(t);
    const y = clamp(toY(Math.exp(k * t)), 0, 100);
    line += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  const tipX = toX(tMax);
  const tipY = clamp(toY(tipMult ?? Math.exp(k * tMax)), 0, 100);
  // close the tip exactly on the smoothed live value
  line += `L${tipX.toFixed(2)},${tipY.toFixed(2)} `;
  line = line.trim();
  const area = `${line} L${tipX.toFixed(2)},100 L0,100 Z`;
  return { line, area, tipX, tipY };
}

/* =============================================================== component */
function Crash({ gameRow }) {
  const { user, isAuthenticated, updateBalance } = useAuth();
  const toast = useToast();

  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } =
    useGameDisabled(gameRow);

  /* -------------------------------------------------------- sidebar inputs */
  const [betAmount, setBetAmount] = useState('');
  const [autoCashout, setAutoCashout] = useState('2.00');
  const [betError, setBetError] = useState(null);
  const [betLockedError, setBetLockedError] = useState("");

  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);

  useEffect(() => {
    if (!betError) return;
    if (betError === "Log in to place a bet") {
      if (isAuthenticated) setBetError(null);
      return;
    }
    const amt = parseFloat(betAmount) || 0;
    if (amt > 0 && amt <= (user?.balance ?? 0)) setBetError(null);
  }, [betAmount, isAuthenticated, user?.balance, betError]);

  const betAmountNum = parseFloat(betAmount) || 0;
  const autoCashoutNum = Math.max(1.01, parseFloat(autoCashout) || 2.0);

  /* ------------------------------------------------------------ game state */
  // boot   -> nothing known yet (refresh-safe: the board stays empty)
  // idle   -> no round yet, board empty
  // running / cashedOut -> a live round owned by this user
  // ended  -> the last finished round is on the board, betting is available
  const [phase, setPhase] = useState('boot');
  const [history, setHistory] = useState([]);          // newest first (server order)
  const [lastRound, setLastRound] = useState(null);    // finished round on the board
  const [activeBet, setActiveBet] = useState(null);    // { betAmount, autoCashout }
  const [cashout, setCashout] = useState(null);        // { multiplier, payout }
  const [cooldownEndsAt, setCooldownEndsAt] = useState(0);
  const [busy, setBusy] = useState(false);             // request in flight
  const [, setFrame] = useState(0);                    // rAF render pump

  /* ----------------------------------------------------------------- refs */
  const phaseRef = useRef('boot');
  const startedAtRef = useRef(0);
  const crashPointRef = useRef(null);   // only ever set when the round is over for us
  const growthKRef = useRef(GROWTH_K_DEFAULT);
  const serverOffsetRef = useRef(0);    // serverNow - Date.now()
  const activeBetRef = useRef(null);
  const lastRoundRef = useRef(null);
  const cooldownRef = useRef(0);
  const multRef = useRef(1);            // smoothed multiplier (render source)
  const viewRef = useRef({ spanX: X_MIN_SPAN_S, spanY: Y_MIN_CEIL });
  const roundKeyRef = useRef(null);     // resets the camera when a round changes
  const autoToastedRef = useRef(null);  // roundId already toasted for auto cashout
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const lastBalanceRef = useRef(null);
  const cooldownActiveRef = useRef(false);

  const serverNow = () => Date.now() + serverOffsetRef.current;

  // Set by the polling effect: lets a freshly started round be polled at once
  // instead of waiting for the next (slow, idle) tick.
  const pollPokeRef = useRef(null);

  const setPhaseSafe = useCallback((next) => {
    const changed = phaseRef.current !== next;
    phaseRef.current = next;
    setPhase(next);
    if (changed && (next === 'running' || next === 'cashedOut')) pollPokeRef.current?.(true);
  }, []);

  /* --------------------------------------------------- state application */
  /** Reset the chart camera for a round that starts (or that we adopt). */
  const resetCamera = useCallback((elapsedS = 0, mult = 1) => {
    const spanX = Math.max(X_MIN_SPAN_S, elapsedS * X_HEADROOM);
    const spanY = Math.max(Y_MIN_CEIL, mult * Y_HEADROOM);
    viewRef.current = { spanX, spanY };
  }, []);

  /**
   * THE single place where server state becomes UI state. Every endpoint
   * (start / cashout / stop / state poll) returns the same payload, so the
   * client can never drift away from the server.
   */
  const applyState = useCallback((d) => {
    if (!d || typeof d !== 'object') return;
    if (typeof d.serverNow === 'number') serverOffsetRef.current = d.serverNow - Date.now();
    if (typeof d.growthK === 'number' && d.growthK > 0) growthKRef.current = d.growthK;
    if (Array.isArray(d.history)) setHistory(d.history);
    if (typeof d.balance === 'number' && Math.abs((lastBalanceRef.current ?? -1) - d.balance) > 1e-9) {
      lastBalanceRef.current = d.balance;
      updateBalance(d.balance);
    }
    if (typeof d.cooldownEndsAt === 'number') {
      cooldownRef.current = d.cooldownEndsAt;
      setCooldownEndsAt(d.cooldownEndsAt);
    } else if (d.cooldownEndsAt === null) {
      cooldownRef.current = 0;
      setCooldownEndsAt(0);
    }

    const round = d.active ? d.round : null;

    if (round) {
      // ---- a live round we own (fresh bet, another tab, or after refresh)
      const isNewRound = roundKeyRef.current !== round.roundId;
      roundKeyRef.current = round.roundId;
      startedAtRef.current = round.startedAt;
      if (round.crashPoint != null) crashPointRef.current = round.crashPoint;

      const elapsedS = Math.max(0, (serverNow() - round.startedAt) / 1000);
      const mult = Math.max(1, round.currentMultiplier ?? Math.exp(growthKRef.current * elapsedS));
      if (isNewRound) {
        resetCamera(elapsedS, mult);
        multRef.current = mult; // no growth ramp when adopting a running round
      }

      const bet = { betAmount: round.betAmount, autoCashout: round.autoCashout ?? null };
      activeBetRef.current = bet;
      setActiveBet(bet);
      setLastRound(null);
      lastRoundRef.current = null;
      setBetAmount(String(round.betAmount));
      if (round.autoCashout) setAutoCashout(String(round.autoCashout));

      if (round.cashedOut) {
        setCashout({ multiplier: round.cashoutMultiplier, payout: round.payout });
        if (round.autoCashout && autoToastedRef.current !== round.roundId && round.cashoutMultiplier >= round.autoCashout - 1e-9) {
          autoToastedRef.current = round.roundId;
          toast.success(`Auto cashed out at ${fmt(round.cashoutMultiplier)}× · +${Number(round.payout ?? 0).toFixed(2)}`);
        }
        setPhaseSafe('cashedOut');
      } else {
        setCashout(null);
        setPhaseSafe('running');
      }
      return;
    }

    // ---- no live round for us
    const ended = d.lastRound || null;
    if (ended) {
      roundKeyRef.current = null;
      crashPointRef.current = ended.crashPoint ?? null;
      lastRoundRef.current = ended;
      setLastRound(ended);
      activeBetRef.current = null;
      setActiveBet(null);
      setCashout(ended.cashedOut ? { multiplier: ended.cashoutMultiplier, payout: ended.payout } : null);
      if (phaseRef.current === 'boot' || phaseRef.current === 'running' || phaseRef.current === 'cashedOut' || phaseRef.current === 'ended') {
        setPhaseSafe('ended');
      }
      return;
    }

    if (phaseRef.current === 'boot') {
      setPhaseSafe('idle');
    } else if (phaseRef.current === 'running' || phaseRef.current === 'cashedOut') {
      // server says the round is gone but has no record for us: don't get stuck
      setPhaseSafe('idle');
    }
    activeBetRef.current = null;
    setActiveBet(null);
    setCashout(null);
    lastRoundRef.current = null;
    setLastRound(null);
  }, [resetCamera, setPhaseSafe, toast, updateBalance]);

  // The reconciliation loop must NOT restart every time React re-renders
  // (the render pump runs at 60fps and context callbacks change identity) —
  // so it always calls the latest applier through this ref.
  const applyStateRef = useRef(applyState);
  useEffect(() => { applyStateRef.current = applyState; });

  /* --------------------------------------------------------- initial load */
  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    setPhaseSafe('boot');
    roundKeyRef.current = null;
    multRef.current = 1;
    resetCamera(0, 1);

    (async () => {
      // 1) public snapshot — FINISHED rounds only, so nothing can leak and the
      //    pills/last round are already correct on the very first paint.
      try {
        const res = await gamesAPI.crashLast();
        if (!cancelled) applyStateRef.current(res.data?.data);
      } catch { /* offline / rate limited — phase 2 will sort it out */ }

      // 2) authoritative state for this user (live round, if any)
      if (isAuthenticated) {
        try {
          const res = await gamesAPI.crashState();
          if (!cancelled) applyStateRef.current(res.data?.data);
        } catch { /* ignore */ }
      }

      if (!cancelled && phaseRef.current === 'boot') setPhaseSafe('idle');
    })();

    return () => { cancelled = true; mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  /* ------------------------------------------------------------- polling */
  // One self-scheduling reconciliation poll for the whole page lifetime:
  //   • 250ms while a round is live  (crash / cash-out is applied in <=250ms)
  //   • 4s when idle, 2s in a hidden tab
  // The loop is independent of React re-renders (the render pump runs at
  // 60fps) and is poked for an immediate tick whenever a round starts. The
  // backend settles rounds on its own timers, so even a completely stalled
  // poll can never lose a bet or leave a round "active" forever.
  useEffect(() => {
    if (!isAuthenticated || isLocked) return undefined;
    let stopped = false;
    let inFlight = false;
    let timer = null;

    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const live = () => phaseRef.current === 'running' || phaseRef.current === 'cashedOut';

    const runTick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await gamesAPI.crashState();
        if (!stopped) applyStateRef.current(res.data?.data);
      } catch (e) {
        // swallow: a failed poll must never break the game loop
      }
      inFlight = false;
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden && !live()) {
        timer = setTimeout(runTick, POLL_HIDDEN_MS);
      } else {
        timer = setTimeout(runTick, live() ? POLL_LIVE_MS : POLL_IDLE_MS);
      }
    };

    pollPokeRef.current = (immediate) => {
      clear();
      timer = setTimeout(runTick, immediate ? 0 : (live() ? POLL_LIVE_MS : POLL_IDLE_MS));
    };
    pollPokeRef.current(false);

    const onVisible = () => { if (!document.hidden) pollPokeRef.current?.(true); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clear();
      pollPokeRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isLocked]);

  /* ------------------------------------------------- animation render pump */
  useEffect(() => {
    let raf = null;
    let last = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const loop = (ts) => {
      const dt = clamp(ts - last, 8, 120);
      last = ts;

      const st = phaseRef.current;
      const k = growthKRef.current;
      const view = viewRef.current;

      // ---- target multiplier (the exact game value)
      let target = 1;
      let elapsedS = 0;
      if (st === 'running' || st === 'cashedOut') {
        elapsedS = Math.max(0, (serverNow() - startedAtRef.current) / 1000);
        target = Math.exp(k * elapsedS);
        if (crashPointRef.current != null) target = Math.min(target, crashPointRef.current);
      } else if (st === 'ended') {
        const cp = lastRoundRef.current?.crashPoint;
        target = cp != null ? cp : multRef.current;
        elapsedS = cp != null && cp > 1 ? Math.log(cp) / k : 0;
      } else {
        target = 1;
      }

      // ---- smooth the number so a slow poll can never make it snap, then land
      //      EXACTLY on the target (crash point / adopted value) so the board
      //      never freezes half a hundredth away from the real number
      const diff = target - multRef.current;
      let moving = false;
      if (Math.abs(diff) < 0.0005) {
        if (multRef.current !== target) { multRef.current = target; moving = true; }
      } else {
        multRef.current += diff * (1 - Math.exp(-dt / MULT_TAU_MS));
        moving = true;
      }

      // ---- camera: grows 10% ahead of the tip, eases instead of jumping
      const wantX = Math.max(X_MIN_SPAN_S, elapsedS * X_HEADROOM);
      const wantY = Math.max(Y_MIN_CEIL, multRef.current * Y_HEADROOM);
      const ease = 1 - Math.exp(-dt / CAMERA_TAU_MS);
      if (wantX > view.spanX) view.spanX += (wantX - view.spanX) * ease;
      if (wantY > view.spanY) view.spanY += (wantY - view.spanY) * ease;

      // ---- keep re-rendering only while something is actually moving, plus
      //      one extra frame when the post-round cooldown runs out (so the
      //      Bet button is re-enabled the moment it is allowed)
      const cooldownLeft = cooldownRef.current - serverNow();
      let tickle = false;
      if (cooldownLeft > 0) {
        cooldownActiveRef.current = true;
        tickle = true;
      } else if (cooldownActiveRef.current) {
        cooldownActiveRef.current = false;
        tickle = true;
      }

      const running = st === 'running' || st === 'cashedOut';
      if (running || moving || tickle) {
        setFrame((f) => (f + 1) % 1000000);
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------- actions */
  const handleBet = useCallback(async () => {
    if (busyRef.current) return;
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { toast.error('Please login to play'); setBetError("Log in to place a bet"); return; }

    const amt = parseFloat(betAmount);
    if (isNaN(amt) || amt <= 0) { setBetError("Enter a valid bet amount"); return; }
    if (amt > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }

    const p = phaseRef.current;
    if (p === 'running' || p === 'cashedOut') { toast.error('Round already in progress'); return; }
    if (cooldownRef.current > serverNow()) return; // the button is disabled anyway

    busyRef.current = true;
    setBusy(true);
    try {
      const res = await gamesAPI.crashStart({ betAmount: amt, autoCashout: autoCashoutNum });
      if (!mountedRef.current) return;
      setBetError(null);
      applyState(res.data?.data);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e.response?.data?.message || e.message || 'Bet failed';
      setBetError(msg);
      toast.error(msg);
      // the backend attaches its current state so we can resync instantly
      const state = e.response?.data?.data;
      if (state) applyState(state);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [applyState, autoCashoutNum, betAmount, betErrorMessage, isAuthenticated, isLocked, toast, user?.balance]);

  const handleCashout = useCallback(async () => {
    if (busyRef.current) return;
    if (phaseRef.current !== 'running' || !activeBetRef.current) return;

    busyRef.current = true;
    setBusy(true);
    try {
      const res = await gamesAPI.crashCashout();
      if (!mountedRef.current) return;
      const d = res.data?.data;
      applyState(d);
      if (d?.crashed) toast.error('Crashed before your cash out went through');
      else if (d?.cashedOut) toast.success(`Cashed out at ${fmt(d.multiplier)}× · +${Number(d.payout ?? 0).toFixed(2)}`);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e.response?.data?.message || e.message || 'Cash out failed';
      toast.error(msg);
      const state = e.response?.data?.data;
      if (state) applyState(state);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [applyState, toast]);

  const handleStop = useCallback(async () => {
    if (busyRef.current) return;
    if (phaseRef.current !== 'cashedOut') return;

    busyRef.current = true;
    setBusy(true);
    try {
      const res = await gamesAPI.crashStop();
      if (!mountedRef.current) return;
      applyState(res.data?.data);
    } catch (e) {
      if (!mountedRef.current) return;
      const state = e.response?.data?.data;
      if (state) applyState(state);
      else {
        // last resort: ask for the truth instead of guessing
        try {
          const res = await gamesAPI.crashState();
          if (mountedRef.current) applyState(res.data?.data);
        } catch { /* ignore */ }
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [applyState]);

  const adjustBet = (val) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * val).toFixed(2));
  };

  /* ---------------------------------------------------------------- render */
  const isLive = phase === 'running' || phase === 'cashedOut';
  const k = growthKRef.current || GROWTH_K_DEFAULT;
  const nowServer = serverNow();

  const elapsed = isLive
    ? Math.max(0, (nowServer - startedAtRef.current) / 1000)
    : (phase === 'ended' && lastRound?.crashPoint > 1 ? Math.log(lastRound.crashPoint) / k : 0);

  const displayedMult = multRef.current;
  const { spanX: dispX, spanY: dispY } = viewRef.current;

  const { line: curveLine, area: curveArea, tipX, tipY } = useMemo(
    () => buildCurve({ elapsed, dispX, dispY, k, tipMult: displayedMult }),
    // re-computed every animation frame on purpose (frame is the pump)
    [elapsed, dispX, dispY, k, displayedMult]
  );

  const yTicks = useMemo(
    // keep every label fully inside the board (96% of the visible height)
    () => yTickValues(snapCeilY(dispY)).filter((v) => v <= 1 + (dispY - 1) * 0.96 + 1e-9),
    [dispY]
  );
  const xTicks = useMemo(() => xTickValues(dispX), [Math.floor(dispX)]); // eslint-disable-line react-hooks/exhaustive-deps

  const cooldownLeft = Math.max(0, cooldownEndsAt - nowServer);
  const inCooldown = cooldownLeft > 0;

  const showBoard = phase !== 'boot';
  const showCurve = phase !== 'idle' && phase !== 'boot';

  // ---- board colors
  const isCrashedView = phase === 'ended' && !!lastRound;
  const multColor = isCrashedView ? CRASH_RED : '#ffffff';

  // ---- status box content
  let statusContent = null;
  if (phase === 'running') {
    statusContent = <span className={styles.statusMuted}>—</span>;
  } else if (phase === 'cashedOut') {
    statusContent = (
      <>
        Cashed Out <span className={styles.statusGreen}>{fmt(cashout?.multiplier ?? displayedMult)}×</span>
      </>
    );
  } else if (phase === 'ended') {
    if (lastRound?.cashedOut) {
      statusContent = (
        <>
          Cashed Out <span className={styles.statusGreen}>{fmt(lastRound.cashoutMultiplier)}×</span>
        </>
      );
    } else {
      statusContent = <span className={styles.statusRed}>Crashed</span>;
    }
  }

  // ---- action button
  let actionLabel = 'Bet';
  let actionClass = styles.betButton;
  let actionHandler = handleBet;
  let actionDisabled = false;

  if (isLocked) {
    actionDisabled = true;
  } else if (phase === 'boot') {
    actionDisabled = true;
  } else if (phase === 'running') {
    actionLabel = 'Cash Out';
    actionClass = styles.cashoutBtn;
    actionHandler = handleCashout;
    actionDisabled = busy || !activeBet;
  } else if (phase === 'cashedOut') {
    actionLabel = 'Stop';
    actionClass = styles.stopBtn;
    actionHandler = handleStop;
    actionDisabled = busy;
  } else if (phase === 'ended' || phase === 'idle') {
    actionHandler = handleBet;
    actionDisabled = busy || inCooldown;
    if (inCooldown) actionLabel = `Wait ${Math.max(1, Math.ceil(cooldownLeft / 1000))}s`;
  }

  // ---- profit column
  const profitValue = (() => {
    if (phase === 'cashedOut') return Number(cashout?.payout ?? 0) - (activeBet?.betAmount ?? 0);
    if (phase === 'running' && activeBet) return activeBet.betAmount * Math.max(0, autoCashoutNum - 1);
    if (phase === 'ended' && lastRound) return Number(lastRound.netProfit ?? 0);
    return betAmountNum * (autoCashoutNum - 1);
  })();
  const profitLabel = phase === 'ended' && lastRound?.cashedOut ? 'Profit' : 'Profit on Win';

  /* ---------------------------------------------------------------------- */
  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${styles.active}`} type="button">Manual</button>
          <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} type="button" disabled>Auto</button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Bet Amount</span>
            <span>${(user?.balance ?? 0).toFixed(2)}</span>
          </div>
          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                placeholder="0.00"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                step="0.00000001"
                disabled={isLive || busy}
              />
              <span className={styles.btcIcon}>$</span>
            </div>
            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isLive}>½</button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isLive}>2×</button>
            </div>
          </div>
          <BetError message={betLockedError} />
          <BetError message={betError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Auto Cashout</span>
          </div>
          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                value={autoCashout}
                onChange={(e) => setAutoCashout(e.target.value)}
                step="0.01"
                disabled={isLive || busy}
              />
              <span className={styles.btcIcon}>×</span>
            </div>
            <Stepper
              value={autoCashout}
              onChange={setAutoCashout}
              step={0.1}
              min={1.01}
              decimals={2}
              disabled={isLive || busy}
            />
          </div>
        </div>

        <button
          className={actionClass}
          onClick={actionHandler}
          data-bet-sound="true"
          disabled={actionDisabled}
          title={isLocked ? betErrorMessage : undefined}
        >
          {actionLabel}
          {phase === 'running' && activeBet && (
            <span className={styles.btnMult}> {fmt(displayedMult)}×</span>
          )}
        </button>
        {inCooldown && phase !== 'running' && phase !== 'cashedOut' && (
          <div className={styles.cooldownHint}>
            Next round available in {Math.max(1, Math.ceil(cooldownLeft / 1000))}s
          </div>
        )}

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>{profitLabel}</span>
            <span>${(profitValue > 0 ? profitValue : 0).toFixed(2)}</span>
          </div>
          <div className={styles.readonlyInput}>
            <input type="text" value={`${(profitValue > 0 ? profitValue : 0).toFixed(2)}`} readOnly />
            <span className={styles.btcIcon}>$</span>
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
            {/* History pills — newest at the right, older continue to the left */}
            <div className={styles.historyRow}>
              <div className={styles.historyPills}>
                {history.map((h) => (
                  <span
                    key={`${h.roundId}-${h.at}`}
                    className={`${styles.histPill} ${h.won ? styles.histGreen : styles.histGray}`}
                  >
                    {fmt(h.value)}×
                  </span>
                ))}
              </div>
              <button className={styles.historyIcon} type="button" aria-label="My bets">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M7 8h10M7 12h6M7 16h8" />
                </svg>
              </button>
              <span className={styles.historyYou}>‹ You</span>
            </div>

            {/* Board */}
            <div className={styles.chartWrap}>
              {/* Y axis (gray labels, no grid) */}
              <div className={styles.yAxis}>
                {yTicks.map((v) => (
                  <div
                    key={v}
                    className={styles.yTick}
                    style={{ bottom: `${clamp(((v - 1) / (dispY - 1)) * 100, 0, 100)}%` }}
                  >
                    {yTickLabel(v)}
                  </div>
                ))}
              </div>

              {/* Plot area */}
              <div className={styles.plotArea}>
                <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none">
                  {showCurve && curveArea && (
                    <path d={curveArea} fill="#FB9D08" />
                  )}
                  {showCurve && curveLine && (
                    <path
                      d={curveLine}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>

                {/* Only the axis lines — no grid */}
                <div className={styles.axisLineY} />
                <div className={styles.axisLineX} />

                {/* Tip marker */}
                {showCurve && (isLive || phase === 'ended') && (
                  <div
                    className={styles.tipMarker}
                    style={{ left: `${clamp(tipX, 0, 99.6)}%`, bottom: `${clamp(tipY, 0, 100)}%` }}
                  />
                )}

                {/* Multiplier + status box UNDER it */}
                {showBoard && phase !== 'idle' && (
                  <div className={styles.centerOverlay}>
                    <div
                      className={`${styles.centerMult} ${isCrashedView ? styles.centerMultCrashed : ''}`}
                      style={{ color: multColor }}
                    >
                      {fmt(displayedMult)}
                      <span className={styles.centerX}>×</span>
                    </div>
                    {statusContent && <div className={styles.statusBox}>{statusContent}</div>}
                  </div>
                )}
              </div>

              {/* X axis — seconds (white). The total is NOT part of the axis. */}
              <div className={styles.xAxis}>
                {xTicks.map((t) => (
                  <div key={t} className={styles.xTick} style={{ left: `${(t / dispX) * 100}%` }}>
                    {t}s
                  </div>
                ))}
                <div className={styles.xTotal}>Total {Math.round(Math.max(X_MIN_SPAN_S, dispX))}s</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Crash;
