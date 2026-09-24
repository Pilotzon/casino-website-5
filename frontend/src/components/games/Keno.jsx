import { useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./keno.module.css";
import Modal from "../common/Modal";

import useGameAudio from "../../hooks/useGameAudio";

import gemSvg from "../../assets/keno/gem.svg";
import kenoGemMp3 from "../../assets/keno/gem.mp3";
import kenoTileMp3 from "../../assets/keno/tile.mp3";
import kenoTileSelectMp3 from "../../assets/keno/tileselect.mp3";

const NUMBERS = Array.from({ length: 40 }, (_, i) => i + 1);

const MAX_PICKS = 10;
const DRAW_COUNT = 10;
const N = 40;

const format8 = (n) => Number(n || 0).toFixed(2); // 2 decimals everywhere

// --- payout table (must match backend) ---
const KENO_PAYOUTS = {
  low: {
    1: { 0: 0, 1: 3.96 },
    2: { 0: 0, 1: 1.10, 2: 5.50 },
    3: { 0: 0, 1: 0, 2: 2.20, 3: 12.00 },
    4: { 0: 0, 1: 0, 2: 1.30, 3: 4.00, 4: 50.00 },
    5: { 0: 0, 1: 0, 2: 1.10, 3: 2.00, 4: 15.00, 5: 250.00 },
    6: { 0: 0, 1: 0, 2: 0, 3: 1.60, 4: 3.50, 5: 30.00, 6: 500.00 },
    7: { 0: 0, 1: 0, 2: 0, 3: 1.20, 4: 2.00, 5: 8.00, 6: 100.00, 7: 1000.00 },
    8: { 0: 0, 1: 0, 2: 0, 3: 1.10, 4: 1.60, 5: 3.50, 6: 20.00, 7: 200.00, 8: 2000.00 },
    9: { 0: 0, 1: 0, 2: 0, 3: 1.10, 4: 1.40, 5: 2.20, 6: 6.00, 7: 50.00, 8: 500.00, 9: 5000.00 },
    10: { 0: 0, 1: 0, 2: 0, 3: 1.05, 4: 1.25, 5: 1.70, 6: 3.50, 7: 15.00, 8: 100.00, 9: 1000.00, 10: 10000.00 },
  },

  medium: {
    1: { 0: 0, 1: 3.80 },
    2: { 0: 0, 1: 1.00, 2: 5.00 },
    3: { 0: 0, 1: 0, 2: 2.00, 3: 11.00 },
    4: { 0: 0, 1: 0, 2: 1.20, 3: 3.80, 4: 45.00 },
    5: { 0: 0, 1: 0, 2: 1.05, 3: 1.90, 4: 14.00, 5: 220.00 },
    6: { 0: 0, 1: 0, 2: 0, 3: 1.55, 4: 3.20, 5: 28.00, 6: 600.00 },
    7: { 0: 0, 1: 0, 2: 0, 3: 1.15, 4: 1.95, 5: 7.50, 6: 90.00, 7: 1500.00 },
    8: { 0: 0, 1: 0, 2: 0, 3: 1.08, 4: 1.50, 5: 3.20, 6: 18.00, 7: 180.00, 8: 3000.00 },
    9: { 0: 0, 1: 0, 2: 0, 3: 1.05, 4: 1.30, 5: 2.00, 6: 5.50, 7: 45.00, 8: 600.00, 9: 8000.00 },
    10: { 0: 0, 1: 0, 2: 0, 3: 1.00, 4: 1.20, 5: 1.65, 6: 3.20, 7: 13.00, 8: 90.00, 9: 1500.00, 10: 20000.00 },
  },

  high: {
    1: { 0: 0, 1: 3.50 },
    2: { 0: 0, 1: 0, 2: 6.00 },
    3: { 0: 0, 1: 0, 2: 0, 3: 25.00 },
    4: { 0: 0, 1: 0, 2: 0, 3: 5.00, 4: 100.00 },
    5: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 20.00, 5: 500.00 },
    6: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 5.00, 5: 50.00, 6: 1000.00 },
    7: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 2.00, 5: 10.00, 6: 200.00, 7: 2000.00 },
    8: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1.50, 5: 5.00, 6: 50.00, 7: 500.00, 8: 5000.00 },
    9: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1.20, 5: 3.00, 6: 20.00, 7: 200.00, 8: 1000.00, 9: 10000.00 },
    10: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1.00, 5: 2.00, 6: 10.00, 7: 100.00, 8: 500.00, 9: 2000.00, 10: 100000.00 },
  },
};


function getMult(diff, picks, hits) {
  const d = KENO_PAYOUTS[String(diff || "medium").toLowerCase()] || KENO_PAYOUTS.medium;
  return Number(d?.[picks]?.[hits] || 0);
}

// probability helpers
function logGamma(z) {
  const p = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}
function hypergeomP(NN, K, n, k) {
  const lp = logChoose(K, k) + logChoose(NN - K, n - k) - logChoose(NN, n);
  return Math.exp(lp);
}

function isMobileNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
}

// Fisher-Yates shuffle (crypto not needed for UI animation)
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Keno({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    { gem: kenoGemMp3, tile: kenoTileMp3, tileselect: kenoTileSelectMp3 },
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
  const [difficulty, setDifficulty] = useState("medium");

  const [selected, setSelected] = useState([]);
  const [isBusy, setIsBusy] = useState(false);

  // reveal animation state
  const [drawn, setDrawn] = useState([]);
  const [hits, setHits] = useState([]);

  const [lastPayout, setLastPayout] = useState(0);

  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winAmount, setWinAmount] = useState(0);

  // desktop hover
  const [hoverHit, setHoverHit] = useState(null);
  const [hoverCellIndex, setHoverCellIndex] = useState(null);

  // mobile modal
  const [rowModalOpen, setRowModalOpen] = useState(false);
  const [rowModalHits, setRowModalHits] = useState(null);

  const animRef = useRef(0);

  const bet = useMemo(() => parseFloat(betAmount) || 0, [betAmount]);
  const picksCount = selected.length;
  const picksLocked = picksCount >= MAX_PICKS;

  const isMobile = isMobileNow();
  const desktopHoverActive = !isMobile && hoverHit != null && picksCount > 0 && hoverCellIndex != null;

  const visibleHits = useMemo(() => {
    if (picksCount <= 0) return [];
    return Array.from({ length: picksCount + 1 }, (_, i) => i);
  }, [picksCount]);

  const topMultipliers = useMemo(() => {
    if (picksCount <= 0) return [];
    return Array.from({ length: picksCount + 1 }, (_, h) => {
      const m = getMult(difficulty, picksCount, h);
      return { hits: h, mult: m, text: `${m.toFixed(2)}×` };
    });
  }, [difficulty, picksCount]);

  const hoverInfo = useMemo(() => {
    if (!desktopHoverActive) return null;
    const mult = getMult(difficulty, picksCount, hoverHit);
    const payout = bet * mult;
    const profit = payout - bet;
    const chance = hypergeomP(N, DRAW_COUNT, picksCount, hoverHit) * 100;
    return { hits: hoverHit, multiplier: mult, payout, profit, chance };
  }, [desktopHoverActive, difficulty, picksCount, hoverHit, bet]);

  const arrowLeftPercent = useMemo(() => {
    if (!desktopHoverActive) return 50;
    const cols = picksCount + 1;
    const idx = Math.max(0, Math.min(cols - 1, hoverCellIndex));
    return ((idx + 0.5) / cols) * 100;
  }, [desktopHoverActive, hoverCellIndex, picksCount]);

  const rowModalInfo = useMemo(() => {
    const h = Number(rowModalHits);
    if (!Number.isInteger(h) || picksCount <= 0) return null;
    const mult = getMult(difficulty, picksCount, h);
    const payout = bet * mult;
    const profit = payout - bet;
    const chance = hypergeomP(N, DRAW_COUNT, picksCount, h) * 100;
    return { hits: h, mult, payout, profit, chance };
  }, [rowModalHits, picksCount, difficulty, bet]);

  useEffect(() => {
    const onResize = () => setRowModalOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * factor).toFixed(2));
  };

  const softResetResults = () => {
    setDrawn([]);
    setHits([]);
    setLastPayout(0);

    setShowWinPopup(false);
    setWinAmount(0);

    setHoverHit(null);
    setHoverCellIndex(null);

    setRowModalOpen(false);
    setRowModalHits(null);
  };

  const togglePick = (n) => {
    if (isBusy) return;
    if (drawn.length > 0) softResetResults();

    sfx.play("tileselect", { volume: 1 });

    setSelected((prev) => {
      const has = prev.includes(n);
      if (has) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const randomPickOne = async () => {
    if (isBusy) return;
    if (picksLocked) return;

    setIsBusy(true);
    const my = ++animRef.current;

    try {
      if (drawn.length > 0) softResetResults();

      const available = NUMBERS.filter((n) => !selected.includes(n));
      if (!available.length) return;

      const pick = available[Math.floor(Math.random() * available.length)];

      // play tile sound for selection by random pick too (optional)
      sfx.play("tile", { volume: 1 });

      setSelected((prev) => {
        if (prev.includes(pick)) return prev;
        if (prev.length >= MAX_PICKS) return prev;
        return [...prev, pick].sort((a, b) => a - b);
      });
    } finally {
      if (animRef.current === my) setIsBusy(false);
    }
  };

  const clearTable = async () => {
    if (isBusy) return;
    setIsBusy(true);
    const my = ++animRef.current;

    try {
      setSelected([]);
      softResetResults();
    } finally {
      if (animRef.current === my) setIsBusy(false);
    }
  };

  const play = async () => {
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (isBusy) return;

    if (!Number.isFinite(bet) || bet <= 0) { setBetError("Invalid bet amount"); return; }
    if (bet > user.balance) { setBetError("Insufficient balance"); return; }
    if (selected.length < 1) return toast.error("Select at least 1 number");

    setIsBusy(true);
    const my = ++animRef.current;

    try {
      const res = await gamesAPI.playKeno({
        betAmount: bet,
        selectedNumbers: selected,
        difficulty,
      });

      const r = res.data?.result;
      if (!r) throw new Error("Bad response");

      // reset board
      softResetResults();

      const d = Array.isArray(r.drawn) ? r.drawn : [];
      const hn = Array.isArray(r.hitNumbers) ? r.hitNumbers : [];

      // set hits now, but gems only appear when their drawn tile is revealed
      setHits(hn);

      // randomize reveal order to feel like random picking
      const revealOrder = shuffle(d);

      // slower reveal
      const stepMs = 170; // tune speed here (higher = slower)

      for (let i = 0; i < revealOrder.length; i++) {
        if (animRef.current !== my) return;

        const n = revealOrder[i];

        // reveal tile
        setDrawn((prev) => (prev.includes(n) ? prev : [...prev, n]));

        // tile sound always
        sfx.play("tile", { volume: 1 });

        // if this revealed tile is a winning gem (picked + hit), play gem sound
        if (selected.includes(n) && hn.includes(n)) {
          sfx.play("gem", { volume: 1 });
        }

        await new Promise((rr) => setTimeout(rr, stepMs));
      }

      const payout = Number(r.payout || 0);
      setLastPayout(payout);

      if (payout > 0) {
        setWinAmount(payout);
        setShowWinPopup(true);
        setTimeout(() => {
          if (animRef.current === my) setShowWinPopup(false);
        }, 1400);
      }

      if (typeof r.balance === "number") updateBalance(r.balance);
    } catch (e) {
      toast.error(e.response?.data?.message || "Keno failed");
    } finally {
      if (animRef.current === my) setIsBusy(false);
    }
  };

  const tileState = (n) => {
    const picked = selected.includes(n);
    const wasDrawn = drawn.includes(n);
    const isHit = hits.includes(n);

    if (picked && isHit && wasDrawn) return "pickedHit";
    if (picked) return "picked";
    if (wasDrawn && !picked) return "drawnMissed";
    return "normal";
  };

  const tileClass = (n) => {
    const st = tileState(n);
    const picked = selected.includes(n);
    const dim = picksLocked && !picked;

    return [
      styles.tile,
      st === "picked" ? styles.tilePicked : "",
      st === "pickedHit" ? styles.tilePickedHit : "",
      st === "drawnMissed" ? styles.tilePressedRed : "",
      dim ? styles.tileDimmed : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  const onHitCellEnter = (h, idx) => {
    if (isMobile) return;
    setHoverHit(h);
    setHoverCellIndex(idx);
  };
  const onHitCellLeave = () => {
    if (isMobile) return;
    setHoverHit(null);
    setHoverCellIndex(null);
  };

  const openRowModal = (h) => {
    if (!isMobile) return;
    setRowModalHits(h);
    setRowModalOpen(true);
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("keno", isBusy);


  // Always reserve space for the payout rows (min 1 column) so nothing
  // jumps when the first number is picked — the rows are just hidden
  // until there is something to show.
  const cols = Math.max(1, picksCount + 1);
  // Both bottom rows get this EXACT same width: max(100%, all columns at
  // their 56px mobile floor). Identical formula -> identical pixel width,
  // so the Multiplier Row and Chosen-Tiles Row always line up 1:1.
  const rowsWidth = `max(100%, calc(${cols} * 56px + ${Math.max(cols - 1, 0) * 16}px))`;

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
                disabled={isBusy}
              />
            </div>

            <div className={styles.coinChip}>
              <span className={styles.btcIcon}>$</span>
            </div>

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isBusy}>½</button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isBusy}>2×</button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Difficulty</span>
          </div>
          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select
              className={styles.select}
              value={difficulty}
              onChange={(e) => {
                setDifficulty(e.target.value);
                if (drawn.length > 0) softResetResults();
              }}
              disabled={isBusy}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <button className={styles.secondaryButton} onClick={randomPickOne} disabled={isBusy || picksLocked}>
          Random Pick
        </button>
        <button className={styles.secondaryButton} onClick={clearTable} disabled={isBusy}>
          Clear Table
        </button>

        <button className={styles.bigButton} onClick={play} disabled={isLocked || isBusy || selected.length < 1} type="button" data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          Bet
        </button>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Win popup — direct child of the stage so it is always dead
            centred over the board as a true overlay (no layout shift). */}
        {showWinPopup && winAmount > 0 && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupTitle}>YOU WON</div>
            <div className={styles.winPopupAmount}>{format8(winAmount)} $</div>
          </div>
        )}

        <div className={styles.boardWrap}>
          <Modal
            isOpen={rowModalOpen && !!rowModalInfo}
            onClose={() => setRowModalOpen(false)}
            title="Hits"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
              </svg>
            }
            description="Payout for this number of hits."
          >
            {rowModalInfo && (
              <>
                <div className={styles.modalNumber}>{rowModalInfo.hits}×</div>
                <div className={styles.modalGrid}>
                  <div className={styles.modalItem}>
                    <div className={styles.modalItemLabel}>Payout</div>
                    <div className={styles.modalItemValue}>{rowModalInfo.mult.toFixed(2)}×</div>
                  </div>

                  <div className={styles.modalItem}>
                    <div className={styles.modalItemLabel}>Profit on Win</div>
                    <div className={styles.modalItemValue}>
                      {format8(rowModalInfo.profit)}
                      <span className={styles.modalGem}><img src={gemSvg} alt="" /></span>
                    </div>
                  </div>

                  <div className={styles.modalItem}>
                    <div className={styles.modalItemLabel}>Chance</div>
                    <div className={styles.modalItemValue}>{rowModalInfo.chance.toFixed(9)}</div>
                  </div>
                </div>

                <button className={styles.modalBtnPrimary} onClick={() => setRowModalOpen(false)} type="button">
                  Close
                </button>
              </>
            )}
          </Modal>

          <div className={styles.gridWrap}>
            <div className={styles.grid}>
              {NUMBERS.map((n) => {
                const st = tileState(n);
                const dim = picksLocked && !selected.includes(n);

                return (
                  <button
                    key={n}
                    type="button"
                    className={tileClass(n)}
                    onClick={() => togglePick(n)}
                    disabled={isBusy || dim}
                  >
                    <span className={`${styles.tileNumber} ${st === "pickedHit" ? styles.numOut : ""}`}>
                      {n}
                    </span>

                    {st === "pickedHit" && (
                      <span className={styles.gemBadge}>
                        <img src={gemSvg} alt="" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Multiplier Row — invisible with reserved space at 0 picks.
              Chosen-Tiles Row — always visible; carries the hint message
              when nothing is picked. No layout shift in either direction. */}
          <div className={styles.rowsWrap}>
              <>
                  {!isMobile && (
                    <div className={`${styles.hoverPanel} ${desktopHoverActive ? styles.hoverPanelVisible : ""}`}>
                      <div className={styles.hoverBoxes}>
                        <div className={styles.hoverBox}>
                          <div className={styles.hoverLabel}>Payout</div>
                          <div className={styles.hoverField}>
                            <input
                              className={styles.hoverInput}
                              type="text"
                              readOnly
                              value={(hoverInfo ? hoverInfo.multiplier : 0).toFixed(2)}
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
                              value={format8(hoverInfo ? hoverInfo.profit : 0)}
                            />
                            <span className={styles.hoverSuffixGem}>
                              <img src={gemSvg} alt="" />
                            </span>
                          </div>
                        </div>
                        <div className={styles.hoverBox}>
                          <div className={styles.hoverLabel}>Chance</div>
                          <div className={styles.hoverField}>
                            <input
                              className={styles.hoverInput}
                              type="text"
                              readOnly
                              value={hoverInfo ? hoverInfo.chance.toFixed(9) : "0.000000000"}
                            />
                            <span className={styles.hoverSuffix}>%</span>
                          </div>
                        </div>
                      </div>
                      <div className={styles.hoverArrow} style={{ left: `${arrowLeftPercent}%` }} aria-hidden="true" />
                    </div>
                  )}

                  {/* ONE scroll container carries BOTH bottom rows: a single
                      scrollbar moves them together, so their positions can
                      never drift apart. Each row is a plain grid pinned to
                      the exact same width (rowsWidth). */}
                  <div className={styles.rowsScroll}>
                  {/* Multiplier Row — hidden (space reserved) until the
                      first number is picked */}
                  <div
                    className={`${styles.payoutRow} ${picksCount === 0 ? styles.rowsHidden : ""}`}
                    style={{ width: rowsWidth, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                  >
                    {topMultipliers.map((m) => (
                      <button key={m.hits} type="button" className={styles.payoutPillBtn} onClick={() => openRowModal(m.hits)}>
                        {m.text}
                      </button>
                    ))}
                  </div>

                  {/* Chosen-Tiles Row — one big cell; with no picks it
                      shows the hint message in place of the segments */}
                  <div
                    className={styles.hitsRow}
                    style={{ width: rowsWidth, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                  >
                    {picksCount === 0 ? (
                      <div className={styles.hitsEmpty}>Select 1 - 10 numbers to play</div>
                    ) : (
                      visibleHits.map((h, idx) => (
                        <button
                          key={h}
                          type="button"
                          className={styles.hitCellBtn}
                          onMouseEnter={() => onHitCellEnter(h, idx)}
                          onMouseLeave={onHitCellLeave}
                          onClick={() => openRowModal(h)}
                        >
                          <span className={styles.hitLabel}>{h}×</span>
                          <span className={styles.hitDot} />
                        </button>
                      ))
                    )}
                  </div>
                  </div>
                </>
            </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}