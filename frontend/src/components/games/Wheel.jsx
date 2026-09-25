import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { gamesAPI } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import styles from "./wheel.module.css";
import Modal from "../common/Modal";
import CurrencyIcon from "../common/CurrencyIcon";
import { IconChartPieSlice } from "../common/Icons";

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

/* Fast ease-out: launches hard, then a long lazy settle. */
const SPIN_BEZIER = [0.1, 0.8, 0.08, 1];

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
  // Round history for the top pills (newest first, capped)
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  const [rotation, setRotation] = useState(0);

  // The pointer is fully static — no rotation or bounce animation.
  const [hoverIdx, setHoverIdx] = useState(null);
  const [hoverMultiplier, setHoverMultiplier] = useState(null);

  const [cellModalOpen, setCellModalOpen] = useState(false);
  const [cellModalMultiplier, setCellModalMultiplier] = useState(null);

  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [winMult, setWinMult] = useState(0);

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
    setWinMult(0);
    setHistory([]);
  }, [riskLevel, segments]);

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
    setShowWinPopup(false);
    setWinAmount(0);
    setWinMult(0);

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

      const fullSpins = 8;
      const fromRot = rotation;
      const durationMs = 2800 + Math.random() * 900;
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

      // Set the rotation - wheel will animate via CSS transition
      setRotation(toRot);

      // After spin completes, show result
      setTimeout(() => {
        if (animRef.current !== my) return;
        setSpinning(false);

        if (data?.balance != null) updateBalance(data.balance);

        const won = Number(data?.payout || 0) > 0;
        setHistory((prev) => [{ multiplier: data?.multiplier, won }, ...prev].slice(0, 10));

        if (won) {
          setWinAmount(Number(data.payout || 0));
          setWinMult(Number(data.multiplier || 0));
          setShowWinPopup(true);
          setTimeout(() => {
            if (animRef.current === my) setShowWinPopup(false);
          }, 1400);
        }
      }, durationMs + 400);

    } catch (err) {
      setError(err.response?.data?.message || "Spin failed");
      setSpinning(false);
    }
  }, [betAmount, riskLevel, segments, wheelLayout, rotation, updateBalance]);
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("wheel", spinning);


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


            <div className={styles.btcChip} aria-hidden="true"><CurrencyIcon className={styles.btcIcon} /></div>

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

        <span className="ui-bet-wrap">
          <button
            className={styles.bigButton}
            onClick={handleSpin}
            data-bet-sound="true"
            disabled={isLocked || spinning || bet <= 0 || loadingLayout} title={isLocked ? betErrorMessage : undefined}
            type="button"
            >
          {loadingLayout ? "Loading..." : spinning ? "Spinning..." : "Bet"}
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

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
            <div className={styles.winPopupMult}>{Number(winMult || 0).toFixed(2)}×</div>
            <div className={styles.winPopupDivider} aria-hidden="true" />
            <div className={styles.winPopupAmount}>{formatMoney(winAmount)}<CurrencyIcon /></div>
          </div>
        )}

        <div className={styles.boardWrap}>
          {/* Always rendered: an invisible placeholder pill reserves the
              row's space until the first real pill swaps in — the row never
              grows, so content below never jumps. Newest-first, exactly like
              Crash (row-reverse puts the first pill at the right). */}
          <div className={styles.historyRow}>
            <div className={styles.historyScroll}>
              <div className={styles.historyPills}>
                {history.length === 0 ? (
                  <span className={`${styles.histPill} ${styles.histGray} ${styles.histPlaceholder}`}>
                    0.00×
                  </span>
                ) : (
                  history.map((h, i) => (
                    <span
                      key={i}
                      className={`${styles.histPill} ${h.won ? styles.histGreen : styles.histGray}`}
                    >
                      {Number(h.multiplier).toFixed(2)}×
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className={styles.wheelStage}>

            {/* .wheelBox is a strict 1:1 square sized from the smaller of the
                stage's width/height; the pointer is anchored to it (not to the
                viewport) and the wheel itself fills it, so it can never be
                stretched into an oval regardless of the panel's proportions. */}
            <div className={`${styles.wheelBox} ${spinning ? styles.spinning : ""}`}>
              <div className={styles.pointerWrap} aria-hidden="true">
                <div className={styles.pointerPin}>
                  <div className={styles.pointerPinInner} />
                </div>
                <div className={styles.pointerDrop} />
              </div>

              <div
                className={styles.wheelOuter}
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning
                    ? `transform ${spinDurationRef.current / 1000}s cubic-bezier(${SPIN_BEZIER.join(", ")})`
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
                    <span className={styles.hoverSuffix}><CurrencyIcon /></span>
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
            icon={<IconChartPieSlice />}
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

        </div>
          </>
        )}
      </div>
    </div>
  );
}