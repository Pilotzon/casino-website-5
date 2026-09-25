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
import WinPopup from "../common/WinPopup";

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

const format8 = (n) => Number(n || 0).toFixed(2); // 2 decimals everywhere

/* Tile reveal choreography (ms) — keep in sync with mines.module.css.
   Click: the cover lifts to 1.03, collapses to 0 around its exact centre,
   then the gem / mine scales up out of the hole. */
const COVER_LIFT_MS = 150; // cover 1 -> 1.03 (held while the server answers)
const ICON_LAG_MS = 160; // icon starts as the cover (190ms) is nearly gone
const BOARD_REVEAL_GAP_MS = 280; // end of round: the rest of the board follows…
const BOARD_RIPPLE_MS = 45; // …rippling out from the last pick, per tile of distance

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every still-hidden tile turns into a gem or a mine (mines = server list). */
function revealWholeBoard(prev, mines) {
  const set = new Set(mines);
  return prev.map((st, i) => (st !== "hidden" ? st : set.has(i) ? "mine" : "gem"));
}

/** Start delay for every still-hidden tile: a ripple out from `origin`
    (a grid index, or the board centre when null). */
function rippleDelays(prev, origin) {
  const ox = origin == null ? (GRID_SIZE - 1) / 2 : origin % GRID_SIZE;
  const oy = origin == null ? (GRID_SIZE - 1) / 2 : Math.floor(origin / GRID_SIZE);
  const out = {};
  prev.forEach((st, i) => {
    if (st !== "hidden" || i === origin) return;
    const d = Math.hypot((i % GRID_SIZE) - ox, Math.floor(i / GRID_SIZE) - oy);
    out[i] = Math.round((origin == null ? 60 : BOARD_REVEAL_GAP_MS) + d * BOARD_RIPPLE_MS);
  });
  return out;
}

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

  const [pendingCell, setPendingCell] = useState(null); // clicked, waiting for the server (cover lifted)
  const [picked, setPicked] = useState(() => new Set()); // tiles the player opened this round
  const [revealDelays, setRevealDelays] = useState({}); // end-of-round board reveal (ripple)
  const [boardKey, setBoardKey] = useState(0); // new round -> the covers drop back in
  const animRef = useRef(0);
  const soundTimersRef = useRef([]);
  useEffect(() => () => soundTimersRef.current.forEach(clearTimeout), []);

  // ✅ track whether round ended by loss (hit mine)
  const [didLose, setDidLose] = useState(false);

  // ✅ Win popup (Limbo-like) for cashout
  const [showWinPopup, setShowWinPopup] = useState(false);
  const [lastCashoutPayout, setLastCashoutPayout] = useState(0);

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
    setPendingCell(null);
    setPicked(new Set());
    setRevealDelays({});
    setBoardKey((k) => k + 1);
    setDidLose(false);

    setShowWinPopup(false);
    setLastCashoutPayout(0);

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

  // play a sound in sync with the icon popping out of the hole
  const soundAtIcon = (fn, myAnim) => {
    soundTimersRef.current.push(
      setTimeout(() => {
        if (animRef.current === myAnim) fn();
      }, ICON_LAG_MS)
    );
  };

  const reveal = async (idx) => {
    if (!canReveal) return;
    if (cells[idx] !== "hidden") return;
    if (!roundId) return;

    setIsBusy(true);
    setPendingCell(idx); // the cover lifts to 1.03 while we wait
    const myAnim = ++animRef.current;
    const clickedAt = performance.now();

    try {
      const res = await gamesAPI.revealMinesCell({ roundId, cellIndex: idx });
      const data = res.data;

      // always let the lift finish before the cover collapses
      const held = performance.now() - clickedAt;
      if (held < COVER_LIFT_MS) await sleep(COVER_LIFT_MS - held);
      if (animRef.current !== myAnim) return;

      setPendingCell(null);
      setPicked((prev) => new Set(prev).add(idx));

      if (data.hitMine) {
        soundAtIcon(() => sfx.play("mine", { volume: 1 }), myAnim);
        resetGemSoundState();

        // the clicked mine opens first, then the WHOLE board follows —
        // rippling out from it (tiles the player did not open are dimmed)
        const mines = Array.isArray(data.minePositions) ? data.minePositions : [];
        setRevealDelays(rippleDelays(cells, idx));
        setCells((prev) => {
          const next = [...prev];
          next[idx] = "mine";
          return revealWholeBoard(next, mines);
        });
        setMinePositions(mines);
        setInProgress(false);
        setDidLose(true);
        return;
      }

      // confirmed gem -> the matching gem sound as it pops
      soundAtIcon(playGemSound, myAnim);

      setCells((prev) => {
        const next = [...prev];
        next[idx] = "gem";
        return next;
      });

      setRevealedCells(data.revealedCells || []);
      setCurrentMultiplier(Number(data.currentMultiplier) || 1.0);
    } catch (e) {
      if (animRef.current === myAnim) setPendingCell(null);
      toast.error(e.response?.data?.message || "Reveal failed");
    } finally {
      setIsBusy(false);
    }
  };

  const cashout = async () => {
    if (!canCashout) return;
    if (!roundId) return;

    setIsBusy(true);
    try {
      const res = await gamesAPI.cashoutMines({ roundId });
      const data = res.data;

      // cashing out opens the whole board too (unopened tiles dimmed)
      const mines = Array.isArray(data.minePositions) ? data.minePositions : [];
      setMinePositions(mines);
      setRevealDelays(rippleDelays(cells, null));
      setCells((prev) => revealWholeBoard(prev, mines));

      setCurrentMultiplier(Number(data.multiplier) || currentMultiplier);
      setInProgress(false);
      setDidLose(false);

      // ✅ show win popup for cashout
      const payout = Number(data.payout || 0);
      setLastCashoutPayout(payout);
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
          <WinPopup multiplier={currentMultiplier} amount={lastCashoutPayout} className={styles.winPopup} />
        )}

        {/* Each tile: the hole (with the gem / mine) under a #2F4553 cover.
            Opening a tile lifts the cover to 1.03, collapses it to 0 around
            its centre and scales the icon up out of the hole. When the round
            ends the rest of the board opens the same way; tiles the player
            did not open stay at 70% opacity. */}
        <div key={boardKey} className={styles.grid} data-board-state={ended ? (didLose ? "lost" : "cashed") : "live"}>
          {Array.from({ length: CELL_COUNT }, (_, i) => {
            const st = cells[i];
            const isRevealed = st === "gem" || st === "mine";
            const isPending = i === pendingCell && !isRevealed;
            const byBoard = isRevealed && !picked.has(i); // opened by the end-of-round reveal
            const delay = byBoard ? revealDelays[i] || 0 : 0;

            return (
              <button
                key={i}
                type="button"
                className={[
                  styles.tile,
                  isPending ? styles.tilePending : "",
                  isRevealed ? styles.tileRevealed : "",
                  byBoard ? styles.tileAuto : "",
                  byBoard && ended ? styles.tileDim : "",
                ].join(" ")}
                style={delay ? { "--reveal-delay": `${delay}ms` } : undefined}
                onClick={() => reveal(i)}
                disabled={!canReveal || isRevealed || isPending}
                aria-label={isRevealed ? (st === "gem" ? "Gem" : "Mine") : "Hidden tile"}
                data-cell={isPending ? "pending" : st}
              >
                <span className={styles.hole} aria-hidden="true">
                  {st === "gem" && <img className={styles.icon} src={gemImg} alt="" draggable="false" />}
                  {st === "mine" && <img className={styles.icon} src={mineImg} alt="" draggable="false" />}
                </span>
                <span className={styles.cover} aria-hidden="true" />
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