import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import useGameDisabled from "../../hooks/useGameDisabled";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { gamesAPI } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import styles from "./wheel.module.css";
import Modal from "../common/Modal";

const RISK_LEVELS = ["low", "medium", "high"];
const SEGMENT_OPTIONS = [10, 20, 30, 40, 50];

function titleCase(s) {
  return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
}
function formatMoney(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}
function isMobileNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
}

function makeCubicBezier(x1, y1, x2, y2) {
  return function (x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const ct = 1 - t;
      const bx = 3 * ct * ct * t * x1 + 3 * ct * t * t * x2 + t * t * t;
      const dx = 3 * ct * ct * x1 + 6 * ct * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(dx) < 1e-6) break;
      t -= (bx - x) / dx;
      t = Math.max(0, Math.min(1, t));
    }
    const ct = 1 - t;
    return 3 * ct * ct * t * y1 + 3 * ct * t * t * y2 + t * t * t;
  };
}

const spinEasingNormal = makeCubicBezier(0.06, 0.9, 0.06, 1.0);

export default function Wheel({ gameRow, soundEnabled, soundVolume }) {
  const { updateBalance } = useAuth();

  const [betAmount, setBetAmount] = useState("");
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);
  const [riskLevel, setRiskLevel] = useState("medium");
  const [segments, setSegments] = useState(10);

  const [loadingLayout, setLoadingLayout] = useState(false);
  const [wheelLayout, setWheelLayout] = useState([]);

  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [rotation, setRotation] = useState(0);

  const [bounceKey, setBounceKey] = useState(0);
  const [bounceDuration, setBounceDuration] = useState(350);
  const pointerTrackRef = useRef({
    rafId: null,
    active: false,
    startTime: 0,
    duration: 0,
    fromRot: 0,
    toRot: 0,
    segAngle: 36,
    lastSegIndex: -1,
  });

  const [hoverIdx, setHoverIdx] = useState(null);
  const [hoverMultiplier, setHoverMultiplier] = useState(null);

  const [cellModalOpen, setCellModalOpen] = useState(false);
  const [cellModalMultiplier, setCellModalMultiplier] = useState(null);

  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winAmount, setWinAmount] = useState(0);

  const animRef = useRef(0);
  const spinDurationRef = useRef(5000);
  const bet = useMemo(() => parseFloat(betAmount) || 0, [betAmount]);
  const isMobile = isMobileNow();

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount);
    const next = (Number.isFinite(curr) ? curr : 0) * factor;
    setBetAmount(next.toFixed(2));
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingLayout(true);
      setError("");
      try {
        const res = await gamesAPI.getWheelLayout({ riskLevel, segments });
        const payloadWheel = res.data?.wheel ?? res.data?.result?.wheel;
        const w = payloadWheel || res.data?.data?.wheel || res.data?.layout?.wheel;
        if (!Array.isArray(w) || w.length !== Number(segments)) {
          throw new Error("Bad wheel layout response");
        }
        if (!cancelled) setWheelLayout(w);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.message || e.message || "Failed to load wheel layout");
      } finally {
        if (!cancelled) setLoadingLayout(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [riskLevel, segments]);

  const cells = useMemo(() => {
    const map = new Map();
    for (const seg of wheelLayout) {
      const m = Number(seg?.multiplier);
      if (!Number.isFinite(m)) continue;
      const key = m.toFixed(8);
      if (!map.has(key)) map.set(key, { multiplier: m, color: seg?.color || "#406C82", weight: 0 });
      map.get(key).weight += 1;
    }
    const arr = [...map.values()].sort((a, b) => a.multiplier - b.multiplier);
    return arr.slice(0, 6);
  }, [wheelLayout]);

  const infoForMultiplier = useCallback(
    (mult) => {
      if (mult == null) return null;
      const cell = cells.find((c) => c.multiplier === mult);
      if (!cell) return null;
      const chanceNum = Number(cell.weight) || 0;
      const chanceDen = Number(segments) || 1;
      const payout = bet * cell.multiplier;
      const profit = payout - bet;
      return { multiplier: cell.multiplier, profit, chanceNum, chanceDen, color: cell.color };
    },
    [cells, segments, bet]
  );

  const activeMultiplier = useMemo(() => {
    if (isMobile) return cellModalOpen ? cellModalMultiplier : null;
    return hoverMultiplier;
  }, [isMobile, cellModalOpen, cellModalMultiplier, hoverMultiplier]);

  const activeInfo = useMemo(() => infoForMultiplier(activeMultiplier), [infoForMultiplier, activeMultiplier]);

  const activeIdx = useMemo(() => {
    if (!activeMultiplier) return null;
    return cells.findIndex((c) => c.multiplier === activeMultiplier);
  }, [cells, activeMultiplier]);

  const arrowLeftPercent = useMemo(() => {
    if (activeIdx == null || cells.length === 0) return 50;
    const cols = cells.length;
    const idx = Math.max(0, Math.min(cols - 1, activeIdx));
    return ((idx + 0.5) / cols) * 100;
  }, [activeIdx, cells.length]);

  useEffect(() => {
    setHoverIdx(null);
    setHoverMultiplier(null);
    setCellModalOpen(false);
    setCellModalMultiplier(null);
    setShowWinPopup(false);
    setWinAmount(0);
    setResult(null);
  }, [riskLevel, segments]);

  const stopTracking = useCallback(() => {
    const t = pointerTrackRef.current;
    t.active = false;
    if (t.rafId) {
      cancelAnimationFrame(t.rafId);
      t.rafId = null;
    }
  }, []);

  const startTracking = useCallback((fromRot, toRot, durationMs, segAngle, easingFn) => {
    const t = pointerTrackRef.current;
    if (t.rafId) {
      cancelAnimationFrame(t.rafId);
    }
    t.startTime = 0;
    t.duration = durationMs;
    t.fromRot = fromRot;
    t.toRot = toRot;
    t.segAngle = segAngle;
    t.active = true;

    const initNorm = ((fromRot % 360) + 360) % 360;
    t.lastSegIndex = Math.floor(initNorm / segAngle);

    const totalDelta = Math.abs(toRot - fromRot);

    const loop = (timestamp) => {
      if (!t.active) return;

      if (t.startTime === 0) {
        t.startTime = timestamp;
      }

      const elapsed = timestamp - t.startTime;
      const progress = Math.min(1, elapsed / t.duration);
      const eased = easingFn(progress);

      const currentRot = t.fromRot + (t.toRot - t.fromRot) * eased;
      const norm = ((currentRot % 360) + 360) % 360;
      const segIdx = Math.floor(norm / t.segAngle);

      if (segIdx !== t.lastSegIndex) {
        const tiny = 0.001;
        const p2 = Math.min(1, progress + tiny);
        const eased2 = easingFn(p2);
        const localSpeed = Math.abs((eased2 - eased) * totalDelta / (tiny * t.duration));

        const msPerSegment = localSpeed > 0.001 ? t.segAngle / localSpeed : 2000;
        const dur = Math.round(Math.max(200, Math.min(2500, msPerSegment * 1.2)));

        setBounceDuration(dur);
        setBounceKey((k) => k + 1);
      }
      t.lastSegIndex = segIdx;

      if (progress < 1) {
        t.rafId = requestAnimationFrame(loop);
      } else {
        t.active = false;
      }
    };

    t.rafId = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    return () => stopTracking();
  }, [stopTracking]);

  /**
   * TEASE SYSTEM
   *
   * Instead of trying to use CSS overshoot (which is unreliable),
   * we do a TWO-PHASE animation:
   *
   * Phase 1: Wheel spins and lands in the GOOD segment (slightly past boundary)
   * Phase 2: After a pause, wheel slowly drifts BACK into the gray segment
   *
   * This is done by:
   * 1. First setRotation to overshoot target (into good segment)
   * 2. After the main spin ends, setRotation back to the real target
   *    with a slow, short transition (the "drift back")
   *
   * The player sees: wheel stops on good color → pointer sits there for a moment →
   * wheel lazily creeps backward → lands on gray. "Nooo!"
   */

  const handleSpin = useCallback(async () => {
    const b = parseFloat(betAmount);
    if (!b || b <= 0) {
      setError("Enter a valid bet amount");
      return;
    }
    if (!Array.isArray(wheelLayout) || wheelLayout.length !== Number(segments)) {
      setError("Wheel layout not ready");
      return;
    }

    setError("");
    setSpinning(true);
    setResult(null);
    setShowWinPopup(false);
    setWinAmount(0);

    const my = ++animRef.current;

    try {
      const res = await gamesAPI.playWheel({ betAmount: b, riskLevel, segments });
      const data = res.data?.result;

      const len = Number(segments);
      const segAngle = 360 / len;
      const landedIndex = data.landedIndex;

      // Center of the landed segment
      const centerOfSegment = landedIndex * segAngle + segAngle / 2;
      const targetRotMod360 = ((360 - centerOfSegment) % 360 + 360) % 360;

      const fullSpins = 12;
      const fromRot = rotation;
      const durationMs = 5000 + Math.random() * 2000;
      spinDurationRef.current = durationMs;

      // Add some jitter so it doesn't always land perfectly centered
      const maxJitter = segAngle * 0.35;
      const jitter = (Math.random() * 2 - 1) * maxJitter;

      // Calculate final rotation
      const currentMod = ((fromRot % 360) + 360) % 360;
      let delta = targetRotMod360 + jitter - currentMod;
      while (delta < 0) delta += 360;
      delta += fullSpins * 360;
      const toRot = fromRot + delta;

      // Start tracking for pointer bounces
      stopTracking();
      startTracking(fromRot, toRot, durationMs, segAngle, spinEasingNormal);

      // Set the rotation - wheel will animate via CSS transition
      setRotation(toRot);

      // After spin completes, show result
      setTimeout(() => {
        if (animRef.current !== my) return;
        stopTracking();
        setResult(data);
        setSpinning(false);

        if (data?.balance != null) updateBalance(data.balance);

        const won = Number(data?.payout || 0) > 0;
        if (won) {
          setWinAmount(Number(data.payout || 0));
          setShowWinPopup(true);
          setTimeout(() => {
            if (animRef.current === my) setShowWinPopup(false);
          }, 1400);
        }
      }, durationMs + 400);

    } catch (err) {
      stopTracking();
      setError(err.response?.data?.message || "Spin failed");
      setSpinning(false);
    }
  }, [betAmount, riskLevel, segments, wheelLayout, rotation, updateBalance, stopTracking, startTracking]);

  const onCellEnterDesktop = (c, idx) => {
    if (isMobile) return;
    setHoverIdx(idx);
    setHoverMultiplier(c.multiplier);
  };
  const onCellLeaveDesktop = () => {
    if (isMobile) return;
    setHoverIdx(null);
    setHoverMultiplier(null);
  };
  const onCellClick = (c) => {
    if (!isMobile) return;
    setCellModalMultiplier(c.multiplier);
    setCellModalOpen(true);
  };

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${styles.active}`}>Manual</button>
          <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} disabled>Auto</button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Bet Amount</span>
            <span>$0.00</span>
          </div>

          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <input
                type="text"
                value={betAmount}
                placeholder="0.00"
                onChange={(e) => {
                  const val = e.target.value;

                  // Allow only digits and dot
                  if (/^\d*\.?\d*$/.test(val)) {
                    setBetAmount(val);
                  }
                }}
                onBlur={() => {
                  // Format to 2 decimals when leaving input (empty stays empty)
                  const num = parseFloat(betAmount);
                  setBetAmount(Number.isFinite(num) ? num.toFixed(2) : "");
                }}
                disabled={spinning}
              />
            </div>


            <div className={styles.btcChip} title="BTC" aria-hidden="true">$</div>

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || spinning}>½</button>
              <div className={styles.divider} />
              <button onClick={() => adjustBet(2)} disabled={isLocked || spinning}>2×</button>
            </div>
          </div>
          <BetError message={betLockedError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}><span>Difficulty</span></div>
          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select className={styles.select} value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} disabled={spinning}>
              {RISK_LEVELS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}><span>Segments</span></div>
          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select className={styles.select} value={segments} onChange={(e) => setSegments(Number(e.target.value))} disabled={spinning}>
              {SEGMENT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <button
          className={styles.bigButton}
          onClick={handleSpin}
          data-bet-sound="true"
          disabled={isLocked || spinning || bet <= 0 || loadingLayout} title={isLocked ? betErrorMessage : undefined}
          type="button"
        >
          {loadingLayout ? "Loading..." : spinning ? "Spinning..." : "Bet"}
        </button>

        {/* Error is always rendered (space reserved) so a failure never
            pushes the Bet button down — empty state is invisible. */}
        <div className={`${styles.error} ${error ? "" : styles.errorEmpty}`} role="alert" aria-live="polite">
          {error}
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Win popup — direct child of the stage so it is always dead
            centred over the whole game area as a true overlay. */}
        {showWinPopup && winAmount > 0 && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupTitle}>YOU WON</div>
            <div className={styles.winPopupAmount}>${formatMoney(winAmount)}</div>
          </div>
        )}

        <div className={styles.boardWrap}>
          <div className={styles.wheelStage}>

            {/* .wheelBox is a strict 1:1 square sized from the smaller of the
                stage's width/height; the pointer is anchored to it (not to the
                viewport) and the wheel itself fills it, so it can never be
                stretched into an oval regardless of the panel's proportions. */}
            <div className={styles.wheelBox}>
              <div
                key={bounceKey}
                className={`${styles.pointerWrap} ${bounceKey > 0 ? styles.pointerBounce : ""}`}
                style={{ "--bounce-duration": `${bounceDuration}ms` }}
                aria-hidden="true"
              >
                <div className={styles.pointerPin} />
                <div className={styles.pointerDrop} />
              </div>

              <div
                className={styles.wheelOuter}
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning
                    ? `transform ${spinDurationRef.current / 1000}s cubic-bezier(0.06, 0.9, 0.06, 1.0)`
                    : "none",
                }}
              >
                <div className={styles.rim} />
                <div className={styles.ring}>
                  {(wheelLayout.length ? wheelLayout : Array.from({ length: segments })).map((seg, i) => {
                    const segAngle = 360 / Number(segments);
                    const angle = i * segAngle;
                    const skew = 90 - segAngle;
                    return (
                      <div
                        key={i}
                        className={styles.segment}
                        style={{
                          transform: `rotate(${angle}deg) skewY(-${skew}deg)`,
                          backgroundColor: seg?.color || "#406C82",
                        }}
                      />
                    );
                  })}
                </div>
                <div className={styles.innerPlate}>
                  <div className={styles.innerCircle} />
                </div>
              </div>
            </div>
          </div>

          {!isMobile && (
            <div className={`${styles.hoverPanel} ${activeInfo ? styles.hoverPanelVisible : ""}`}>
              <div className={styles.hoverBoxes}>
                <div className={styles.hoverBox}>
                  <div className={styles.hoverLabel}>Multiplier</div>
                  <div className={styles.hoverField}>
                    <input
                      className={styles.hoverInput}
                      type="text"
                      readOnly
                      value={(activeInfo ? activeInfo.multiplier : 0).toFixed(2)}
                    />
                    <span className={styles.hoverSuffix}>×</span>
                  </div>
                </div>
                <div className={styles.hoverBox}>
                  <div className={styles.hoverLabel}>Profit on Win</div>
                  <div className={styles.hoverField}>
                    <input
                      className={styles.hoverInput}
                      type="text"
                      readOnly
                      value={formatMoney(activeInfo ? activeInfo.profit : 0)}
                    />
                    <span className={styles.hoverSuffix}>$</span>
                  </div>
                </div>
                <div className={styles.hoverBox}>
                  <div className={styles.hoverLabel}>Chance</div>
                  <div className={styles.hoverField}>
                    <input
                      className={styles.hoverInput}
                      type="text"
                      readOnly
                      value={activeInfo ? `${activeInfo.chanceNum}/${activeInfo.chanceDen}` : `0/${segments}`}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.hoverArrow} style={{ left: `${arrowLeftPercent}%` }} aria-hidden="true" />
            </div>
          )}

          <div className={styles.multStrip} style={{ gridTemplateColumns: `repeat(${Math.max(1, cells.length)}, 1fr)` }}>
            {cells.map((c, idx) => {
              const isActive =
                (!isMobile && hoverMultiplier === c.multiplier) ||
                (isMobile && cellModalOpen && cellModalMultiplier === c.multiplier);

              return (
                <button
                  key={String(c.multiplier)}
                  type="button"
                  className={styles.multCardBtn}
                  onMouseEnter={() => onCellEnterDesktop(c, idx)}
                  onMouseLeave={onCellLeaveDesktop}
                  onClick={() => onCellClick(c)}
                >
                  <div className={`${styles.multCard} ${isActive ? styles.multCardActive : ""}`}>
                    <div className={styles.multValue}>{Number(c.multiplier).toFixed(2)}×</div>
                    <div className={styles.multFill} style={{ background: c.color }} />
                    <div className={styles.multBar} style={{ background: c.color }} />
                  </div>
                </button>
              );
            })}
          </div>

          <Modal
            isOpen={isMobile && cellModalOpen && !!activeInfo}
            onClose={() => {
              setCellModalOpen(false);
              setCellModalMultiplier(null);
            }}
            title="Multiplier"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 3.5V12l6 6" />
                <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
              </svg>
            }
            description="This segment's payout for your bet."
          >
            {activeInfo && (
              <>
                <div className={styles.modalNumber}>{activeInfo.multiplier.toFixed(2)}×</div>
                <div className={styles.modalGrid}>
                  <div className={styles.modalItem}>
                    <div className={styles.modalItemLabel}>Chance</div>
                    <div className={styles.modalItemValue}>{activeInfo.chanceNum}/{activeInfo.chanceDen}</div>
                  </div>
                  <div className={styles.modalItem}>
                    <div className={styles.modalItemLabel}>Profit on Win</div>
                    <div className={styles.modalItemValue}>${formatMoney(activeInfo.profit)}</div>
                  </div>
                </div>

                <button
                  className={styles.modalBtnPrimary}
                  onClick={() => {
                    setCellModalOpen(false);
                    setCellModalMultiplier(null);
                  }}
                  type="button"
                >
                  Close
                </button>
              </>
            )}
          </Modal>

          {result && (
            <div className={styles.resultLine}>
              <span className={styles.resultKey}>Result:</span>
              <span className={styles.resultVal}>{Number(result.multiplier).toFixed(2)}×</span>
              <span className={styles.resultSep}>•</span>
              <span className={styles.resultVal}>
                {result.won ? `Won $${formatMoney(result.payout)}` : "No win"}
              </span>
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}