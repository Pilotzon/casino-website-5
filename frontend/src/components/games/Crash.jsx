import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
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
const POLL_LIVE_MS = 250;       // reconciliation poll while a round is live
const POLL_IDLE_MS = 4000;      // slow poll while nothing is happening
const POLL_HIDDEN_MS = 2000;    // tab in background
const CRASH_RED = '#EF005E';    // crashed multiplier (red text)
const CRASH_DEAD = '#2E4552';   // line + fill colour once the round crashed
const LINE_WIDTH = 3;           // white curve stroke (screen px)

/**
 * The line's drop shadow, cast onto the solid fill underneath. dy is in board
 * units (the plot is 100 units tall); the layers fade out downwards, and every
 * layer stays black at 50% → ~10%, exactly like a real shadow.
 */
const LINE_SHADOW_LAYERS = [
  { dy: 0.5, alpha: 0.5, width: 3.6 },
  { dy: 1.1, alpha: 0.26, width: 3.2 },
  { dy: 1.8, alpha: 0.12, width: 2.8 },
];

/* ------------------------------------------------------------------ utils */
const SAMPLES = 140; // path resolution (per frame, per layer)
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

/**
 * Build the SVG path of the curve for the currently visible window.
 * Returns the line, the (solid) area under it, the tip position and the
 * shadow layers — all derived from the SAME samples, so the tip marker, the
 * shadow and the line can never disagree.
 */
function buildCurve({ elapsed, dispX, dispY, k, tipMult }) {
  const tMax = Math.max(0, Math.min(elapsed, dispX));
  const toX = (t) => (t / dispX) * 100;
  const toY = (m) => 100 - ((Math.min(Math.max(m, 1), dispY) - 1) / (dispY - 1)) * 100;

  const path = (dy) => {
    let out = '';
    for (let i = 0; i <= SAMPLES; i += 1) {
      const t = (i / SAMPLES) * tMax;
      const x = toX(t);
      const y = clamp(toY(Math.exp(k * t)) + dy, -4, 104);
      out += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    }
    return out.trim();
  };

  if (tMax <= 0.001) {
    const y0 = clamp(toY(1), 0, 100);
    return { line: '', area: '', tipX: 0, tipY: y0, shadows: [] };
  }

  let line = path(0);
  const tipX = toX(tMax);
  const tipY = clamp(toY(tipMult ?? Math.exp(k * tMax)), 0, 100);
  // close the line exactly on the tip value that the marker uses
  line += ` L${tipX.toFixed(2)},${tipY.toFixed(2)}`;
  const area = `${line} L${tipX.toFixed(2)},100 L0,100 Z`;
  const shadows = LINE_SHADOW_LAYERS.map((layer) => path(layer.dy));
  return { line, area, tipX, tipY, shadows };
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
  const [totalStartAt, setTotalStartAt] = useState(() => Date.now()); // "Total Ns"
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
  const autoToastedRef = useRef(null);  // roundId already toasted for auto cashout
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const lastBalanceRef = useRef(null);
  const cooldownActiveRef = useRef(false);
  const lastSecondRef = useRef(0);                 // "Total Ns" tick detection
  const lastFrameAtRef = useRef(0);                // render-pump watchdog
  const totalStartAtRef = useRef(Date.now());      // "Total Ns" origin (page load / last bet)

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
      startedAtRef.current = round.startedAt;
      if (round.crashPoint != null) crashPointRef.current = round.crashPoint;

      // Clock sanity: if our own time base is off by more than 8%, realign it
      // with the multiplier the server reports. (The server value is floored to
      // 2 decimals, so small differences are expected and must NOT cause churn.)
      const srvMult = Number(round.currentMultiplier);
      if (Number.isFinite(srvMult) && srvMult > 1.0001) {
        const clientMult = Math.exp(growthKRef.current * Math.max(0, (serverNow() - round.startedAt) / 1000));
        if (clientMult > srvMult * 1.08 || clientMult < srvMult * 0.92) {
          const wantedElapsedMs = (Math.log(srvMult) / growthKRef.current) * 1000;
          serverOffsetRef.current += round.startedAt + wantedElapsedMs - serverNow();
        }
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
  }, [setPhaseSafe, toast, updateBalance]);

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
  // The multiplier, the camera and the curve are all PURE functions of the
  // current time (see the render body), so this loop only decides *when* to
  // repaint. Nothing is smoothed in a ref, which is what removes the old
  // "the graph keeps rising but the multiplier stops, then jumps" behaviour.
  //
  // It is also armed defensively: a body that throws (or a browser that paused
  // requestAnimationFrame, e.g. a background tab) can never leave the board
  // frozen — a 1.5s heartbeat re-arms the loop and repaints either way.
  useEffect(() => {
    let raf = null;
    let stopped = false;

    const repaint = () => setFrame((f) => (f + 1) % 1000000);

    const loop = () => {
      if (stopped) return;
      lastFrameAtRef.current = Date.now();
      try {
        const st = phaseRef.current;
        const running = st === 'running' || st === 'cashedOut';

        // repaint the moment the post-round cooldown expires (Bet button)
        const cooldownLeft = cooldownRef.current - serverNow();
        let tickle = false;
        if (cooldownLeft > 0) {
          cooldownActiveRef.current = true;
          tickle = true;
        } else if (cooldownActiveRef.current) {
          cooldownActiveRef.current = false;
          tickle = true;
        }

        // the "Total Ns" counter ticks once per second
        const second = Math.floor((Date.now() - totalStartAtRef.current) / 1000);
        if (second !== lastSecondRef.current) {
          lastSecondRef.current = second;
          tickle = true;
        }

        if (running || tickle) repaint();
      } catch (err) {
        console.error('[crash] render pump error:', err);
      }
      raf = requestAnimationFrame(loop);
    };

    const arm = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    arm();

    // heartbeat: also keeps the board moving if rAF is throttled to a stop
    const watchdog = setInterval(() => {
      if (stopped) return;
      const stale = Date.now() - (lastFrameAtRef.current || 0);
      if (stale > 2000) arm();
      const st = phaseRef.current;
      if (st === 'running' || st === 'cashedOut' || cooldownRef.current > serverNow()) repaint();
      else {
        const second = Math.floor((Date.now() - totalStartAtRef.current) / 1000);
        if (second !== lastSecondRef.current) repaint();
      }
    }, 1500);

    return () => {
      stopped = true;
      clearInterval(watchdog);
      if (raf) cancelAnimationFrame(raf);
    };
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
      setTotalStartAt(Date.now());          // "Total Ns" restarts with the bet
      totalStartAtRef.current = Date.now();
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

  // Everything below is a PURE function of the current time — no ref-based
  // smoothing — so the number, the curve, the tip marker and the camera can
  // never drift apart or freeze while the graph keeps moving (see the pump).
  const elapsed = isLive
    ? Math.max(0, (nowServer - startedAtRef.current) / 1000)
    : (phase === 'ended' && lastRound?.crashPoint > 1 ? Math.log(lastRound.crashPoint) / k : 0);

  // The multiplier stops exactly at the crash point.
  const rawMult = isLive ? Math.exp(k * elapsed) : (phase === 'ended' ? (lastRound?.crashPoint ?? 1) : 1);
  const displayedMult = crashPointRef.current != null && isLive
    ? Math.min(rawMult, crashPointRef.current)
    : rawMult;
  const crashReached = (isLive && crashPointRef.current != null && displayedMult >= crashPointRef.current - 1e-9)
    || phase === 'ended';

  // Camera: the visible span grows 10% AHEAD of the tip, continuously from the
  // first frame, so the tip can never touch the right wall (it used to teleport
  // left when it did).
  const dispX = Math.max(X_MIN_SPAN_S, elapsed * X_HEADROOM);
  const dispY = Math.max(Y_MIN_CEIL, displayedMult * Y_HEADROOM);

  const { line: curveLine, area: curveArea, tipX, tipY, shadows: curveShadows } = useMemo(
    () => buildCurve({ elapsed, dispX, dispY, k, tipMult: displayedMult }),
    // re-computed on every repaint on purpose (the rAF pump drives this)
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
  // "Total Ns" — NOT part of the chart: it simply counts seconds since the
  // board was loaded (so it starts at 0 on every refresh) and restarts with
  // every new bet.
  const totalSeconds = Math.max(0, Math.floor((Date.now() - totalStartAt) / 1000));

  const showBoard = phase !== 'boot';
  const showCurve = phase !== 'idle' && phase !== 'boot';
  const isCrashedView = phase === 'ended' && !!lastRound;

  // ---- board colors (line + solid fill turn steel blue once it crashed)
  const multColor = crashReached ? CRASH_RED : '#ffffff';
  const fillColor = crashReached ? CRASH_DEAD : '#FB9D08';
  const lineColor = crashReached ? CRASH_DEAD : '#ffffff';

  // ---- status box: ONLY shown when there is something to say.
  //   • auto/manual cash-out  -> "Cashed Out 2.00×" (multiplier in green)
  //   • the round crashed     -> "Crashed" (white text)
  //   • a new bet             -> disappears (nothing is rendered)
  let statusContent = null;
  if (crashReached) {
    statusContent = <span className={styles.statusCrashed}>Crashed</span>;
  } else if (isLive && cashout) {
    statusContent = (
      <>
        Cashed Out <span className={styles.statusGreen}>{fmt(cashout.multiplier ?? displayedMult)}×</span>
      </>
    );
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
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("crash", isLive);


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
              {/* Y axis (gray labels centred on the spine, no grid) */}
              <div className={styles.yAxis}>
                <div className={styles.yAxisSpine} />
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
                  {/* solid area under the curve (never a gradient) */}
                  {showCurve && curveArea && <path d={curveArea} fill={fillColor} />}
                  {/* drop shadow of the line, cast onto the fill below it */}
                  {showCurve && curveShadows.map((d, i) => (
                    <path
                      key={`sh-${i}`}
                      d={d}
                      fill="none"
                      stroke="#000000"
                      strokeOpacity={LINE_SHADOW_LAYERS[i].alpha}
                      strokeWidth={LINE_SHADOW_LAYERS[i].width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {showCurve && curveLine && (
                    <path
                      d={curveLine}
                      fill="none"
                      stroke={lineColor}
                      strokeWidth={LINE_WIDTH}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>

                {/* Tip marker — sits exactly on the tip of the curve */}
                {showCurve && (isLive || phase === 'ended') && (
                  <div
                    className={styles.tipMarker}
                    style={{
                      left: `${clamp(tipX, 0, 99.6)}%`,
                      // tipY is an SVG coordinate (0 = top); `bottom` counts
                      // from the bottom, hence 100 - tipY.
                      bottom: `${clamp(100 - tipY, 0, 100)}%`,
                    }}
                  />
                )}

                {/* Multiplier + status box UNDER it (only when it says something) */}
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

              {/* X axis — seconds (white, no axis line). The total counter is
                  NOT part of the axis: it counts from 0 on every refresh. */}
              <div className={styles.xAxis}>
                {xTicks.map((t) => (
                  <div key={t} className={styles.xTick} style={{ left: `${(t / dispX) * 100}%` }}>
                    {t}s
                  </div>
                ))}
                <div className={styles.xTotal}>Total {totalSeconds}s</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Crash;
