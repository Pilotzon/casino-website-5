import Stepper from "../common/Stepper";
import { useState, useEffect, useRef } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./dice.module.css";

import useGameAudio from "../../hooks/useGameAudio";

// ✅ Dice sounds
import dragMp3 from "../../assets/dice/Drag.mp3";
import winMp3 from "../../assets/dice/Win.mp3";
import roundMp3 from "../../assets/dice/Round.mp3";
import CurrencyIcon from "../common/CurrencyIcon";
import { IconArrowClockwise } from "../common/Icons";

// Eases the live gem number with the exact curve of the gem's own `left`
// transition (dice.module.css) so the digits track the marker frame-for-frame.
function cubicBezierEasing(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x) => {
    let t = x;
    for (let i = 0; i < 5; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveX(x)));
}
const MOVE_EASE = cubicBezierEasing(0.25, 0.8, 0.3, 1);

function Dice({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    {
      drag: dragMp3,
      win: winMp3,
      round: roundMp3,
    },
    { enabled: soundEnabled, volume: soundVolume }
  );

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

  // Game State
  const [targetNumber, setTargetNumber] = useState(50); // Integer
  const [rollUnder, setRollUnder] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);
  const [isDragging, setIsDragging] = useState(false);

  // Result State
  const [lastResult, setLastResult] = useState(null);
  const [resultPosition, setResultPosition] = useState(50);
  const [showResult, setShowResult] = useState(false);
  // Marker animation phasing (see dice.module.css — MOVE_MS matches the
  // marker's left transition exactly, PRESS_MS its press transition):
  //   pressing:  bet click → arrival (1.0 → 0.97 dip, held through the move)
  //   gemMoving: bet click → arrival (text greyed while the number runs live)
  const [pressing, setPressing] = useState(false);
  const [gemMoving, setGemMoving] = useState(false);
  const [shownPosition, setShownPosition] = useState(50);
  const shownPositionRef = useRef(50);
  // Retriggers the arrival bounce every roll (never reuses a key)
  const [arrivalNonce, setArrivalNonce] = useState(0);
  // Round history for the top pills (newest first, capped)
  const [history, setHistory] = useState([]);
  const MOVE_MS = 450;
  // Press dip is 280ms (matches .gemPress); the move starts at its
  // halfway point so the flight overlaps the dip's tail end.
  const PRESS_MS = 280;
  const PRESS_HALF_MS = PRESS_MS / 2;
  // Dice never shows a win popup, under any outcome.

  // Input States
  const [multiplierInput, setMultiplierInput] = useState("1.9800");
  const [winChanceInput, setWinChanceInput] = useState("50.00");

  // Constants
  const HOUSE_EDGE = 1; // 1%
  const MAX_ROLL = 100;

  const MIN_MULTIPLIER = 1.0206;
  const MAX_MULTIPLIER = 33.0;

  const MIN_CHANCE = (MAX_ROLL - HOUSE_EDGE) / MAX_MULTIPLIER; // 3.00
  const MAX_CHANCE = (MAX_ROLL - HOUSE_EDGE) / MIN_MULTIPLIER; // 97.00

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const TARGET_MIN = Math.ceil(MIN_CHANCE); // 3
  const TARGET_MAX = Math.floor(MAX_CHANCE); // 97

  // ✅ For "Drag.mp3 once per step" logic
  const lastDragValueRef = useRef(targetNumber);

  useEffect(() => {
    if (targetNumber < TARGET_MIN || targetNumber > TARGET_MAX) {
      setTargetNumber((t) => clamp(t, TARGET_MIN, TARGET_MAX));
      return;
    }

    const chance = rollUnder ? targetNumber : MAX_ROLL - targetNumber;
    const multi = (MAX_ROLL - HOUSE_EDGE) / chance;

    const clampedMulti = clamp(multi, MIN_MULTIPLIER, MAX_MULTIPLIER);
    const clampedChance = (MAX_ROLL - HOUSE_EDGE) / clampedMulti;

    setWinChanceInput(clampedChance.toFixed(2));
    setMultiplierInput(clampedMulti.toFixed(2));
  }, [targetNumber, rollUnder]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoll = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    if (isRolling) return;

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }

    setIsRolling(true);

    // marker press starts on click (1.0 → 0.97); it is "in motion"
    // (grey text, live number) until arrival
    const pressStart = Date.now();
    setPressing(true);
    setGemMoving(true);

    // ✅ Round start sound
    sfx.play("round", { volume: 1 });

    try {
      const response = await gamesAPI.playDice({
        betAmount: amount,
        targetNumber,
        rollUnder,
      });

      const result = response.data.result;
      setLastResult(result);
      setHistory((prev) => [{ roll: result.roll, won: result.won }, ...prev].slice(0, 10));

      // the move starts at the press's halfway point so the flight
      // overlaps the tail end of the scale-down (never before it)
      const pressElapsed = Date.now() - pressStart;
      if (pressElapsed < PRESS_HALF_MS) {
        await new Promise((r) => setTimeout(r, PRESS_HALF_MS - pressElapsed));
      }

      // the move toward the target begins here — the press-dip stays held
      // for the whole flight and only releases on arrival
      setShowResult(true);
      setResultPosition(result.roll);

      // the number runs live for the whole flight, eased with the gem's
      // own motion curve so digits and marker arrive together
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        setShownPosition(result.roll);
        shownPositionRef.current = result.roll;
        await new Promise((r) => setTimeout(r, MOVE_MS));
      } else {
        const fromNum = shownPositionRef.current;
        const toNum = result.roll;
        const moveStart = performance.now();
        await new Promise((resolve) => {
          const tickNumber = (now) => {
            const t = Math.min(1, (now - moveStart) / MOVE_MS);
            setShownPosition(fromNum + (toNum - fromNum) * MOVE_EASE(t));
            if (t < 1) requestAnimationFrame(tickNumber);
            else resolve();
          };
          requestAnimationFrame(tickNumber);
        });
      }

      // on arrival: the number snaps exact, the text takes its win/loss
      // colour, the press releases (280ms), and the bounce launches from
      // the same 0.97 dip — the overlap reads as a touchdown squash
      // before the 0.97 → 1.1 → 1.0 landing
      setShownPosition(result.roll);
      shownPositionRef.current = result.roll;
      setGemMoving(false);
      setPressing(false);
      setArrivalNonce((n) => n + 1);

      // ✅ After arrival: win sound (Dice never shows a win popup)
      if (result?.won) {
        sfx.play("win", { volume: 1 });
      }

      updateBalance(result.balance);

      if (result.won);
    } catch (error) {
      setPressing(false);
      setGemMoving(false);
      toast.error(error.response?.data?.message || "Roll failed");
    } finally {
      setIsRolling(false);
    }
  };

  const adjustBet = (factor) => {
    const val = parseFloat(betAmount) || 0;
    setBetAmount((val * factor).toFixed(2));
  };

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value, 10);
    const clampedVal = clamp(val, TARGET_MIN, TARGET_MAX);

    // ✅ Drag sound: once per integer step moved while dragging
    if (isDragging) {
      const prev = lastDragValueRef.current;
      const diff = clampedVal - prev;
      const steps = Math.abs(diff);

      if (steps > 0) {
        const cappedSteps = Math.min(steps, 25);
        for (let i = 0; i < cappedSteps; i++) {
          setTimeout(() => sfx.play("drag", { volume: 1 }), i * 12);
        }
      }

      lastDragValueRef.current = clampedVal;
    } else {
      lastDragValueRef.current = clampedVal;
    }

    setTargetNumber(clampedVal);
    setShowResult(false);

  };

  const handleMultiplierChange = (e) => {
    const val = e.target.value;
    setMultiplierInput(val);

    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      const m = clamp(num, MIN_MULTIPLIER, MAX_MULTIPLIER);
      const newChance = (MAX_ROLL - HOUSE_EDGE) / m;

      setWinChanceInput(newChance.toFixed(2));
      setMultiplierInput(m.toFixed(2));

      let newTarget = rollUnder ? newChance : MAX_ROLL - newChance;
      newTarget = clamp(Math.round(newTarget), TARGET_MIN, TARGET_MAX);
      setTargetNumber(newTarget);
      lastDragValueRef.current = newTarget;
      setShowResult(false);

        }
  };

  const handleWinChanceChange = (e) => {
    const val = e.target.value;
    setWinChanceInput(val);

    const num = parseFloat(val);
    if (!isNaN(num)) {
      const c = clamp(num, MIN_CHANCE, MAX_CHANCE);
      const newMulti = (MAX_ROLL - HOUSE_EDGE) / c;

      setWinChanceInput(c.toFixed(2));
      setMultiplierInput(newMulti.toFixed(2));

      let newTarget = rollUnder ? c : MAX_ROLL - c;
      newTarget = clamp(Math.round(newTarget), TARGET_MIN, TARGET_MAX);
      setTargetNumber(newTarget);
      lastDragValueRef.current = newTarget;
      setShowResult(false);

        }
  };

  const handleTargetInputChange = (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) return;

    val = clamp(val, TARGET_MIN, TARGET_MAX);
    const rounded = Math.round(val);
    setTargetNumber(rounded);
    lastDragValueRef.current = rounded;
    setShowResult(false);

  };

  const toggleMode = () => {
    setRollUnder((prev) => !prev);

    const flipped = MAX_ROLL - targetNumber;
    const clamped = clamp(flipped, TARGET_MIN, TARGET_MAX);
    setTargetNumber(clamped);
    lastDragValueRef.current = clamped;
    setShowResult(false);

  };

  const leftBarColor = rollUnder ? styles.barGreen : styles.barRed;
  const rightBarColor = rollUnder ? styles.barRed : styles.barGreen;
  const transitionStyle = isDragging ? { transition: "none" } : {};

  const profit =
    parseFloat(betAmount || 0) * parseFloat(multiplierInput || 0) -
    parseFloat(betAmount || 0);
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("dice", isRolling);


  // Marker text state: grey while in motion, then green (win) / red (loss)
  const labelClass = gemMoving
    ? styles.labelMoving
    : lastResult?.won
      ? styles.labelWin
      : styles.labelLoss;

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.controlsHeader}>
          <div className={styles.modeToggle}>
            <button className={`${styles.modeBtn} ${styles.active}`}>Manual</button>
            <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} type="button" disabled>Auto</button>
          </div>
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
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isRolling}>
                ½
              </button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isRolling}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <span className="ui-bet-wrap">
          <button className={styles.betButton} onClick={handleRoll} disabled={isLocked || isRolling} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          {isRolling ? "Rolling..." : "Bet"}
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Profit on Win</span>
            <span>$0.00</span>
          </div>
          <div className={styles.readonlyInput}>
            <input type="text" value={profit.toFixed(2)} readOnly />
            <CurrencyIcon className={styles.btcIcon} />
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Dice never shows a win popup, under any outcome. */}

        {/* Always rendered: an invisible placeholder pill reserves the
            row's space until the first real pill swaps in — the row never
            grows, so content below never jumps. Newest-first, exactly like
            Crash (row-reverse puts the first pill at the right). */}
        <div className={styles.historyRow}>
          <div className={styles.historyScroll}>
            <div className={styles.historyPills}>
              {history.length === 0 ? (
                <span className={`${styles.histPill} ${styles.histGray} ${styles.histPlaceholder}`}>
                  0.00
                </span>
              ) : (
                history.map((h, i) => (
                  <span
                    key={i}
                    className={`${styles.histPill} ${h.won ? styles.histGreen : styles.histGray}`}
                  >
                    {Number(h.roll).toFixed(2)}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={styles.sliderWrapper}>
          <div className={styles.scaleLabels}>
            <span style={{ "--p": 0 }}>0</span>
            <span style={{ "--p": 25 }}>25</span>
            <span style={{ "--p": 50 }}>50</span>
            <span style={{ "--p": 75 }}>75</span>
            <span style={{ "--p": 100 }}>100</span>
          </div>

          <div className={styles.trackContainer}>
            <div className={styles.tick} style={{ "--p": 0 }} />
            <div className={styles.tick} style={{ "--p": 25 }} />
            <div className={styles.tick} style={{ "--p": 50 }} />
            <div className={styles.tick} style={{ "--p": 75 }} />
            <div className={styles.tick} style={{ "--p": 100 }} />

            <div className={styles.trackPad}>
              <div className={styles.trackInner}>
                <div
                  className={`${styles.trackBar} ${styles.barLeft} ${leftBarColor}`}
                  style={{ width: `${targetNumber}%`, ...transitionStyle }}
                />
                <div
                  className={`${styles.trackBar} ${styles.barRight} ${rightBarColor}`}
                  style={{ width: `${100 - targetNumber}%`, ...transitionStyle }}
                />

                <div
                  className={styles.handleWrapper}
                  style={{ left: `${targetNumber}%`, ...transitionStyle }}
                >
                  <div className={styles.handle}>
                    <div className={styles.handleIcon}>
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>

                <div
                  className={`${styles.resultGem} ${showResult ? styles.visible : ""}`}
                  style={{ left: `${resultPosition}%` }}
                >
                  <div className={`${styles.gemPress} ${pressing ? styles.pressed : ""}`}>
                    <div key={arrivalNonce} className={styles.gemBounce}>
                      {/* viewBox bottom = the corner itself (y 103), so the
                          corner lands exactly on the track's vertical centre.
                          No silhouette, no stroke, no ring — the three bare
                          facets ARE the hexagon, rounded (r≈6) by the clip. */}
                      <svg className={styles.gemSvg} viewBox="0 0 100 103" aria-hidden="true">
                        <defs>
                          <clipPath id="diceGemHex">
                            <path d="M44.8,12 Q50,9 55.2,12 L84.8,29 Q90,32 90,38 L90,74 Q90,80 84.8,83 L55.2,100 Q50,103 44.8,100 L15.2,83 Q10,80 10,74 L10,38 Q10,32 15.2,29 Z" />
                          </clipPath>
                        </defs>
                        <g clipPath="url(#diceGemHex)">
                          {/* left facet */}
                          <polygon points="10,32 50,56 50,103 10,80" fill="#eef2f7" />
                          {/* right facet */}
                          <polygon points="50,56 90,32 90,80 50,103" fill="#d7dfe8" />
                          {/* top facet: white */}
                          <polygon points="50,9 90,32 50,56 10,32" fill="#ffffff" />
                        </g>
                      </svg>
                      <div className={`${styles.gemLabel} ${labelClass}`}>
                        {Number(shownPosition).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                <input
                  type="range"
                  min={TARGET_MIN}
                  max={TARGET_MAX}
                  step="1"
                  value={targetNumber}
                  onChange={handleSliderChange}
                  onMouseDown={() => {
                    setIsDragging(true);
                    lastDragValueRef.current = targetNumber;
                  }}
                  onMouseUp={() => setIsDragging(false)}
                  onTouchStart={() => {
                    setIsDragging(true);
                    lastDragValueRef.current = targetNumber;
                  }}
                  onTouchEnd={() => setIsDragging(false)}
                  className={styles.rangeInput}
                  disabled={isRolling}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.statsPanel}>
          <div className={styles.statBox}>
            <div className={styles.statHeader}>Multiplier</div>
            <div className={`${styles.statInput} ${styles.editable}`}>
              <input
                type="number"
                value={multiplierInput}
                onChange={handleMultiplierChange}
                step="0.0001"
                disabled={isRolling}
              />
              <span className={styles.statSuffix}>×</span>
              <Stepper value={multiplierInput} onChange={(v) => handleMultiplierChange({ target: { value: v } })} step={0.01} min={MIN_MULTIPLIER} max={MAX_MULTIPLIER} decimals={4} disabled={isRolling} />
            </div>
          </div>

          <div className={styles.statBox}>
            <div className={styles.statHeader}>Roll {rollUnder ? "Under" : "Over"}</div>
            <div className={`${styles.statInput} ${styles.editable}`}>
              <input type="number" value={targetNumber} onChange={handleTargetInputChange} disabled={isRolling} />
              <button className={styles.swapBtn} onClick={toggleMode} type="button" disabled={isRolling}>
                <IconArrowClockwise />
              </button>
              <Stepper value={targetNumber} onChange={(v) => handleTargetInputChange({ target: { value: v } })} step={1} min={TARGET_MIN} max={TARGET_MAX} decimals={0} disabled={isRolling} />
            </div>
          </div>

          <div className={styles.statBox}>
            <div className={styles.statHeader}>Win Chance</div>
            <div className={`${styles.statInput} ${styles.editable}`}>
              <input
                type="number"
                value={winChanceInput}
                onChange={handleWinChanceChange}
                step="0.01"
                disabled={isRolling}
              />
              <span className={styles.statSuffix}>%</span>
              <Stepper value={winChanceInput} onChange={(v) => handleWinChanceChange({ target: { value: v } })} step={1} min={0.01} max={98} decimals={2} disabled={isRolling} />
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Dice;