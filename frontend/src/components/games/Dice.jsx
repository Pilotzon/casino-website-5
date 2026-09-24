import Stepper from "../common/Stepper";
import { useState, useEffect, useMemo, useRef } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
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

  // ✅ Win popup (Limbo-like)
  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winPayout, setWinPayout] = useState(0);

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

    // reset win popup per round
    setShowWinPopup(false);
    setWinPayout(0);

    // ✅ Round start sound
    sfx.play("round", { volume: 1 });

    try {
      const response = await gamesAPI.playDice({
        betAmount: amount,
        targetNumber,
        rollUnder,
      });

      const result = response.data.result;

      // show new roll immediately; set lastResult before animation completes
      setLastResult(result);

      setShowResult(true);
      setResultPosition(result.roll);

      // ✅ Wait for result gem movement animation to finish
      await new Promise((r) => setTimeout(r, 400));

      // ✅ After animation finishes: win sound + win popup
      if (result?.won) {
        sfx.play("win", { volume: 1 });
        setWinPayout(Number(result.payout || 0));
        setShowWinPopup(true);
      }

      updateBalance(result.balance);

      if (result.won);
    } catch (error) {
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

    // changing target hides prior popup
    setShowWinPopup(false);
    setWinPayout(0);
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

      setShowWinPopup(false);
      setWinPayout(0);
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

      setShowWinPopup(false);
      setWinPayout(0);
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

    setShowWinPopup(false);
    setWinPayout(0);
  };

  const toggleMode = () => {
    setRollUnder((prev) => !prev);

    const flipped = MAX_ROLL - targetNumber;
    const clamped = clamp(flipped, TARGET_MIN, TARGET_MAX);
    setTargetNumber(clamped);
    lastDragValueRef.current = clamped;
    setShowResult(false);

    setShowWinPopup(false);
    setWinPayout(0);
  };

  const leftBarColor = rollUnder ? styles.barGreen : styles.barRed;
  const rightBarColor = rollUnder ? styles.barRed : styles.barGreen;
  const transitionStyle = isDragging ? { transition: "none" } : {};

  const profit =
    parseFloat(betAmount || 0) * parseFloat(multiplierInput || 0) -
    parseFloat(betAmount || 0);
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("dice", isRolling);


  const gemClass = useMemo(() => {
    if (!lastResult) return styles.gemLoss;
    return lastResult.won ? styles.gemWin : styles.gemLoss;
  }, [lastResult]);

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
              <span className={styles.btcIcon}>$</span>
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

        <button className={styles.betButton} onClick={handleRoll} disabled={isLocked || isRolling} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          {isRolling ? "Rolling..." : "Bet"}
        </button>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Profit on Win</span>
            <span>$0.00</span>
          </div>
          <div className={styles.readonlyInput}>
            <input type="text" value={profit.toFixed(2)} readOnly />
            <span className={styles.btcIcon}>$</span>
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* ✅ Limbo-style win popup */}
        {showWinPopup && (
          <div className={styles.winPopup}>
            <div className={styles.winPopupTitle}>YOU WON</div>
            <div className={styles.winPopupAmount}>{Number(winPayout || 0).toFixed(2)} $</div>
          </div>
        )}

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
                  className={`${styles.resultGem} ${showResult ? styles.visible : ""} ${gemClass}`}
                  style={{ left: `${resultPosition}%` }}
                >
                  <div className={styles.gemInner}></div>
                  <div className={styles.resultValueBubble}>
                    {showResult ? Number(resultPosition).toFixed(2) : ""}
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
              />
              <span className={styles.statSuffix}>×</span>
              <Stepper value={multiplierInput} onChange={(v) => handleMultiplierChange({ target: { value: v } })} step={0.01} min={MIN_MULTIPLIER} max={MAX_MULTIPLIER} decimals={4} />
            </div>
          </div>

          <div className={styles.statBox}>
            <div className={styles.statHeader}>Roll {rollUnder ? "Under" : "Over"}</div>
            <div className={`${styles.statInput} ${styles.editable}`}>
              <input type="number" value={targetNumber} onChange={handleTargetInputChange} />
              <button className={styles.swapBtn} onClick={toggleMode} type="button">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                </svg>
              </button>
              <Stepper value={targetNumber} onChange={(v) => handleTargetInputChange({ target: { value: v } })} step={1} min={TARGET_MIN} max={TARGET_MAX} decimals={0} />
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
              />
              <span className={styles.statSuffix}>%</span>
              <Stepper value={winChanceInput} onChange={(v) => handleWinChanceChange({ target: { value: v } })} step={1} min={0.01} max={98} decimals={2} />
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