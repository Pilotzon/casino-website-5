import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { gamesAPI } from '../../services/api';
import Stepper from "../common/Stepper";
import useGameDisabled from "../../hooks/useGameDisabled";
import useBetSound from "../../hooks/useBetSound";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import styles from './crash.module.css';

/**
 * Solo Crash game:
 *  - Each user runs their own round; no multiplayer feed, no websockets.
 *  - Chart uses SVG with exponential curve m(t) = e^(k*t).
 *  - History pills start empty; gray = loss/no bet, green = cashed-out win.
 *  - Axes stay at their INITIAL fixed range until the line hits the right
 *    wall, THEN rescale together to keep the tip pinned near the right edge.
 *  - After cashout the graph continues animating to the crash point; the
 *    action button becomes a "Stop" (viewer-only) button.
 */

const GROWTH_K_DEFAULT = 0.066; // fallback if server doesn't return one
const Y_TICKS = [1.0, 1.3, 1.5, 1.8, 2.0, 2.3];
const X_TICKS = [3, 6, 8, 11];
const INITIAL_TOTAL_S = 12; // Total Ns shown before hitting right wall
const TICK_POLL_MS = 400;  // server reconciliation tick
const RAF_MS = 16;

function formatMult(m) {
  if (m >= 100) return m.toFixed(2);
  if (m >= 10) return m.toFixed(2);
  return m.toFixed(2);
}

function Crash({ gameRow }) {
  const { user, isAuthenticated, refreshUser } = useAuth();
  const toast = useToast();

  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } =
    useGameDisabled(gameRow);

  // -- Sidebar inputs
  const [betAmount, setBetAmount] = useState('');
  const [autoCashout, setAutoCashout] = useState('2.00');
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);
  const [betError, setBetError] = useState(null);
  useEffect(() => {
    if (!betError) return;
    if (betError === "Log in to place a bet") {
      if (isAuthenticated) setBetError(null);
      return;
    }
    const amt = parseFloat(betAmount) || 0;
    if (amt > 0 && amt <= (user?.balance ?? 0)) setBetError(null);
  }, [betAmount, isAuthenticated, user?.balance, betError]);

  // -- Game phase state
  const [phase, setPhase] = useState('idle'); // idle | running | cashedOut | crashed
  const [crashPoint, setCrashPoint] = useState(null);     // revealed only on crash (or after cashout response)
  const [serverSeed, setServerSeed] = useState(null);
  const [startedAt, setStartedAt] = useState(0);
  const [growthK, setGrowthK] = useState(GROWTH_K_DEFAULT);
  const [roundId, setRoundId] = useState(null);
  const [liveMultiplier, setLiveMultiplier] = useState(1.0);
  const [cashoutMult, setCashoutMult] = useState(null);
  const [cashoutPayout, setCashoutPayout] = useState(null);

  // -- History pills (start empty)
  const [history, setHistory] = useState([]); // [{ value, won }] newest pushes right
  const historyRef = useRef(history);
  historyRef.current = history;

  // -- Refs for loop
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  const crashPointRef = useRef(null);
  const growthKRef = useRef(GROWTH_K_DEFAULT);
  const phaseRef = useRef('idle');
  const cashedOutRef = useRef(false);
  const lastTickRef = useRef(0);
  const autoCashoutTriggeredRef = useRef(false);
  const hasBetRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const betAmountNum = parseFloat(betAmount) || 0;
  const autoCashoutNum = Math.max(1.01, parseFloat(autoCashout) || 2.0);

  const addHistory = useCallback((value, won) => {
    setHistory(prev => {
      const next = [...prev, { value, won, id: Date.now() + Math.random() }];
      if (next.length > 20) next.shift();
      return next;
    });
  }, []);

  const finalizeCrashed = useCallback((cp, seed) => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setCrashPoint(cp);
    if (seed) setServerSeed(seed);
    setPhase(cashedOutRef.current ? 'crashed' : 'crashed');
    // Determine win: green only if user cashed out AND that cashoutMult > 0
    const didWin = cashedOutRef.current;
    addHistory(cp, didWin);
    setTimeout(() => refreshUser(), 200);
  }, [addHistory, refreshUser]);

  const finalizeFromServer = useCallback((data) => {
    // data: { crashed, crashPoint, serverSeed, cashedOut, cashoutMultiplier, payout }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setCrashPoint(data.crashPoint);
    setServerSeed(data.serverSeed || null);
    setPhase('crashed');
    addHistory(data.crashPoint, !!data.cashedOut);
    setTimeout(() => refreshUser(), 200);
  }, [addHistory, refreshUser]);

  // Animation loop
  useEffect(() => {
    if (phase !== 'running' && phase !== 'cashedOut') return;

    const tick = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      if (elapsed <= 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const m = Math.exp(growthKRef.current * elapsed);
      const cp = crashPointRef.current;
      if (cp != null && m >= cp) {
        setLiveMultiplier(cp);
        finalizeCrashed(cp, null); // serverTick will reveal seed shortly
        return;
      }
      setLiveMultiplier(m);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, finalizeCrashed]);

  // Server reconciliation tick — detects crash + auto-cashout server-side
  useEffect(() => {
    if (phase !== 'running' && phase !== 'cashedOut') return undefined;
    const id = setInterval(async () => {
      try {
        const res = await gamesAPI.crashTick();
        const d = res.data?.data;
        if (!d) return;
        if (d.crashed) {
          finalizeFromServer(d);
          return;
        }
        if (d.autoCashoutHit && !cashedOutRef.current) {
          cashedOutRef.current = true;
          setCashoutMult(d.multiplier);
          setCashoutPayout(d.payout);
          setPhase('cashedOut');
          toast.success(`Auto cashout at ${d.multiplier.toFixed(2)}×! +${d.payout.toFixed(2)}`);
          if (d.newBalance != null) refreshUser();
        }
      } catch (e) {
        // ignore network blips
      }
    }, TICK_POLL_MS);
    return () => clearInterval(id);
  }, [phase, finalizeFromServer, toast, refreshUser]);

  // Check for an active round on mount (page refresh)
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isAuthenticated) return;
      try {
        const res = await gamesAPI.crashActive();
        const d = res.data?.data;
        if (!mounted || !d?.active) return;
        setRoundId(d.roundId);
        setStartedAt(d.startedAt);
        startedAtRef.current = d.startedAt;
        setGrowthK(d.growthK || GROWTH_K_DEFAULT);
        growthKRef.current = d.growthK || GROWTH_K_DEFAULT;
        if (d.crashPoint) {
          setCrashPoint(d.crashPoint);
          crashPointRef.current = d.crashPoint;
        }
        setBetAmount(String(d.betAmount ?? ''));
        if (d.autoCashout) setAutoCashout(String(d.autoCashout));
        hasBetRef.current = true;
        autoCashoutTriggeredRef.current = false;
        if (d.cashedOut) {
          cashedOutRef.current = true;
          setCashoutMult(d.cashoutMultiplier);
          setCashoutPayout(d.payout);
          setPhase('cashedOut');
        } else {
          cashedOutRef.current = false;
          setPhase('running');
        }
      } catch (e) { /* ignore */ }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // -- Actions
  const handleBet = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { toast.error('Please login to play'); setBetError("Log in to place a bet"); return; }
    const amt = parseFloat(betAmount);
    if (isNaN(amt) || amt <= 0) { setBetError("Enter a valid bet amount"); return; }
    if (amt > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }
    if (phase === 'running' || phase === 'cashedOut') {
      toast.error("Round already in progress");
      return;
    }
    // Reset local UI from any previous finished round.
    resetForNextRound();

    try {
      setBetError(null);
      const res = await gamesAPI.crashStart({
        betAmount: amt,
        autoCashout: autoCashoutNum,
      });
      const d = res.data.data;
      setRoundId(d.roundId);
      setStartedAt(d.startedAt);
      startedAtRef.current = d.startedAt;
      setGrowthK(d.growthK ?? GROWTH_K_DEFAULT);
      growthKRef.current = d.growthK ?? GROWTH_K_DEFAULT;
      setCrashPoint(null);
      crashPointRef.current = null; // DON'T leak crashPoint to client yet
      setServerSeed(null);
      setServerSeed(null);
      setCashoutMult(null);
      setCashoutPayout(null);
      setLiveMultiplier(1.0);
      cashedOutRef.current = false;
      hasBetRef.current = true;
      autoCashoutTriggeredRef.current = false;
      setPhase('running');
      await refreshUser();
    } catch (e) {
      const msg = e.response?.data?.message || e.message || "Bet failed";
      toast.error(msg);
      setBetError(msg);
    }
  };

  const handleCashout = async () => {
    if (phase !== 'running' || !hasBetRef.current || cashedOutRef.current) return;
    try {
      const res = await gamesAPI.crashCashout();
      const d = res.data.data;
      cashedOutRef.current = true;
      setCashoutMult(d.multiplier);
      setCashoutPayout(d.payout);
      if (d.crashPoint != null) {
        crashPointRef.current = d.crashPoint;
        setCrashPoint(d.crashPoint);
      }
      setPhase('cashedOut');
      toast.success(`Cashed out at ${d.multiplier.toFixed(2)}×! +${d.payout.toFixed(2)}`);
      if (d.newBalance != null) refreshUser();
    } catch (e) {
      // If the crash happened mid-request, the tick will finalize.
      const msg = e.response?.data?.message || e.message;
      console.warn("cashout failed:", msg);
    }
  };

  const handleStop = async () => {
    if (phase !== 'cashedOut') return;
    try {
      const res = await gamesAPI.crashStop();
      const d = res.data.data;
      finalizeFromServer(d);
    } catch (e) {
      // If server already finalized the round (crash tick got there first),
      // simulate finalization with whatever we know locally so UI still resets.
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const cp = crashPointRef.current;
      if (cp != null) {
        setCrashPoint(cp);
        setPhase('crashed');
        addHistory(cp, true);
        setTimeout(() => refreshUser(), 200);
      } else {
        resetForNextRound();
      }
    }
  };

  // When crash occurs naturally but server tick was slow, still record round
  // when user clicks Bet after a crash we just reset state.
  const resetForNextRound = useCallback(() => {
    setPhase('idle');
    setCrashPoint(null);
    setServerSeed(null);
    setRoundId(null);
    setCashoutMult(null);
    setCashoutPayout(null);
    setLiveMultiplier(1.0);
    cashedOutRef.current = false;
    hasBetRef.current = false;
  }, []);

  // Auto-reset crashed state after a short delay so UI can be reused
  useEffect(() => {
    if (phase !== 'crashed') return;
    const t = setTimeout(() => {
      // Don't auto-reset if user still sees crashed view; let clicking Bet reset
    }, 4000);
    return () => clearTimeout(t);
  }, [phase]);

  const adjustBet = (val) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * val).toFixed(2));
  };

  // ---- Render helpers for chart
  // Compute current axis ranges. Start with a fixed view (Y up to 2.3x, X up to 12s)
  // until the line tip hits the right wall (xRatio >= 1), then expand.
  const elapsed = phase === 'idle' ? 0 : Math.max(0, (Date.now() - (startedAt || Date.now())) / 1000);
  // We re-render via rAF; when idle just show 0.
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (phase !== 'running' && phase !== 'cashedOut') return;
    let id;
    const loop = () => { setFrame(f => (f + 1) % 1000000); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const cp = crashPointRef.current ?? crashPoint;
  const isCrashed = phase === 'crashed';
  const effectiveMult = isCrashed && cp ? cp : liveMultiplier;
  const effectiveElapsed = isCrashed && cp
    ? Math.log(cp) / (growthKRef.current || GROWTH_K_DEFAULT)
    : Math.max(0, (Date.now() - (startedAtRef.current || Date.now())) / 1000);

  // Fixed initial ranges
  const MAX_X_INIT = INITIAL_TOTAL_S;
  const MAX_Y_INIT = 2.3;
  // When multiplier exceeds the displayed Y ceiling or time exceeds the visible
  // X ceiling, expand ranges so the tip stays within ~90% of the plot area.
  let maxX = MAX_X_INIT;
  let maxY = MAX_Y_INIT;
  if (effectiveMult > MAX_Y_INIT * 0.95 || effectiveElapsed > MAX_X_INIT * 0.95) {
    maxX = Math.max(MAX_X_INIT, effectiveElapsed * 1.1);
    maxY = Math.max(MAX_Y_INIT, effectiveMult * 1.1);
  }

  // Build curve path
  const buildPath = () => {
    const now = effectiveElapsed;
    if (now <= 0) return { area: '', line: '', tipX: 0, tipY: 0 };
    // Sample points
    const STEP = 0.05;
    const points = [];
    for (let t = 0; t <= now; t += STEP) {
      const m = Math.exp((growthKRef.current || GROWTH_K_DEFAULT) * t);
      points.push({ t, m });
    }
    // ensure exact endpoint
    points.push({ t: now, m: effectiveMult });
    const toX = (t) => (t / maxX) * 100;
    const toY = (m) => 100 - ((m - 1) / (maxY - 1)) * 100;
    let line = '';
    points.forEach((p, i) => {
      const x = toX(p.t);
      const y = Math.max(0, Math.min(100, toY(p.m)));
      line += (i === 0 ? 'M' : 'L') + x.toFixed(3) + ',' + y.toFixed(3) + ' ';
    });
    const tipX = toX(now);
    const tipY = Math.max(0, Math.min(100, toY(effectiveMult)));
    const area = line + `L${tipX.toFixed(3)},100 L0,100 Z`;
    return { line: line.trim(), area, tipX, tipY };
  };
  const { line: curveLine, area: curveArea, tipX, tipY } = buildPath();

  const showCenter = phase !== 'idle';
  const multColor = isCrashed ? 'var(--accent-red)' : '#ffffff';
  const fillColor = isCrashed ? '#395061' : '#FB9D08';
  const lineColor = isCrashed ? '#4b6275' : '#ffffff';

  // Action button
  const actionBtnDisabled =
    isLocked ||
    (phase === 'running' && !hasBetRef.current) || // only possible if no bet was placed (shouldn't happen but guard)
    false;

  // When idle, button is Bet (blue). When running & has bet & not cashed out: Cash Out (secondary/orange? — per spec secondary).
  // When cashed out: Stop (secondary).
  let actionLabel = 'Bet';
  let actionClass = styles.betButton;
  let actionHandler = handleBet;
  let actionDisabled = isLocked || phase === 'crashed';
  if (phase === 'running' && hasBetRef.current && !cashedOutRef.current) {
    actionLabel = 'Cash Out';
    actionClass = styles.cashoutBtn;
    actionHandler = handleCashout;
    actionDisabled = false;
  } else if (phase === 'cashedOut') {
    actionLabel = 'Stop';
    actionClass = styles.stopBtn;
    actionHandler = handleStop;
    actionDisabled = false;
  } else if (phase === 'crashed') {
    actionLabel = 'Bet';
    actionClass = styles.betButton;
    actionHandler = () => { resetForNextRound(); handleBet(); };
  }

  // Profit on win display
  const profitOnWin = (phase === 'idle')
    ? (betAmountNum * (autoCashoutNum - 1))
    : (cashoutPayout ? (cashoutPayout - betAmountNum) : (betAmountNum * Math.max(1, liveMultiplier - 1)));

  // ---- Render
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
                disabled={phase === 'running' || phase === 'cashedOut'}
              />
              <span className={styles.btcIcon}>$</span>
            </div>
            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || phase === 'running' || phase === 'cashedOut'}>½</button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || phase === 'running' || phase === 'cashedOut'}>2×</button>
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
                disabled={phase === 'running' || phase === 'cashedOut'}
              />
              <span className={styles.btcIcon}>×</span>
            </div>
            <Stepper value={autoCashout} onChange={setAutoCashout} step={0.1} min={1.01} decimals={2} disabled={phase === 'running' || phase === 'cashedOut'} />
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
          {phase === 'running' && hasBetRef.current && !cashedOutRef.current && (
            <span className={styles.btnMult}> {formatMult(liveMultiplier)}×</span>
          )}
        </button>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>{cashedOutRef.current ? 'Profit' : 'Profit on Win'}</span>
            <span>${(profitOnWin > 0 ? profitOnWin : 0).toFixed(2)}</span>
          </div>
          <div className={styles.readonlyInput}>
            <input
              type="text"
              value={`${(profitOnWin > 0 ? profitOnWin : 0).toFixed(2)}`}
              readOnly
            />
            <span className={styles.btcIcon}>$</span>
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
            {/* History pills row */}
            <div className={styles.historyRow}>
              <div className={styles.historyPills}>
                {history.map((h) => (
                  <span
                    key={h.id}
                    className={`${styles.histPill} ${h.won ? styles.histGreen : styles.histGray}`}
                  >
                    {formatMult(h.value)}×
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

            {/* Chart */}
            <div className={styles.chartWrap}>
              {/* Y-axis labels (left) */}
              <div className={styles.yAxis}>
                {buildYLabels(maxY).map((v) => (
                  <div
                    key={v}
                    className={styles.yTick}
                    style={{ bottom: `${((v - 1) / (maxY - 1)) * 100}%` }}
                  >
                    <span>{v.toFixed(1)}×</span>
                    <div className={styles.yTickLine} />
                  </div>
                ))}
              </div>

              {/* Plot area */}
              <div className={styles.plotArea}>
                <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="crashFillGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={fillColor} stopOpacity={isCrashed ? 0.4 : 0.55} />
                      <stop offset="100%" stopColor={fillColor} stopOpacity={isCrashed ? 0.05 : 0.08} />
                    </linearGradient>
                    <filter id="crashLineShadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="0.9" />
                    </filter>
                  </defs>

                  {showCenter && curveArea && (
                    <path d={curveArea} fill="url(#crashFillGrad)" />
                  )}
                  {showCenter && curveLine && (
                    <>
                      {/* shadow */}
                      <path d={curveLine} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#crashLineShadow)" />
                      <path d={curveLine} fill="none" stroke={lineColor} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}
                </svg>

                {/* Tip marker */}
                {showCenter && !isCrashed && (
                  <div
                    className={styles.tipMarker}
                    style={{ left: `${tipX}%`, bottom: `${((effectiveMult - 1) / (maxY - 1)) * 100}%` }}
                  />
                )}

                {/* Center overlay */}
                {showCenter && (
                  <div className={styles.centerOverlay}>
                    <div
                      className={`${styles.centerMult} ${isCrashed ? styles.centerMultCrashed : ''}`}
                      style={{ color: multColor }}
                    >
                      {formatMult(effectiveMult)}<span className={styles.centerX}>×</span>
                    </div>
                    <div className={styles.statusBox}>
                      {cashedOutRef.current && !isCrashed ? (
                        <>Cashed Out <span className={styles.statusGreen}>{formatMult(cashoutMult || effectiveMult)}×</span></>
                      ) : isCrashed ? (
                        'Crashed'
                      ) : phase === 'running' ? (
                        <span className={styles.statusMuted}>—</span>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* Grid lines */}
                <div className={styles.gridLines}>
                  {buildYLabels(maxY).slice(1).map((v) => (
                    <div
                      key={v}
                      className={styles.gridLine}
                      style={{ bottom: `${((v - 1) / (maxY - 1)) * 100}%` }}
                    />
                  ))}
                </div>
              </div>

              {/* X-axis labels */}
              <div className={styles.xAxis}>
                {buildXLabels(maxX).map((t) => (
                  <div
                    key={t}
                    className={styles.xTick}
                    style={{ left: `${(t / maxX) * 100}%` }}
                  >
                    {Math.round(t)}s
                  </div>
                ))}
                <div
                  className={styles.xTotal}
                  style={{ left: '100%' }}
                >
                  Total {Math.round(maxX)}s
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Helpers to generate axis ticks that roughly match the reference screenshots
function buildYLabels(maxY) {
  // Always 6 labels similar to images, spaced nicely
  const out = [];
  // pick a step
  const candidates = [0.2, 0.3, 0.5, 1, 2, 5, 10];
  let step = 0.3;
  for (const c of candidates) {
    if (maxY / c <= 8) { step = c; break; }
  }
  for (let v = 1.0; v <= maxY + 0.001; v += step) {
    out.push(Math.round(v * 100) / 100);
  }
  if (out[out.length - 1] < maxY) out.push(Math.round((out[out.length - 1] + step) * 100) / 100);
  return out.slice(0, 7);
}
function buildXLabels(maxX) {
  const out = [];
  const candidates = [1, 2, 3, 5, 10, 15, 20, 30];
  let step = 3;
  for (const c of candidates) {
    if (maxX / c <= 6) { step = c; break; }
  }
  for (let t = step; t < maxX - step / 2; t += step) {
    out.push(Math.round(t));
  }
  return out.slice(0, 5);
}

export default Crash;
