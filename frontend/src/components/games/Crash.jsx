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
 *   • area under the curve = SOLID #FB9D08 (no gradient), white curve, muted
 *     #2E4552 on crash, one soft blurred shadow under it;
 *   • no grid lines — only the two axis lines of the board;
 *   • the "camera" (visible span) only ever grows and always keeps 10% of
 *     headroom ahead of the tip, so the tip can never reach (and jump off) the
 *     right wall; once the crash point is known both the curve and the camera
 *     are clipped to that moment, so nothing creeps right after the crash;
 *   • the multiplier, the curve, the tip, the camera and the "Total Ns"
 *     counter are PURE functions of the current time (see the render pump) —
 *     no value is ever smoothed in a ref, which is what used to make the
 *     number stall and then jump while the graph kept moving.
 */

const GROWTH_K_DEFAULT = 0.066; // m(t) = e^(k*t) — mirrors the backend
const OFFSET_SAMPLES = 8;       // server clock samples kept (≈2s at the live poll rate)
const X_MIN_SPAN_S = 12;        // first 12s of every round are shown 1:1
const Y_MIN_CEIL = 2.3;         // visible multiplier ceiling at the start
const X_HEADROOM = 1.1;         // camera grows 10% ahead of the tip
const Y_HEADROOM = 1.1;
const POLL_LIVE_MS = 250;       // reconciliation poll while a round is live
const POLL_IDLE_MS = 4000;      // slow poll while nothing is happening
const POLL_HIDDEN_MS = 2000;    // tab in background
const CRASH_RED = '#EF005E';    // crashed multiplier (red text)
const CRASH_DEAD = '#2E4552';   // line + fill colour once the round crashed
const LINE_WIDTH = 8;           // white curve stroke (screen px)
const SHADOW_DY = 1.2;          // shadow offset, board units (plot is 100 tall)
const SHADOW_ALPHA = 0.3;       // soft shadow under the line (not a hard copy)

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

/**
 * X ticks are SECONDS of the round, on exactly the same scale the curve is
 * drawn with (both divide by `dispX`), so dropping a perpendicular from the tip
 * of the graph onto the axis lands on the second that has really passed.
 *
 * The step is picked to keep the row readable: one tick per second while the
 * visible span is short (that is when the player checks the position), and
 * coarser steps for long rounds. Phones get fewer labels (the plot is narrow).
 *
 * The rightmost part of the row belongs to the "Total Ns" label on desktop, so
 * desktop ticks stop earlier; on phones the clock lives at the top of the stage
 * (see .stageTotal), which frees the whole axis row.
 */
function xTickValues(span, compact, limit = 0.85) {
  const spanSafe = Math.max(1, span);
  const maxTicks = compact ? 6 : 12;
  const steps = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600];
  let step = steps[steps.length - 1];
  for (const st of steps) {
    if (spanSafe / st <= maxTicks) { step = st; break; }
  }
  const out = [];
  for (let t = step; t <= spanSafe * limit; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/** Phone/tablet breakpoint that matches the CSS (max-width: 900px). */
function useCompactAxis() {
  const query = '(max-width: 900px)';
  const read = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try { return window.matchMedia(query).matches; } catch { return false; }
  };
  const [compact, setCompact] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setCompact(mq.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
    return undefined;
  }, []);
  return compact;
}

/**
 * Build the SVG path of the curve for the currently visible window.
 * Everything (line, solid area, tip position, shadow) comes from the SAME
 * samples, so the tip marker, the shadow and the line can never disagree.
 *
 * `capMult` is the crash point when it is known: the curve is then drawn only
 * up to the crash moment, so the tip can never creep further right (that used
 * to look like the line rising while the dot only moved sideways).
 */
function buildCurve({ elapsed, dispX, dispY, k, tipMult, capMult }) {
  const tMax = Math.max(0, Math.min(elapsed, dispX));
  const toX = (t) => (t / dispX) * 100;
  const toY = (m) => 100 - ((Math.min(Math.max(m, 1), dispY) - 1) / (dispY - 1)) * 100;
  const mAt = (t) => {
    const m = Math.exp(k * t);
    return capMult != null ? Math.min(m, capMult) : m;
  };

  const path = (dy) => {
    let out = '';
    for (let i = 0; i <= SAMPLES; i += 1) {
      const t = (i / SAMPLES) * tMax;
      const x = toX(t);
      const y = clamp(toY(mAt(t)) + dy, -4, 104);
      out += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    }
    return out.trim();
  };

  if (tMax <= 0.001) {
    const y0 = clamp(toY(1), 0, 100);
    return { line: '', area: '', tipX: 0, tipY: y0, shadow: '' };
  }

  let line = path(0);
  const tipX = toX(tMax);
  const tipY = clamp(toY(tipMult ?? mAt(tMax)), 0, 100);
  // close the line exactly on the tip value the marker uses
  line += ` L${tipX.toFixed(2)},${tipY.toFixed(2)}`;
  const area = `${line} L${tipX.toFixed(2)},100 L0,100 Z`;
  return { line, area, tipX, tipY, shadow: path(SHADOW_DY) };
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
  const [tickLimit, setTickLimit] = useState(0.85);     // right-hand room for ticks
  const [, setFrame] = useState(0);                   // rAF render pump

  /* ----------------------------------------------------------------- refs */
  const phaseRef = useRef('boot');
  const startedAtRef = useRef(0);
  const crashPointRef = useRef(null);   // only ever set when the round is over for us
  const growthKRef = useRef(GROWTH_K_DEFAULT);
  const serverOffsetRef = useRef(0);    // serverNow - Date.now()
  const offsetSamplesRef = useRef([]);  // recent (stamp - Date.now()) samples
  const activeBetRef = useRef(null);
  const lastRoundRef = useRef(null);
  const cooldownRef = useRef(0);
  const autoToastedRef = useRef(null);  // roundId already toasted for auto cashout
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const lastBalanceRef = useRef(null);
  const lastStateAtRef = useRef(0);                // newest server timestamp applied
  const endedRoundsRef = useRef([]);               // round ids already seen finished
  const cashoutPendingRef = useRef(false);         // optimistic cash-out in flight
  const roundIdRef = useRef(null);                 // round currently on the board
  const cooldownActiveRef = useRef(false);
  const lastFrameAtRef = useRef(0);                // render-pump watchdog
  const historyScrollRef = useRef(null);           // horizontal pill scroller (mobile)
  const axisRowRef = useRef(null);                 // X axis row (tick clearance)
  const axisClockRef = useRef(null);               // "Total Ns" label in that row

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

    // ---- ignore STALE responses -------------------------------------------
    // Requests can finish out of order (a 250ms poll sent after a cash-out can
    // land before its response, especially on a slow link). Applying the older
    // payload would "un-crash" the board — the round briefly showed Crashed,
    // then went back to normal and the toast appeared seconds later.
    const stamp = Number(d.serverNow);
    if (Number.isFinite(stamp)) {
      if (stamp + 1 < lastStateAtRef.current) {
        // A slow response may still carry terminal news about the round we are
        // showing (e.g. the answer to our cash-out that says "too late, it
        // crashed"). "The round is over" can never be walked back, so it is
        // always safe to apply — dropping it left the board running forever.
        const endedId = d.lastRound?.roundId ?? null;
        const terminal = d.active === false && !!endedId && endedId === roundIdRef.current;
        if (!terminal) return; // older than what we show: ignore it
      }
      lastStateAtRef.current = Math.max(lastStateAtRef.current, stamp);

      // ---- stable clock estimate -----------------------------------------
      // `stamp` is stamped when the server *builds* the payload, so the
      // measured offset is always (true offset - network/queue delay). Using
      // the newest sample directly made the time base jump BACKWARDS whenever
      // a slow response landed: the multiplier dipped, the curve and the tip
      // slid left, and the board looked like it had frozen for a moment.
      // Keeping the best (largest) offset of the last few samples makes the
      // base monotone, so time on the board only ever moves forward.
      const samples = offsetSamplesRef.current;
      samples.push(stamp - Date.now());
      if (samples.length > OFFSET_SAMPLES) samples.shift();
      serverOffsetRef.current = Math.max(...samples);
    }
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

    const liveRoundId = d.active && d.round ? d.round.roundId : null;

    // A round we already saw FINISHED can never become live again — such a
    // payload is ignored (the balance/history above are still applied) so a
    // late response can never "un-crash" the board.
    if (liveRoundId && endedRoundsRef.current.includes(liveRoundId)) return;

    const round = d.active ? d.round : null;

    if (round) {
      // ---- a live round we own (fresh bet, another tab, or after refresh)
      // A NEW round must never inherit anything from the previous one — most
      // importantly the crash point (otherwise the fresh round instantly showed
      // as "Crashed" whenever the old crash point was just above 1.00x).
      if (round.roundId !== roundIdRef.current) {
        roundIdRef.current = round.roundId;
        crashPointRef.current = null;
        cashoutPendingRef.current = false;
        autoToastedRef.current = null;
      }
      startedAtRef.current = round.startedAt;
      if (round.crashPoint != null) crashPointRef.current = round.crashPoint;

      // Clock sanity: if our own time base is off by more than 8%, realign it
      // with the multiplier the server reports. (The server value is floored to
      // 2 decimals, so small differences are expected and must NOT cause churn.)
      const srvMult = Number(round.currentMultiplier);
      if (Number.isFinite(srvMult) && srvMult > 1.0001) {
        const clientMult = Math.exp(growthKRef.current * Math.max(0, (serverNow() - round.startedAt) / 1000));
        // Only ever correct FORWARD (we are behind the server). A correction
        // that moves the clock back would rewind the graph — the sample window
        // above already fixes a fast client clock on its own.
        if (clientMult < srvMult * 0.92) {
          const wantedElapsedMs = (Math.log(srvMult) / growthKRef.current) * 1000;
          const wanted = round.startedAt + wantedElapsedMs - Date.now();
          if (wanted > serverOffsetRef.current) {
            serverOffsetRef.current = wanted;
            offsetSamplesRef.current = [wanted];
          }
        }
      }

      const bet = { betAmount: round.betAmount, autoCashout: round.autoCashout ?? null };
      activeBetRef.current = bet;
      setActiveBet(bet);
      setLastRound(null);
      lastRoundRef.current = null;

      // Our own cash-out is on its way to the server: keep the optimistic
      // cash-out view until the response (or the server state) confirms it,
      // instead of flipping back to "running" on the next poll.
      if (!round.cashedOut && cashoutPendingRef.current) return;

      setBetAmount(String(round.betAmount));
      if (round.autoCashout) setAutoCashout(String(round.autoCashout));

      if (round.cashedOut) {
        cashoutPendingRef.current = false;
        setCashout({ multiplier: round.cashoutMultiplier, payout: round.payout });
        if (round.autoCashout && autoToastedRef.current !== round.roundId && round.cashoutMultiplier >= round.autoCashout - 1e-9) {
          autoToastedRef.current = round.roundId;
          // another tab/device cashed out before us: say so (the local
          // cash-out path already toasted for this device)
          toast.success(`Cashed out at ${fmt(round.cashoutMultiplier)}× · +${Number(round.payout ?? 0).toFixed(2)}`);
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
      if (ended.roundId && !endedRoundsRef.current.includes(ended.roundId)) {
        endedRoundsRef.current = [...endedRoundsRef.current.slice(-4), ended.roundId];
      }
      if (ended.roundId) roundIdRef.current = ended.roundId;
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
  // repaint. Nothing is smoothed in a ref, which is what removed the old
  // "the graph keeps rising but the multiplier stops, then jumps" behaviour.
  //
  // Two drivers keep the board moving smoothly:
  //   • requestAnimationFrame (the normal 60fps path), and
  //   • a 40ms timer that takes over whenever rAF has not run for 60ms
  //     (throttled/embedded frames) — that is what used to look like the board
  //     "freezing for a moment and then jumping", because the only updates left
  //     were the 250ms server polls.
  useEffect(() => {
    let raf = null;
    let stopped = false;

    const repaint = () => setFrame((f) => (f + 1) % 1000000);
    let rafRuns = 0;      // counts real rAF callbacks
    let seenRafRuns = 0;

    // one pump step: decide whether this frame needs a repaint
    const tick = () => {
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

        if (running || tickle) repaint();
      } catch (err) {
        console.error('[crash] render pump error:', err);
      }
    };

    const loop = () => {
      if (stopped) return;
      rafRuns += 1;
      tick();
      raf = requestAnimationFrame(loop);
    };

    const arm = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    arm();

    // timer driver: keeps ~25fps even if rAF is throttled, and re-arms rAF if
    // it stopped completely (a frozen tab, an error inside a frame, …)
    const driver = setInterval(() => {
      if (stopped) return;
      if (rafRuns === seenRafRuns) {
        // requestAnimationFrame did not fire in this window → drive the
        // board from the timer so it keeps animating smoothly
        tick();
      } else {
        seenRafRuns = rafRuns;
      }
      if (Date.now() - (lastFrameAtRef.current || 0) > 1500) arm();
    }, 40);

    return () => {
      stopped = true;
      clearInterval(driver);
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

    // ---- optimistic: show the cash-out immediately -------------------------
    // On a slow link the round used to sit there "frozen" for seconds after the
    // click, and only then did the box and the toast appear. The number shown
    // is the multiplier for right now (the same formula the server uses); the
    // server response below is still the truth and can override it.
    const nowMult = Math.min(
      Math.exp((growthKRef.current || GROWTH_K_DEFAULT) * Math.max(0, (serverNow() - startedAtRef.current) / 1000)),
      crashPointRef.current ?? Number.POSITIVE_INFINITY
    );
    const estMult = Math.max(1, Math.floor(nowMult * 100) / 100);
    const estPayout = Math.max(0, Math.round((activeBetRef.current?.betAmount ?? 0) * estMult * 1e8) / 1e8);
    cashoutPendingRef.current = true;
    setCashout({ multiplier: estMult, payout: estPayout, pending: true });
    setPhaseSafe('cashedOut');

    busyRef.current = true;
    setBusy(true);
    try {
      const res = await gamesAPI.crashCashout();
      if (!mountedRef.current) return;
      const d = res.data?.data;
      cashoutPendingRef.current = false;
      applyState(d);
      if (d?.crashed) toast.error('Crashed before your cash out went through');
      else if (d?.cashedOut) toast.success(`Cashed out at ${fmt(d.multiplier)}× · +${Number(d.payout ?? 0).toFixed(2)}`);
    } catch (e) {
      if (!mountedRef.current) return;
      cashoutPendingRef.current = false;
      const msg = e.response?.data?.message || e.message || 'Cash out failed';
      toast.error(msg);
      const state = e.response?.data?.data;
      if (state) {
        applyState(state);
      } else {
        // nothing authoritative came back: fall back to the truth on the server
        setCashout(null);
        setPhaseSafe('running');
        try {
          const res = await gamesAPI.crashState();
          if (mountedRef.current) applyState(res.data?.data);
        } catch { /* the poll will sort it out */ }
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [applyState, setPhaseSafe, toast]);

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
  const compactAxis = useCompactAxis();

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

  // The graph is drawn only up to the crash moment once that is known (after a
  // cash-out, or once the round ended). Without this cap the curve kept rising
  // while the clamped multiplier/dot stayed put — the tip then looked like it
  // was sliding sideways instead of climbing.
  const capMult = phase === 'ended' ? (lastRound?.crashPoint ?? null) : crashPointRef.current;
  const crashElapsedS = capMult != null && capMult > 1 ? Math.log(capMult) / k : null;
  const drawElapsed = crashElapsedS != null ? Math.min(elapsed, crashElapsedS) : elapsed;

  // Camera: the visible span grows 10% AHEAD of the tip, continuously from the
  // first frame, so the tip can never touch the right wall (it used to teleport
  // left when it did). Once the crash is reached everything freezes.
  const dispX = Math.max(X_MIN_SPAN_S, drawElapsed * X_HEADROOM);
  const dispY = Math.max(Y_MIN_CEIL, displayedMult * Y_HEADROOM);

  const { line: curveLine, area: curveArea, tipX, tipY, shadow: curveShadow } = useMemo(
    () => buildCurve({ elapsed: drawElapsed, dispX, dispY, k, tipMult: displayedMult, capMult }),
    // re-computed on every repaint on purpose (the rAF pump drives this)
    [drawElapsed, dispX, dispY, k, displayedMult, capMult]
  );

  const yTicks = useMemo(
    // keep every label fully inside the board (96% of the visible height)
    () => yTickValues(snapCeilY(dispY)).filter((v) => v <= 1 + (dispY - 1) * 0.96 + 1e-9),
    [dispY]
  );
  // The tick list follows the visible span exactly (no rounding of the
  // dependency): every label then sits on its true second of the same scale
  // the curve uses — see xTickValues().
  const xTicks = useMemo(
    () => xTickValues(dispX, compactAxis, tickLimit),
    [dispX, compactAxis, tickLimit]
  );

  // When the pill row is scrollable (phones), a newly added round must stay in
  // view: scroll the freshest pill back into the right-hand edge.
  useEffect(() => {
    const el = historyScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const newest = el.firstElementChild?.firstElementChild;
    if (newest && typeof newest.scrollIntoView === 'function') {
      newest.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }, [history]);

  const cooldownLeft = Math.max(0, cooldownEndsAt - nowServer);
  const inCooldown = cooldownLeft > 0;
  // "Total Ns" — NOT part of the chart axis: it is the elapsed time OF THE
  // ROUND, taken from the round's own start time on the server. That makes it
  // identical on every device and after a page refresh (the old version counted
  // since *this tab* loaded, so a refresh mid-round reset it to 0), it keeps
  // running through a cash-out, and it stops by itself at the crash, because
  // the elapsed time is clipped to the crash moment.
  //
  // It is rounded to the NEAREST second (= the second the curve is currently
  // on), not floored: flooring made the clock lag the graph by up to a second
  // (6.9s read as "6s" while the tip was already right next to the 7s tick),
  // which is exactly the mismatch between the clock and the X axis.
  const totalSeconds = (() => {
    if (isLive) {
      const secs = (nowServer - startedAtRef.current) / 1000;
      const capped = crashElapsedS != null ? Math.min(secs, crashElapsedS) : secs;
      return Math.max(0, Math.round(capped));
    }
    // A finished round keeps showing the length it had — also while the board
    // is still 'idle' (a refreshed page that restored the last round from the
    // server), so the number never contradicts the board.
    if (phase !== 'boot' && lastRound) {
      const { startedAt, endedAt, crashPoint } = lastRound;
      if (startedAt != null && endedAt != null) return Math.max(0, Math.round((endedAt - startedAt) / 1000));
      if (crashPoint > 1) return Math.max(0, Math.round(Math.log(crashPoint) / k)); // rounds restored from the DB
    }
    return 0;
  })();

  // How far to the right the tick labels may go: the end of the row belongs to
  // the clock on desktop, so it is measured (clock width + a small gap) instead
  // of guessed — that lets the ticks run all the way to the tip of the curve on
  // wide screens while never colliding with the clock. Without layout (tests,
  // SSR) the safe default is kept.
  useEffect(() => {
    const measure = () => {
      const row = axisRowRef.current;
      if (!row || !row.clientWidth) return;
      const clock = axisClockRef.current;
      const clockW = clock && clock.offsetWidth ? clock.offsetWidth + 14 : 0;
      setTickLimit(Math.min(0.98, Math.max(0.5, (row.clientWidth - clockW) / row.clientWidth)));
    };
    measure();
    const row = axisRowRef.current;
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && row) {
      ro = new ResizeObserver(measure);
      ro.observe(row);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [compactAxis, totalSeconds]);

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
            {/* History pills — newest at the right, older continue to the left.
                On phones the wrapper scrolls sideways instead of clipping. */}
            <div className={styles.historyRow}>
              <div className={styles.historyScroll} ref={historyScrollRef}>
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
              </div>
              <button className={styles.historyIcon} type="button" aria-label="My bets">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M7 8h10M7 12h6M7 16h8" />
                </svg>
              </button>
              <span className={styles.historyYou}>‹ You</span>
            </div>

            {/* Round clock, phone layout only: top right, right under the pills
                (on desktop it lives at the end of the X axis row instead). */}
            <div className={styles.stageTotal}>
              <span className={styles.xTotalTop}>Total {totalSeconds}s</span>
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
                    <span className={styles.yTickBox}>{yTickLabel(v)}</span>
                  </div>
                ))}
              </div>

              {/* Plot area */}
              <div className={styles.plotArea}>
                <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    {/* ONE soft, blurred shadow instead of stacked hard copies */}
                    <filter id="crashShadowBlur" x="-15%" y="-15%" width="130%" height="130%">
                      <feGaussianBlur stdDeviation="0.55" />
                    </filter>
                  </defs>
                  {/* solid area under the curve (never a gradient) */}
                  {showCurve && curveArea && <path d={curveArea} fill={fillColor} />}
                  {/* the line's shadow, cast onto the fill below it */}
                  {showCurve && curveShadow && (
                    <path
                      d={curveShadow}
                      fill="none"
                      stroke="#000000"
                      strokeOpacity={SHADOW_ALPHA}
                      strokeWidth={LINE_WIDTH + 0.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      filter="url(#crashShadowBlur)"
                    />
                  )}
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
                    className={`${styles.tipMarker} ${crashReached ? styles.tipMarkerCrashed : ''}`}
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
              <div className={styles.xAxis} ref={axisRowRef}>
                {xTicks.map((t) => (
                  <div key={t} className={styles.xTick} style={{ left: `${(t / dispX) * 100}%` }}>
                    {t}s
                  </div>
                ))}
                <div className={`${styles.xTotal} ${styles.xTotalAxis}`} ref={axisClockRef}>Total {totalSeconds}s</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Crash;
