import { useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./mines.module.css";

import gemImg from "../../assets/mines/gem.png";
import mineImg from "../../assets/mines/mine.png";

import useGameAudio from "../../hooks/useGameAudio";

// ✅ Mines sounds
import gem1Mp3 from "../../assets/mines/Gem.mp3";
import gem2Mp3 from "../../assets/mines/Gem-2.mp3";
import gem3Mp3 from "../../assets/mines/Gem-3.mp3";
import mineMp3 from "../../assets/mines/Mine.mp3";
import CurrencyIcon from "../common/CurrencyIcon";

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

const format8 = (n) => Number(n || 0).toFixed(2); // 2 decimals everywhere

function Mines({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    {
      gem1: gem1Mp3,
      gem2: gem2Mp3,
      gem3: gem3Mp3,
      mine: mineMp3,
    },
    { enabled: soundEnabled, volume: soundVolume }
  );

  const [betAmount, setBetAmount] = useState("");
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);

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
  const [mineCount, setMineCount] = useState(3);

  const [roundId, setRoundId] = useState(null);
  const [inProgress, setInProgress] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const [cells, setCells] = useState(() => Array.from({ length: CELL_COUNT }, () => "hidden"));
  const [revealedCells, setRevealedCells] = useState([]);
  const [minePositions, setMinePositions] = useState(null);
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);

  const [clickedCell, setClickedCell] = useState(null);
  const animRef = useRef(0);

  // ✅ track whether round ended by loss (hit mine)
  const [didLose, setDidLose] = useState(false);
  // tile the player clicked when the mine hit (stays full opacity)
  const [lossMineIdx, setLossMineIdx] = useState(null);

  // ✅ Win popup (Limbo-like) for cashout
  const [showWinPopup, setShowWinPopup] = useState(false);
  const [lastCashoutPayout, setLastCashoutPayout] = useState(0);
  const [lastCashoutMult, setLastCashoutMult] = useState(1);

  /**
   * ✅ Gem streak + Gem-3 rule
   * - streak 1 => Gem
   * - streak 2 => Gem-2
   * - streak 3 => Gem-3, then for ONLY the next 2 gems => Gem-3
   * After those 2 gems are consumed, return to normal logic (still streaking).
   *
   * Important: while consuming those 2 extra Gem-3 clicks, we must NOT re-arm the buff.
   */
  const gemStreakRef = useRef(0);
  const gem3BuffRemainingRef = useRef(0); // 0..2
  const gem3BuffLockRef = useRef(false); // true while consuming the 2 post-3rd Gem-3s

  const ended = minePositions != null;

  const gemsFound = revealedCells.length;
  const gemsLeft = CELL_COUNT - mineCount - gemsFound;

  const bet = useMemo(() => parseFloat(betAmount) || 0, [betAmount]);
  const profit = useMemo(() => bet * currentMultiplier - bet, [bet, currentMultiplier]);

  const canReveal = inProgress && !isBusy && !ended;
  const canCashout = inProgress && !isBusy && !ended && gemsFound > 0;

  const resetGemSoundState = () => {
    gemStreakRef.current = 0;
    gem3BuffRemainingRef.current = 0;
    gem3BuffLockRef.current = false;
  };

  const reset = () => {
    animRef.current += 1;
    setCells(Array.from({ length: CELL_COUNT }, () => "hidden"));
    setRevealedCells([]);
    setMinePositions(null);
    setCurrentMultiplier(1.0);
    setRoundId(null);
    setInProgress(false);
    setClickedCell(null);
    setDidLose(false);
    setLossMineIdx(null);

    setShowWinPopup(false);
    setLastCashoutPayout(0);
    setLastCashoutMult(1);

    resetGemSoundState();
  };

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * factor).toFixed(2));
  };

  const start = async () => {
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (isBusy) return;

    if (!Number.isFinite(bet) || bet <= 0) { setBetError("Invalid bet amount"); return; }
    if (bet > user.balance) { setBetError("Insufficient balance"); return; }

    setIsBusy(true);
    try {
      reset();
      const res = await gamesAPI.startMines({ betAmount: bet, mineCount, gridSize: GRID_SIZE });
      const gs = res.data.gameState;

      setRoundId(gs.roundId);
      setInProgress(true);
      setCurrentMultiplier(Number(gs.currentMultiplier) || 1.0);
      setRevealedCells(gs.revealedCells || []);
      setDidLose(false);

      if (typeof gs.balanceAfterBet === "number") updateBalance(gs.balanceAfterBet);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to start");
      reset();
    } finally {
      setIsBusy(false);
    }
  };

  const playGemSound = () => {
    // Increment streak on every gem
    const streak = gemStreakRef.current + 1;
    gemStreakRef.current = streak;

    // If we're in the "ONLY next 2 gems" phase after a 3rd gem,
    // we must play Gem-3 and consume the buff, without re-arming.
    if (gem3BuffLockRef.current && gem3BuffRemainingRef.current > 0) {
      gem3BuffRemainingRef.current -= 1;
      sfx.play("gem3", { volume: 1 });

      if (gem3BuffRemainingRef.current <= 0) {
        // buff consumption finished; unlock (normal logic resumes for future gems)
        gem3BuffLockRef.current = false;
      }
      return;
    }

    // Normal mapping for streak counts
    if (streak === 1) {
      sfx.play("gem1", { volume: 1 });
      return;
    }
    if (streak === 2) {
      sfx.play("gem2", { volume: 1 });
      return;
    }

    // streak >= 3:
    // On exactly the 3rd gem in a row: play Gem-3 and start the "next 2 gems" lock/buff.
    if (streak === 3) {
      sfx.play("gem3", { volume: 1 });
      gem3BuffRemainingRef.current = 2;
      gem3BuffLockRef.current = true;
      return;
    }

    // For streak 4+ when NOT in the locked buff window:
    // You didn't specify additional sounds, so default back to Gem.
    sfx.play("gem1", { volume: 1 });
  };

  const reveal = async (idx) => {
    if (!canReveal) return;
    if (cells[idx] !== "hidden") return;
    if (!roundId) return;

    setIsBusy(true);
    setClickedCell(idx);
    const myAnim = ++animRef.current;

    try {
      const res = await gamesAPI.revealMinesCell({ roundId, cellIndex: idx });
      const data = res.data;

      // click returns to place then icon pops
      await new Promise((r) => setTimeout(r, 90));
      if (animRef.current !== myAnim) return;

      if (data.hitMine) {
        // ✅ mine sound
        sfx.play("mine", { volume: 1 });

        // reset streak/buff on mine
        resetGemSoundState();

        // A mine hit reveals the ENTIRE board: every mine plus every gem
        // the player hadn't pressed yet (auto-revealed tiles render dimmed).
        const mineSet = new Set(Array.isArray(data.minePositions) ? data.minePositions : [idx]);
        setLossMineIdx(idx);
        setCells((prev) => {
          const next = [...prev];
          for (let i = 0; i < CELL_COUNT; i++) {
            if (next[i] === "hidden") next[i] = mineSet.has(i) ? "mine" : "gem";
          }
          return next;
        });

        if (Array.isArray(data.minePositions)) {
          setMinePositions(data.minePositions);
        } else {
          setMinePositions([]);
        }

        setInProgress(false);
        setDidLose(true);
        return;
      }

      // ✅ confirmed gem -> play the correct gem sound
      playGemSound();

      setCells((prev) => {
        const next = [...prev];
        next[idx] = "gem";
        return next;
      });

      setRevealedCells(data.revealedCells || []);
      setCurrentMultiplier(Number(data.currentMultiplier) || 1.0);
    } catch (e) {
      toast.error(e.response?.data?.message || "Reveal failed");
    } finally {
      setIsBusy(false);
      setTimeout(() => {
        if (animRef.current === myAnim) setClickedCell(null);
      }, 220);
    }
  };

  const cashout = async () => {
    if (!canCashout) return;
    if (!roundId) return;

    setIsBusy(true);
    try {
      const res = await gamesAPI.cashoutMines({ roundId });
      const data = res.data;

      // Cashout reveals the ENTIRE board, same as a mine hit: every mine
      // plus every unpressed gem, all at once.
      const cashoutMineSet = new Set(Array.isArray(data.minePositions) ? data.minePositions : []);
      setMinePositions(data.minePositions || []);
      setCells((prev) => {
        const next = [...prev];
        for (let i = 0; i < CELL_COUNT; i++) {
          if (next[i] === "hidden") next[i] = cashoutMineSet.has(i) ? "mine" : "gem";
        }
        return next;
      });

      setCurrentMultiplier(Number(data.multiplier) || currentMultiplier);
      setInProgress(false);
      setDidLose(false);

      // ✅ show win popup for cashout
      const payout = Number(data.payout || 0);
      setLastCashoutPayout(payout);
      setLastCashoutMult(Number(data.multiplier) || currentMultiplier);
      setShowWinPopup(true);

      // streak ends on cashout
      resetGemSoundState();

      if (typeof data.balance === "number") updateBalance(data.balance);

    } catch (e) {
      toast.error(e.response?.data?.message || "Cashout failed");
    } finally {
      setIsBusy(false);
    }
  };

  const randomPick = async () => {
    if (!canReveal) return;
    const hidden = [];
    for (let i = 0; i < CELL_COUNT; i++) if (cells[i] === "hidden") hidden.push(i);
    if (!hidden.length) return;
    const pick = hidden[Math.floor(Math.random() * hidden.length)];
    await reveal(pick);
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("mines", inProgress);


  const mainLabel = !inProgress ? "Bet" : "Cashout";
  const mainDisabled = isLocked || isBusy || (inProgress && !canCashout);

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
                disabled={isBusy || inProgress}
              />
            </div>

            <div className={styles.coinChip}><CurrencyIcon className={styles.coinIcon} /></div>

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isBusy || inProgress}>
                ½
              </button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isBusy || inProgress}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Mines</span>
          </div>

          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select
              className={styles.select}
              value={mineCount}
              onChange={(e) => setMineCount(parseInt(e.target.value, 10))}
              disabled={isBusy || inProgress}
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Gems</span>
          </div>

          <div className={styles.readonlyInput}>
            <input value={String(gemsLeft)} readOnly />
          </div>
        </div>

        <span className="ui-bet-wrap">
          <button
            className={`${styles.bigButton} ${inProgress ? styles.cashout : styles.bet}`}
            onClick={() => (inProgress ? cashout() : start())}
            disabled={mainDisabled} title={isLocked ? betErrorMessage : undefined} data-bet-sound="true"
            type="button"
            >
          {mainLabel}
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        <button className={styles.secondaryButton} disabled={!canReveal} onClick={randomPick} type="button">
          Random Pick
        </button>

        <div className={styles.controlGroup} style={{ marginTop: "0" }}>
          <div className={styles.labelRow}>
            <span>Total Profit ({currentMultiplier.toFixed(2)}×)</span>
            <span>$0.00</span>
          </div>

          <div className={`${styles.readonlyInput} ${styles.profitInput}`}>
            <input value={format8(profit)} readOnly />
            <CurrencyIcon className={styles.coinChipSmall} />
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* ✅ Win popup (Limbo-like) */}
        {showWinPopup && !didLose && lastCashoutPayout > 0 && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupMult}>{Number(lastCashoutMult || 0).toFixed(2)}×</div>
            <div className={styles.winPopupDivider} aria-hidden="true" />
            <div className={styles.winPopupAmount}>{format8(lastCashoutPayout)}<CurrencyIcon /></div>
          </div>
        )}

        <div className={styles.grid}>
          {Array.from({ length: CELL_COUNT }, (_, i) => {
            const st = cells[i];
            const isRevealed = st === "gem" || st === "mine";
            // Tiles the player pressed (gems + the fatal mine) stay full
            // opacity; everything auto-revealed at round end (loss OR
            // cashout) is dimmed to 0.7. All reveal simultaneously.
            const userPressed = revealedCells.includes(i) || i === lossMineIdx;
            const dimmed = ended && isRevealed && !userPressed;

            return (
              <button
                key={i}
                type="button"
                className={`${styles.tile} ${isRevealed ? styles.tileRevealed : ""} ${dimmed ? styles.tileDimmed : ""}`}
                onClick={() => reveal(i)}
                disabled={!canReveal || isRevealed}
              >
                <span className={styles.cover} aria-hidden="true" />
                {st === "gem" && (
                  <img className={styles.icon} src={gemImg} alt="" />
                )}
                {st === "mine" && (
                  <img className={styles.icon} src={mineImg} alt="" />
                )}
              </button>
            );
          })}
        </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Mines;