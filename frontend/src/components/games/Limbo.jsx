import Stepper from "../common/Stepper";
import { useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import usePillSlide from "../../hooks/usePillSlide";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { IconArticle } from "../common/Icons";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./limbo.module.css";

import useGameAudio from "../../hooks/useGameAudio";

// ✅ Limbo sounds
import limboWinMp3 from "../../assets/limbo/Win.mp3";
import limboRoundMp3 from "../../assets/limbo/Round.mp3";
import CurrencyIcon from "../common/CurrencyIcon";

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
  const [history, setHistory] = useState([]);
  // Stable pill ids: the slide keys on the newest pill's IDENTITY (the row
  // is capped, so its length stops changing while new pills keep arriving)
  const pillSeqRef = useRef(0);
  const historyScrollRef = useRef(null);
  // Pill row slides in from the right as one motion on every addition
  const { pillsRef, slideKey, slideFrom } = usePillSlide(history[0]?._pillId ?? null);

  // Crash parity (mobile scroller): keep the freshest pill in view
  useEffect(() => {
    const el = historyScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const newest = el.firstElementChild?.firstElementChild;
    if (newest && typeof newest.scrollIntoView === "function") {
      newest.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }, [history]);

  const [displayMult, setDisplayMult] = useState(1.0);
  const animTokenRef = useRef(0);
  // guards against double-flight interleaving + restores the display on error
  const busyRef = useRef(false);
  const prevDisplayRef = useRef(1.0);

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
    if (isPlaying || busyRef.current) return;

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }
    if (target < 1.01 || target > 1000000) {
      return toast.error("Target must be between 1.01x and 1,000,000x");
    }

    busyRef.current = true;
    prevDisplayRef.current = displayMult;
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

      // single source of truth for the display, result and history pill
      const uiRes = {
        resultMultiplier: Number(res.multiplier) || 0,
        won: res.won,
        payout: res.payout,
        balance: res.balance,
      };

      // animate first
      await animateTo(uiRes.resultMultiplier, 650);

      // ✅ only after animation finishes: win sound
      if (uiRes.won) {
        sfx.play("win", { volume: 1 });
      }

      // pin the display to the exact logged value (never a stale frame)
      setDisplayMult(Number(uiRes.resultMultiplier.toFixed(2)));
      setResult(uiRes);
      setHistory((prev) => [{ ...uiRes, _pillId: ++pillSeqRef.current }, ...prev].slice(0, 10));

      // ✅ after animation: set server-truth balance
      updateBalance(res.balance);

      if (res.won) {
        // (your original had `if (res.won);` which does nothing
        // keep toast if you want, but you didn’t have one here)
      }
    } catch (error) {
      // ✅ if request failed, refund the bet and restore the last display
      updateBalance((b) => b + amount);
      setDisplayMult(prevDisplayRef.current);
      toast.error(error.response?.data?.message || "Play failed");
    } finally {
      busyRef.current = false;
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
        {/* Always rendered: an invisible placeholder pill reserves the
            row's space until the first real pill swaps in — the row never
            grows, so content below never jumps. Newest-first, exactly like
            Crash (row-reverse puts the first pill at the right). */}
        <div className={styles.historyRow}>
          <div className={styles.historyScroll} ref={historyScrollRef}>
            <div
                  key={slideKey}
                  ref={pillsRef}
                  className={styles.historyPills}
                  style={slideFrom ? { "--pill-slide-from": `${slideFrom}px` } : undefined}
                >
              {history.length === 0 ? (
                <span className={`${styles.histPill} ${styles.histGray} ${styles.histPlaceholder}`}>
                  0.00×
                </span>
              ) : (
                history.map((h) => (
                  <span
                    key={h._pillId}
                    className={`${styles.histPill} ${h.won ? styles.histGreen : styles.histGray}`}
                  >
                    {Number(h.resultMultiplier).toFixed(2)}×
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
        {/* Crash's marker row, identical in every pills game */}
        <div className={styles.historyMeta}>
          <button className={styles.historyIcon} type="button" aria-label="My bets">
            <IconArticle size={18} />
          </button>
          <span className={styles.historyYou}>‹ You</span>
        </div>

        <div
          className={`${styles.bigMultiplier} ${result ? (result.won ? styles.bigWin : styles.bigLoss) : ""
            }`}
        >
          {/* Odometer: every digit gets a fixed slot, the decimal point is
              anchored dead-centre, and the integer part grows leftward — the
              string never shifts as digits change width or count. */}
          <span className={styles.odInt} aria-hidden="true">
            {displayMult.toFixed(2).split(".")[0].split("").map((d, i, arr) => (
              <span key={arr.length - i} className={styles.odSlot}>{d}</span>
            ))}
          </span>
          <span className={styles.odRight} aria-hidden="true">
            <span className={styles.odFrac}>
              <span className={styles.odDot}>.</span>
              {displayMult.toFixed(2).split(".")[1].split("").map((d, i) => (
                <span key={i} className={styles.odSlot}>{d}</span>
              ))}
            </span>
            <span className={styles.odSuffix}>×</span>
          </span>
          <span className={styles.odSrOnly}>{displayMult.toFixed(2)}×</span>
        </div>

        {result?.won && (
          <div className={styles.winPopup}>
            <div className={styles.winPopupMult}>{Number(result.resultMultiplier).toFixed(2)}×</div>
            <div className={styles.winPopupDivider} aria-hidden="true" />
            <div className={styles.winPopupAmount}>{Number(result.payout).toFixed(2)}<CurrencyIcon /></div>
          </div>
        )}

        <div className={styles.bottomStack}>
          <div className={styles.bottomPanel}>
            <div className={styles.bottomBox}>
              <div className={styles.bottomLabel}>Target Multiplier</div>
              <div className={styles.bottomInputWrap}>
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
              <div className={styles.bottomInputWrap}>
                <input
                  className={styles.bottomInput}
                  type="text"
                  value={winChance.toFixed(2)}
                  readOnly
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