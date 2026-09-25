import Stepper from "../common/Stepper";
import { useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./limbo.module.css";

import useGameAudio from "../../hooks/useGameAudio";

// ✅ Limbo sounds
import limboWinMp3 from "../../assets/limbo/Win.mp3";
import limboRoundMp3 from "../../assets/limbo/Round.mp3";
import CurrencyIcon from "../common/CurrencyIcon";
import WinPopup from "../common/WinPopup";
import HistoryPills from "../common/HistoryPills";
import useGameHistory from "../../hooks/useGameHistory";

/* The big multiplier, one fixed-width SLOT per digit: a narrow "1" and a
   wide "6" take exactly the same room, so while the number counts up the
   digits never shove each other around. A new integer digit simply opens
   one more slot on the left (keys count from the right, so the existing
   slots keep their identity). Very long results shrink to fit. */
function SlotNumber({ value, className }) {
  const text = `${Number(value || 0).toFixed(2)}×`;
  const chars = text.split("");
  const scale = chars.length > 8 ? 8 / chars.length : 1;
  return (
    <div
      className={className}
      style={scale < 1 ? { "--limbo-mult-scale": scale } : undefined}
      role="img"
      aria-label={text}
      data-limbo-number={text}
    >
      {chars.map((ch, i) => {
        const digit = ch >= "0" && ch <= "9";
        return (
          <span
            key={chars.length - i}
            className={digit ? styles.slotDigit : ch === "." ? styles.slotDot : styles.slotMark}
            aria-hidden="true"
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}

function Limbo({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    {
      win: limboWinMp3,
      round: limboRoundMp3,
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
  const [targetMultiplier, setTargetMultiplier] = useState("2.00");
  const [isPlaying, setIsPlaying] = useState(false);
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);

  const [result, setResult] = useState(null);
  const { history, push: pushHistory } = useGameHistory("limbo");

  const [displayMult, setDisplayMult] = useState(1.0);
  const animTokenRef = useRef(0);

  const target = useMemo(() => parseFloat(targetMultiplier) || 2.0, [targetMultiplier]);

  const LIMBO_EDGE = 0.5;
  const winChance = ((1 - LIMBO_EDGE) / target) * 100;

  const profit = useMemo(() => {
    const b = parseFloat(betAmount || 0) || 0;
    return b * (target - 1);
  }, [betAmount, target]);

  const animateTo = async (toValue, durationMs = 650) => {
    const token = ++animTokenRef.current;
    const from = 1.0;
    const to = Math.max(1.0, Number(toValue) || 1.0);

    const start = performance.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    while (true) {
      if (animTokenRef.current !== token) return;

      const now = performance.now();
      const t = Math.min(1, (now - start) / durationMs);
      const v = from + (to - from) * easeOutCubic(t);

      setDisplayMult(Number(v.toFixed(2)));

      if (t >= 1) break;
      await new Promise((r) => setTimeout(r, 16));
    }

    setDisplayMult(Number(to.toFixed(2)));
  };

  const handlePlay = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    if (isPlaying) return;

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }
    if (target < 1.01 || target > 1000000) {
      return toast.error("Target must be between 1.01x and 1,000,000x");
    }

    setIsPlaying(true);
    setResult(null);
    setDisplayMult(1.0);

    // ✅ round start sound
    sfx.play("round", { volume: 1 });

    // ✅ instantly subtract bet
    updateBalance((b) => b - amount);

    try {
      const response = await gamesAPI.playLimbo({
        betAmount: amount,
        targetMultiplier: target,
      });

      const res = response.data.result;

      // animate first
      await animateTo(res.multiplier, 650);

      // ✅ only after animation finishes: win sound
      if (res?.won) {
        sfx.play("win", { volume: 1 });
      }

      const uiRes = {
        resultMultiplier: res.multiplier,
        won: res.won,
        payout: res.payout,
        balance: res.balance,
        target, // what a win pays (payout = bet × target)
      };

      setResult(uiRes);
      pushHistory({
        roundId: response.data?.round?.round_uuid ?? `limbo-${Date.now()}`,
        value: res.multiplier,
        won: res.won,
      });

      // ✅ after animation: set server-truth balance
      updateBalance(res.balance);

      if (res.won) {
        // (your original had `if (res.won);` which does nothing
        // keep toast if you want, but you didn’t have one here)
      }
    } catch (error) {
      // ✅ if request failed, refund the bet
      updateBalance((b) => b + amount);
      toast.error(error.response?.data?.message || "Play failed");
    } finally {
      setIsPlaying(false);
    }
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("limbo", isPlaying);


  const adjustBet = (val) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * val).toFixed(2));
  };

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
                disabled={isPlaying}
              />
              <CurrencyIcon className={styles.btcIcon} />
            </div>

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isPlaying}>
                ½
              </button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isPlaying}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <span className="ui-bet-wrap">
          <button className={styles.betButton} onClick={handlePlay} disabled={isLocked || isPlaying} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          {isPlaying ? "Betting..." : "Bet"}
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
        {/* History pills — same row as Crash / Wheel / Dice, top of the stage */}
        <HistoryPills
          className={styles.historyTop}
          items={history.map((h) => ({ key: h.roundId, label: `${Number(h.value).toFixed(2)}×`, won: h.won }))}
        />

        <SlotNumber
          value={displayMult}
          className={`${styles.bigMultiplier} ${result ? (result.won ? styles.bigWin : styles.bigLoss) : ""}`}
        />

        {result?.won && (
          <WinPopup multiplier={result.target} amount={result.payout} className={styles.winPopup} />
        )}

        <div className={styles.bottomStack}>
          {/* Locked while a bet runs: nothing in this row can change mid-round */}
          <div className={`${styles.bottomPanel} ${isPlaying ? "ui-stats-locked" : ""}`} aria-disabled={isPlaying || undefined}>
            <div className={styles.bottomBox}>
              <div className={styles.bottomLabel}>Target Multiplier</div>
              <div className={`${styles.bottomInputWrap} ui-stats-field`}>
                <input
                  className={styles.bottomInput}
                  type="number"
                  value={targetMultiplier}
                  onChange={(e) => setTargetMultiplier(e.target.value)}
                  step="0.01"
                  min="1.01"
                  disabled={isPlaying}
                />
                <span className={styles.xSuffix}>×</span>
                <Stepper value={targetMultiplier} onChange={setTargetMultiplier} step={0.1} min={1.01} decimals={2} disabled={isPlaying} />
              </div>
            </div>

            <div className={styles.bottomBox}>
              <div className={styles.bottomLabel}>Win Chance</div>
              <div className={`${styles.bottomInputWrap} ui-stats-field`}>
                <input
                  className={styles.bottomInput}
                  type="text"
                  value={winChance.toFixed(2)}
                  readOnly
                  disabled={isPlaying}
                />
                <span className={styles.percentSuffix}>%</span>
              </div>
            </div>
          </div>

        </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Limbo;