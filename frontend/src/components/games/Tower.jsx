import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./tower.module.css";

import boardBg from "../../assets/tower/board-background.webp";
import castleTopDefault from "../../assets/tower/castle-top.svg";
import castleTopWin from "../../assets/tower/castle-top-win.svg";

// ✅ Big dragon atlas
import bigDragonPng from "../../assets/tower/big_dragon_spritesheet.png";
import bigDragonAtlas from "../../assets/tower/big_dragon_spritesheet.json";

import DragonCompositePlayer from "./DragonCompositePlayer";
import { TOWER_ATLAS_ANIMS } from "./towerAtlas";

// ✅ Symbols atlas (egg/skull animations)
import symbolsPng from "../../assets/tower/symbols_spritesheet.png";
import symbolsAtlas from "../../assets/tower/symbols_spritesheet.json";
import AtlasPlayer from "./AtlasPlayer";
import { SYMBOLS_ATLAS_ANIMS } from "./symbolsAtlas";

import useGameAudio from "../../hooks/useGameAudio";

// ✅ Sounds (from frontend/src/assets/tower)
import winFinalMp3 from "../../assets/tower/WinFinal.mp3";
import winMp3 from "../../assets/tower/Win.mp3";
import selectedMp3 from "../../assets/tower/Selected.mp3";
import loseDragonMp3 from "../../assets/tower/LoseDragon.mp3";
import loseFireMp3 from "../../assets/tower/LoseFire.mp3";
import eggMp3 from "../../assets/tower/Egg.mp3";
import CurrencyIcon from "../common/CurrencyIcon";

const DIFFS = ["easy", "medium", "hard"];
const DEFAULT_ROWS = 9;

const DEFAULT_COLS_BY_DIFF = { easy: 4, medium: 3, hard: 2 };
const columnsByDifficulty = (diff) => DEFAULT_COLS_BY_DIFF[diff] ?? 4;

/* Castle+board unit design size (tower.module.css). The fit-scale
   computed below shrinks the unit to the stage, so the whole game —
   castle, board, dragon — always fits without clipping. */
const TOWER_UNIT_W = 560;
/* Dragon art hangs above the unit (top: -120px on desktop after the
   sizing follow-up, less on mobile) — reserve room for it in the fit
   calculation. The smaller desktop reserve lets the castle+board unit
   render noticeably larger. */
const TOWER_DRAGON_TOP_OFFSET = 170;

const format8 = (n) => Number(n || 0).toFixed(2); // 2 decimals everywhere

/**
 * Tile background artwork
 * IMPORTANT: keep fill="currentColor" so CSS can control it.
 */
function TileBgEasy({ active }) {
  return (
    <svg
      className={`${styles.tileBgSvg} ${active ? styles.tileBgSvgActive : ""}`}
      viewBox="0 0 260 46"
      aria-hidden="true"
      preserveAspectRatio="xMinYMin meet"
    >
      <path
        fill="currentColor"
        d="M95.15,22.39a.51.51,0,0,0,.29.08.56.56,0,0,0,.46-.25.55.55,0,0,0-.17-.75L61.57.08a.55.55,0,0,0-.75.17A.55.55,0,0,0,61,1L81.67,14,66.51,22.78,30.27.08a.55.55,0,0,0-.75.17.55.55,0,0,0,.17.75l1.11.7L.27,19.49a.54.54,0,0,0-.2.74.54.54,0,0,0,.47.27.55.55,0,0,0,.28-.07l31-18.08,14.9,9.33L8.53,34,.83,29.13a.54.54,0,0,0-.58.92l24.11,15.1a.6.6,0,0,0,.29.08.54.54,0,0,0,.29-1L9.57,34.6l19.7-11.48L48.14,34.41a.6.6,0,0,0,.28.08.55.55,0,0,0,.28-.07l34-19.82ZM48.43,33.32,30.34,22.5,47.78,12.33,65.45,23.4Z"
      />
      <path
        fill="currentColor"
        d="M173.06,21.47,138.9.08a.54.54,0,0,0-.74.17.54.54,0,0,0,.17.75L159,14l-15.16,8.83L107.6.08a.55.55,0,0,0-.75.17A.55.55,0,0,0,107,1l1.11.7,1,.65,14.91,9.33L85.86,34a.85.85,0,0,0-.41.66c0,.36.47.66.47.66l15.78,9.88a.6.6,0,0,0,.28.08.54.54,0,0,0,.46-.25.54.54,0,0,0-.17-.75L86.9,34.6l19.7-11.48,18.88,11.29a.54.54,0,0,0,.28.08.54.54,0,0,0,.27-.07L160,14.6l12.44,7.79a.51.51,0,0,0,.29.08.54.54,0,0,0,.29-1Zm-47.3,11.85L107.67,22.5l17.45-10.17L142.78,23.4Z"
      />
      <path
        fill="currentColor"
        d="M87.5,33.62a.56.56,0,0,0-.75-.19L68.27,44.21a.54.54,0,0,0,.27,1,.53.53,0,0,0,.27-.08L87.3,34.37A.56.56,0,0,0,87.5,33.62Z"
      />
      <path
        fill="currentColor"
        d="M249.39,21.47,215.24.08a.54.54,0,0,0-.58.92l20.67,13-15.15,8.83L183.94.08a.54.54,0,0,0-.58.92l1.11.7,1,.65,14.9,9.33L162.2,34a.88.88,0,0,0-.42.66c0,.36.47.66.47.66L178,45.15a.6.6,0,0,0,.29.08.54.54,0,0,0,.29-1L163.24,34.6l19.69-11.48,18.88,11.29a.6.6,0,0,0,.28.08.5.5,0,0,0,.27-.07l34-19.82,12.45,7.79a.51.51,0,0,0,.29.08.56.56,0,0,0,.46-.25A.55.55,0,0,0,249.39,21.47ZM202.1,33.32,184,22.5l17.45-10.17L219.12,23.4Z"
      />
      <path
        fill="currentColor"
        d="M249.57,28.15a.54.54,0,0,0-.74-.2L220.94,44.21a.54.54,0,0,0,.27,1,.53.53,0,0,0,.27-.08l27.9-16.25A.54.54,0,0,0,249.57,28.15Z"
      />
      <path
        fill="currentColor"
        d="M163.89,33.59a.54.54,0,0,0-.74-.2L144.59,44.21a.54.54,0,0,0,.55.94L163.7,34.33A.54.54,0,0,0,163.89,33.59Z"
      />
    </svg>
  );
}

function TileBgMedium({ active }) {
  return <TileBgEasy active={active} />;
}
function TileBgHard({ active }) {
  return <TileBgEasy active={active} />;
}

function TileBg({ diff, active }) {
  if (diff === "medium") return <TileBgMedium active={active} />;
  if (diff === "hard") return <TileBgHard active={active} />;
  return <TileBgEasy active={active} />;
}

function Tower({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    {
      winFinal: winFinalMp3,
      win: winMp3,
      selected: selectedMp3,
      loseDragon: loseDragonMp3,
      loseFire: loseFireMp3,
      egg: eggMp3,
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

  const [difficulty, setDifficulty] = useState("easy");
  const [hasPlayedThisSession, setHasPlayedThisSession] = useState(false);
  const [lockedDifficulty, setLockedDifficulty] = useState("easy");

  const [roundId, setRoundId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [columns, setColumns] = useState(columnsByDifficulty("easy"));

  const [currentRow, setCurrentRow] = useState(0);
  const [winStage, setWinStage] = useState("loop");
  const [revealed, setRevealed] = useState([]);
  const [currentMultiplier, setCurrentMultiplier] = useState(1);

  const [lossSafeMap, setLossSafeMap] = useState(null);
  const [lostPick, setLostPick] = useState(null);
  const [loseStage, setLoseStage] = useState("loop");

  const [lastPick, setLastPick] = useState(null); // { row, col }

  // ✅ Win popup
  const [lastCashoutPayout, setLastCashoutPayout] = useState(null);

  const inGame = status === "in_progress" && !!roundId;

  const effectiveColumns = useMemo(() => {
    if (inGame) return columns;
    if (!hasPlayedThisSession) return columnsByDifficulty(difficulty);
    return columnsByDifficulty(lockedDifficulty);
  }, [inGame, columns, hasPlayedThisSession, difficulty, lockedDifficulty]);

  const diffForSymbols = useMemo(() => {
    if (!hasPlayedThisSession) return difficulty;
    return lockedDifficulty;
  }, [hasPlayedThisSession, difficulty, lockedDifficulty]);

  const diffForTileBg = diffForSymbols;

  const bet = useMemo(() => parseFloat(betAmount) || 0, [betAmount]);
  const profit = useMemo(() => bet * Number(currentMultiplier || 0) - bet, [bet, currentMultiplier]);

  const canCashout = useMemo(() => {
    if (!inGame) return false;
    const safeCount = revealed.filter((r) => r.safe).length;
    return safeCount >= 1;
  }, [inGame, revealed]);

  const uiPhase = useMemo(() => {
    if (status === "lost") return "lose";
    if (status === "cashed_out") return "win";
    return "default";
  }, [status]);

  const castleTopAsset = useMemo(() => {
    if (uiPhase === "win") return castleTopWin;
    return castleTopDefault;
  }, [uiPhase]);

  /* ===== Fit-scale the castle+board unit to the stage =====
     Same pattern as the Russian Roulette scene: the unit has a fixed
     design size and is uniformly scaled to the available space, so the
     full board + castle + dragon always fits (no clipped bottom rows,
     no scrolling) at any window or phone size. */
  const [towerScale, setTowerScale] = useState(1);
  /* Design-space height of the proportional background (unit + dragon +
     bleed) — consumed by tower.module.css so the background is scaled by
     the SAME --tower-scale as the castle+board unit (never independently). */
  const [towerBgH, setTowerBgH] = useState(900);
  const boardWrapRef = useRef(null);
  const unitRef = useRef(null);

  const computeTowerScale = useCallback(() => {
    const wrap = boardWrapRef.current;
    const unit = unitRef.current;
    if (!wrap || !unit) return;

    // Dragon art tops follow the CSS breakpoints (tower.module.css):
    // -200px desktop, -150px ≤900px, -105px ≤420px. Reserving the REAL
    // offset (instead of always 200px) lets the board grow much larger
    // on phones while still fitting castle + board + dragon fully.
    const isSmall = window.matchMedia("(max-width: 420px)").matches;
    const isStacked = window.matchMedia("(max-width: 900px)").matches;
    const dragonOffset = isSmall ? 190 : isStacked ? 190 : TOWER_DRAGON_TOP_OFFSET;

    // Breathing room: 24px on PC (headroom for the CSS 4% board boost,
    // which grows the board downward from its anchored top edge),
    // 12px on stacked/mobile layouts (no boost there).
    const margin = isStacked ? 12 : 24;
    const availW = wrap.clientWidth - margin;
    const availH = wrap.clientHeight - margin;
    const intrinsicH = unit.offsetHeight + dragonOffset;
    const s = Math.min(availW / TOWER_UNIT_W, availH / intrinsicH, 1);
    setTowerScale(Math.max(0.3, s));
    setTowerBgH(Math.round(intrinsicH + 48)); /* +24px bleed top/bottom */
  }, []);

  useEffect(() => {
    computeTowerScale();
    window.addEventListener("resize", computeTowerScale);
    return () => window.removeEventListener("resize", computeTowerScale);
  }, [computeTowerScale, rows, effectiveColumns, castleTopAsset]);

  const headAnim =
    status === "lost"
      ? loseStage === "start"
        ? TOWER_ATLAS_ANIMS.dragonHeadLoseStart
        : TOWER_ATLAS_ANIMS.dragonHeadLoseLoop
      : status === "cashed_out"
        ? winStage === "start"
          ? TOWER_ATLAS_ANIMS.dragonHeadWinStart
          : TOWER_ATLAS_ANIMS.dragonHeadWinLoop
        : TOWER_ATLAS_ANIMS.dragonHeadIdle;

  const wingsAnim =
    status === "lost"
      ? loseStage === "start"
        ? TOWER_ATLAS_ANIMS.dragonWingsLoseOpen
        : TOWER_ATLAS_ANIMS.dragonWingsLoseLoop
      : status === "cashed_out"
        ? winStage === "start"
          ? TOWER_ATLAS_ANIMS.dragonWingsWinOpen
          : TOWER_ATLAS_ANIMS.dragonWingsWinLoop
        : TOWER_ATLAS_ANIMS.dragonWingsIdle;

  const eggAnim =
    diffForSymbols === "easy"
      ? SYMBOLS_ATLAS_ANIMS.eggEasy
      : diffForSymbols === "medium"
        ? SYMBOLS_ATLAS_ANIMS.eggMedium
        : SYMBOLS_ATLAS_ANIMS.eggHard;

  const skullAnim =
    diffForSymbols === "easy"
      ? SYMBOLS_ATLAS_ANIMS.skullEasy
      : diffForSymbols === "medium"
        ? SYMBOLS_ATLAS_ANIMS.skullMedium
        : SYMBOLS_ATLAS_ANIMS.skullHard;

  const fireAnim =
    diffForSymbols === "easy"
      ? SYMBOLS_ATLAS_ANIMS.fireReveal1
      : diffForSymbols === "medium"
        ? SYMBOLS_ATLAS_ANIMS.fireReveal3
        : SYMBOLS_ATLAS_ANIMS.fireReveal5;

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * factor).toFixed(2));
  };

  // Track previous revealed to play Egg only for newly added safe reveal
  const prevRevealedRef = useRef(revealed);
  useEffect(() => {
    const prev = prevRevealedRef.current || [];
    const curr = revealed || [];

    const prevKey = new Set(prev.map((r) => `${r.row}-${r.tileIndex}`));
    const newlyAdded = curr.filter((r) => !prevKey.has(`${r.row}-${r.tileIndex}`));

    if (newlyAdded.some((r) => r.safe)) {
      sfx.play("egg", { volume: 0.85 });
    }

    prevRevealedRef.current = curr;
  }, [revealed, sfx]);

  // Lose sounds on loseStage start
  const prevLoseStageRef = useRef(loseStage);
  useEffect(() => {
    const prev = prevLoseStageRef.current;
    if (status === "lost" && prev !== "start" && loseStage === "start") {
      sfx.play("loseDragon", { volume: 0.9 });
      sfx.play("loseFire", { volume: 0.9 });
    }
    prevLoseStageRef.current = loseStage;
  }, [loseStage, status, sfx]);

  const start = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }
    if (!DIFFS.includes(difficulty)) return toast.error("Invalid difficulty");

    setLoseStage("loop");

    try {
      const res = await gamesAPI.towerStart({ betAmount: amount, difficulty });
      const gs = res.data.gameState;

      setHasPlayedThisSession(true);

      setLockedDifficulty(gs.difficulty ?? difficulty);
      setColumns(gs.columns ?? columnsByDifficulty(gs.difficulty ?? difficulty));

      setRoundId(gs.roundId);
      setStatus("in_progress");
      setRows(gs.rows ?? DEFAULT_ROWS);
      setCurrentRow(gs.currentRow ?? 0);
      setRevealed(gs.revealed || []);
      setCurrentMultiplier(gs.currentMultiplier || 1);

      setLoseStage("loop");
      setWinStage("loop");
      setLossSafeMap(null);
      setLostPick(null);

      setLastPick(null);
      setLastCashoutPayout(null);

      if (typeof gs.balanceAfterBet === "number") updateBalance(gs.balanceAfterBet);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to start");
    }
  };

  const pick = async (tileIndex) => {
    if (!inGame) return;
    if (revealed.some((r) => r.row === currentRow)) return;

    // ✅ selection sound immediately
    sfx.play("selected", { volume: 0.75 });

    try {
      const res = await gamesAPI.towerPick({ roundId, tileIndex });
      const gs = res.data.gameState;
      const result = res.data.result;

      if (result && typeof result.row === "number" && typeof result.tileIndex === "number") {
        setLastPick({ row: result.row, col: result.tileIndex });
      }

      setStatus(gs.status || "in_progress");
      setCurrentRow(gs.currentRow ?? currentRow);
      setRevealed(gs.revealed || []);
      setCurrentMultiplier(gs.currentMultiplier || 1);

      if (result?.status === "lost") {
        const sm = result?.reveal?.safeMap;
        setLoseStage("start");
        if (Array.isArray(sm)) setLossSafeMap(sm);
        setLostPick({ row: result.row, tileIndex: result.tileIndex });
      } else if (result?.status === "cashed_out") {
        const payout = Number(result.payout || 0);
        setLastCashoutPayout(payout);

        const nextRow = gs.currentRow ?? currentRow;
        const totalRows = gs.rows ?? rows;
        const isFinal = nextRow >= totalRows;
        sfx.play(isFinal ? "winFinal" : "win", { volume: 0.9 });

        if (typeof result.balance === "number") updateBalance(result.balance);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || "Pick failed");
    }
  };

  const cashout = async () => {
    if (!inGame) return;
    if (!canCashout) return;

    try {
      const res = await gamesAPI.towerCashout({ roundId });
      const gs = res.data.gameState;
      const result = res.data.result;

      const payout = Number(result.payout || 0);

      setStatus(gs.status || "cashed_out");
      setCurrentRow(gs.currentRow ?? currentRow);
      setRevealed(gs.revealed || []);
      setCurrentMultiplier(gs.currentMultiplier || currentMultiplier);

      setWinStage("start");
      setLoseStage("loop");

      setLastCashoutPayout(payout);

      const nextRow = gs.currentRow ?? currentRow;
      const totalRows = gs.rows ?? rows;
      const isFinal = nextRow >= totalRows;
      sfx.play(isFinal ? "winFinal" : "win", { volume: 0.9 });

      if (typeof result.balance === "number") updateBalance(result.balance);
    } catch (e) {
      toast.error(e.response?.data?.message || "Cashout failed");
    }
  };

  const visualRowFromGameRow = (gameRow) => rows - 1 - gameRow;
  const isRowLocked = (row) => revealed.some((r) => r.row === row);
  const isActiveRow = (row) => inGame && row === currentRow;

  const isChosenSafe = (row, col) =>
    revealed.some((r) => r.safe && r.row === row && r.tileIndex === col);

  const isEggRevealed = (row, col) => {
    const pickEntry = revealed.find((r) => r.row === row && r.tileIndex === col);
    if (pickEntry?.safe) return true;

    if (status === "lost" && Array.isArray(lossSafeMap)) {
      const rowSafes = lossSafeMap[row];
      return Array.isArray(rowSafes) && rowSafes.includes(col);
    }
    return false;
  };

  const isSkull = (row, col) =>
    status === "lost" && lostPick && lostPick.row === row && lostPick.tileIndex === col;

  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("tower", inGame);

  return (
    <div className={styles.container} data-phase={uiPhase}>
      <div className={styles.sidebar}>
        <div className={styles.controlsHeader}>
          <div className={styles.modeToggle}>
            <button className={`${styles.modeBtn} ${styles.active}`} type="button">
              Manual
            </button>
            <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} type="button" disabled>
              Auto
            </button>
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
                disabled={inGame}
              />
              <CurrencyIcon className={styles.btcIcon} />
            </div>

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || inGame} type="button">
                ½
              </button>
              <div className={styles.divider} />
              <button onClick={() => adjustBet(2)} disabled={isLocked || inGame} type="button">
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Difficulty</span>
          </div>

          <select
            className={styles.select}
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            disabled={inGame}
          >
            <option value="easy">Easy (4 tiles)</option>
            <option value="medium">Medium (3 tiles)</option>
            <option value="hard">Hard (2 tiles)</option>
          </select>
        </div>

        {!inGame ? (
          <span className="ui-bet-wrap">
            <button
              className={styles.betButton}
              onClick={start}
              type="button"
              data-bet-sound="true"
              disabled={isLocked} title={isLocked ? betErrorMessage : undefined}>
            Bet
            </button>
            <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
          </span>
        ) : (
          <button
            className={styles.betButton}
            onClick={cashout}
            disabled={isLocked || !canCashout}
            type="button"
           title={isLocked ? betErrorMessage : undefined}>
            Cashout
          </button>
        )}

        <div className={styles.controlGroup} style={{ marginTop: "0" }}>
          <div className={styles.labelRow}>
            <span>Total Profit ({Number(currentMultiplier || 0).toFixed(2)}×)</span>
            <span>$0.00</span>
          </div>

          <div className={`${styles.readonlyInput} ${styles.profitInput}`}>
            <input type="text" value={format8(profit)} readOnly />
            <CurrencyIcon className={styles.btcIcon} />
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Win popup — direct child of the stage (boardWrap has
            overflow:hidden and would clip it), always dead-centred
            as a true overlay. */}
        {status === "cashed_out" && lastCashoutPayout != null && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupMult}>{Number(currentMultiplier || 0).toFixed(2)}×</div>
            <div className={styles.winPopupDivider} aria-hidden="true" />
            <div className={styles.winPopupAmount}>{format8(lastCashoutPayout)}<CurrencyIcon /></div>
          </div>
        )}

        <div
          className={styles.boardWrap}
          ref={boardWrapRef}
          style={{ "--tower-scale": towerScale, "--tower-bg-h": `${towerBgH}px` }}
        >
          <img className={styles.boardBg} src={boardBg} alt="" aria-hidden="true" />

          <div
            className={styles.castleAndBoard}
            ref={unitRef}
            style={{ "--tower-scale": towerScale }}
          >
            <div className={styles.dragonWingsBehindEverything} aria-hidden="true">
              <DragonCompositePlayer
                src={bigDragonPng}
                atlasFrames={bigDragonAtlas}
                wingsAnim={wingsAnim}
                mode="wings"
                forcedBox={{ w: 1600, h: 720 }}
                scale={0.65}
                smoothing={true}
                dprCap={1}
                blend={0.65}
                onDone={
                  status === "lost" && loseStage === "start"
                    ? () => setLoseStage("loop")
                    : status === "cashed_out" && winStage === "start"
                      ? () => setWinStage("loop")
                      : null
                }
                className={styles.dragonWingsCanvas}
              />
            </div>

            <div className={styles.castleTopLayer}>
              <img
                className={styles.castleTop}
                src={castleTopAsset}
                alt=""
                aria-hidden="true"
                onLoad={computeTowerScale}
              />
            </div>

            <div className={styles.dragonHeadInFrontOfCastle} aria-hidden="true">
              <DragonCompositePlayer
                src={bigDragonPng}
                atlasFrames={bigDragonAtlas}
                headAnim={headAnim}
                mode="head"
                forcedBox={{ w: 1600, h: 720 }}
                scale={0.65}
                smoothing={true}
                dprCap={1}
                blend={0.65}
                onDone={
                  status === "lost" && loseStage === "start"
                    ? () => setLoseStage("loop")
                    : status === "cashed_out" && winStage === "start"
                      ? () => setWinStage("loop")
                      : null
                }
                className={styles.dragonHeadCanvasOnly}
              />
            </div>

            <div
              className={styles.board}
              style={{
                gridTemplateColumns: `repeat(${effectiveColumns}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
              }}
            >
              {Array.from({ length: rows }).map((_, gameRow) =>
                Array.from({ length: effectiveColumns }).map((__, col) => {
                  const vRow = visualRowFromGameRow(gameRow);
                  const active = isActiveRow(gameRow);

                  const disabled =
                    !inGame || !active || isRowLocked(gameRow) || status !== "in_progress";

                  const egg = isEggRevealed(gameRow, col);
                  const skull = isSkull(gameRow, col);

                  const picked = !!(lastPick && lastPick.row === gameRow && lastPick.col === col);
                  const chosenSafe = isChosenSafe(gameRow, col);

                  return (
                    <button
                      key={`${gameRow}-${col}`}
                      className={[
                        styles.tile,
                        active ? styles.tileActiveRow : "",
                        chosenSafe ? styles.tileChosen : "",
                        picked ? styles.tilePicked : "",
                        skull ? styles.tileFire : "",
                      ].join(" ")}
                      style={{ gridRow: vRow + 1, gridColumn: col + 1 }}
                      disabled={disabled}
                      onClick={() => pick(col)}
                      type="button"
                    >
                      <span className={styles.tileClip} aria-hidden="true">
                        <TileBg diff={diffForTileBg} active={active} />
                        <span className={styles.tileEngrave} />
                      </span>

                      {egg && (
                        <AtlasPlayer
                          src={symbolsPng}
                          atlasFrames={symbolsAtlas}
                          anim={eggAnim}
                          forcedBox={{ w: 256, h: 256 }}
                          scale={0.22}
                          smoothing={true}
                          dprCap={1}
                          className={`${styles.symbolCanvas} ${styles.eggCanvas}`}
                        />
                      )}

                      {skull && (
                        <>
                          <AtlasPlayer
                            src={symbolsPng}
                            atlasFrames={symbolsAtlas}
                            anim={skullAnim}
                            forcedBox={{ w: 256, h: 256 }}
                            scale={0.24}
                            smoothing={true}
                            dprCap={1}
                            className={`${styles.symbolCanvas} ${styles.skullCanvas}`}
                          />

                          {loseStage === "start" && (
                            <AtlasPlayer
                              src={symbolsPng}
                              atlasFrames={symbolsAtlas}
                              anim={fireAnim}
                              forcedBox={{ w: 512, h: 512 }}
                              scale={0.32}
                              smoothing={true}
                              dprCap={1}
                              className={`${styles.symbolCanvas} ${styles.fireCanvas}`}
                              onDone={() => setLoseStage("loop")}
                            />
                          )}
                        </>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Tower;