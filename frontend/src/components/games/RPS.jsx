import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./RPS.module.css";

import Cardback from "../../assets/rps/Cardback.svg";
import PlayerCardBase from "../../assets/rps/PlayerCardBase.svg";

import HouseRockCard from "../../assets/rps/HouseRockCard.svg";
import HousePaperCard from "../../assets/rps/HousePaperCard.svg";
import HouseScissorsCard from "../../assets/rps/HouseScissorsCard.svg";

import PlayerRockCard from "../../assets/rps/PlayerRockCard.svg";
import PlayerPaperCard from "../../assets/rps/PlayerPaperCard.svg";
import PlayerScissorsCard from "../../assets/rps/PlayerScissorsCard.svg";

import PlayerWinRock from "../../assets/rps/PlayerWinRock.svg";
import PlayerLoseRock from "../../assets/rps/PlayerLoseRock.svg";
import PlayerPaperWin from "../../assets/rps/PlayerPaperWin.svg";
import PlayerPaperLose from "../../assets/rps/PlayerPaperLose.svg";
import PlayerScissorsWin from "../../assets/rps/PlayerScissorsWin.svg";
import PlayerScissorsLose from "../../assets/rps/PlayerScissorsLose.svg";

import RockDrawState from "../../assets/rps/RockDrawState.svg";
import PaperDrawState from "../../assets/rps/PaperDrawState.svg";
import ScissorsDrawState from "../../assets/rps/ScissorsDrawState.svg";

import RockSidebarIcon from "../../assets/rps/RockSidebarIcon.svg";
import PaperSidebarIcon from "../../assets/rps/PaperSidebarIcon.svg";
import ScissorsSidebarIcon from "../../assets/rps/ScissorsSidebarIcon.svg";

// Sound imports
import BetSound from "../../assets/Bet.mp3";
import WinSound from "../../assets/rps/Win.mp3";
import LoseSound from "../../assets/rps/Lose.mp3";
import SlideSound from "../../assets/rps/Slide.wav";
import FlipSound from "../../assets/rps/Flip.mp3";
import ChooseSound from "../../assets/rps/Choose.wav";
import WinMidRoundSound from "../../assets/rps/winMidRound.mp3";
import DrawStateSound from "../../assets/rps/drawState.wav";
import CurrencyIcon from "../common/CurrencyIcon";

const FLIP_MS = 650;
const SLIDE_MS = 380;
const REVEAL_DELAY_MS = 180;
const TOTAL_SLOTS = 60;
const DRAW_RESET_MS = 1200;
const RESULT_OVERLAY_MS = 1800;
const PAD_LEFT = 10;

const format2 = (n) => Number(n || 0).toFixed(2);

// Sound utility function
const playSound = (soundFile) => {
  try {
    const audio = new Audio(soundFile);
    audio.volume = 0.5;
    audio.play().catch(() => { });
  } catch (e) {
    // Silently fail if audio can't play
  }
};

function buildMultipliers(count = 9) {
  const arr = [1.0];
  for (let i = 1; i < count; i++) {
    if (i === 1) arr.push(1.96);
    else arr.push(arr[i - 1] * 2);
  }
  return arr;
}

const CHOICES = [
  {
    value: "rock", label: "Rock", sidebarIcon: RockSidebarIcon,
    playerCard: PlayerRockCard, houseCard: HouseRockCard,
    winState: PlayerWinRock, loseState: PlayerLoseRock, drawState: RockDrawState,
  },
  {
    value: "paper", label: "Paper", sidebarIcon: PaperSidebarIcon,
    playerCard: PlayerPaperCard, houseCard: HousePaperCard,
    winState: PlayerPaperWin, loseState: PlayerPaperLose, drawState: PaperDrawState,
  },
  {
    value: "scissors", label: "Scissors", sidebarIcon: ScissorsSidebarIcon,
    playerCard: PlayerScissorsCard, houseCard: HouseScissorsCard,
    winState: PlayerScissorsWin, loseState: PlayerScissorsLose, drawState: ScissorsDrawState,
  },
];

function defOf(c) { return CHOICES.find((x) => x.value === c) || null; }

function resultAsset(pc, out) {
  const d = defOf(pc);
  if (!d) return null;
  return out === "win" ? d.winState : out === "lose" ? d.loseState : out === "tie" ? d.drawState : null;
}

function overlayColorClass(outcome) {
  if (outcome === "win") return "overlayWin";
  if (outcome === "lose") return "overlayLose";
  if (outcome === "tie") return "overlayDraw";
  return "";
}

export default function RPS({ gameRow }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();
  const multipliers = useMemo(() => buildMultipliers(9), []);

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
  const bet = useMemo(() => Number.parseFloat(betAmount) || 0, [betAmount]);

  const [roundId, setRoundId] = useState(null);
  const [inProgress, setInProgress] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const currentMultiplier = multipliers[Math.min(stepIndex, multipliers.length - 1)] || 1.0;

  const [history, setHistory] = useState([]);
  const [playerChoice, setPlayerChoice] = useState(null);
  const [houseChoice, setHouseChoice] = useState(null);
  const [lastOutcome, setLastOutcome] = useState(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [activeHouseFaceUp, setActiveHouseFaceUp] = useState(false);

  const [isSliding, setIsSliding] = useState(false);

  const [showResultOverlay, setShowResultOverlay] = useState(false);
  const [resultOverlayAsset, setResultOverlayAsset] = useState(null);
  const [resultOverlayOutcome, setResultOverlayOutcome] = useState(null);
  const [resultOverlayKey, setResultOverlayKey] = useState(0);

  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winAmount, setWinAmount] = useState(0);

  const busyRef = useRef(false);
  const drawTimerRef = useRef(null);
  const overlayTimerRef = useRef(null);

  const canChoose = inProgress && !isRevealing && lastOutcome !== "win" && lastOutcome !== "lose";
  const canCashout = inProgress && stepIndex > 0 && !isRevealing;
  const canContinue = inProgress && lastOutcome === "win" && !isRevealing;

  const adjustBet = (f) => setBetAmount(((Number.parseFloat(betAmount) || 0) * f).toFixed(2));

  const clearTimers = () => {
    if (drawTimerRef.current) { clearTimeout(drawTimerRef.current); drawTimerRef.current = null; }
    if (overlayTimerRef.current) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
  };

  const resetSessionUi = () => {
    clearTimers();
    setStepIndex(0);
    setPlayerChoice(null); setHouseChoice(null); setLastOutcome(null);
    setActiveHouseFaceUp(false); setIsRevealing(false);
    setHistory([]); setIsSliding(false);
    setShowResultOverlay(false); setResultOverlayAsset(null); setResultOverlayOutcome(null);
  };

  const endSessionLocal = () => {
    setRoundId(null);
    setInProgress(false);
    resetSessionUi();
  };

  const activeIdx = history.length;

  const houseFace = (c) => defOf(c)?.houseCard || Cardback;

  const showOutcomeOverlay = (pc, outcome) => {
    const asset = resultAsset(pc, outcome);
    if (asset) {
      setResultOverlayAsset(asset);
      setResultOverlayOutcome(outcome);
      setResultOverlayKey((k) => k + 1);
      setShowResultOverlay(true);

      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = setTimeout(() => {
        setShowResultOverlay(false);
        overlayTimerRef.current = null;
      }, RESULT_OVERLAY_MS);
    }
  };

  const hideOutcomeOverlay = () => {
    setShowResultOverlay(false);
    if (overlayTimerRef.current) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
  };

  const resetForRedraw = () => {
    setPlayerChoice(null);
    setHouseChoice(null);
    setLastOutcome(null);
    setActiveHouseFaceUp(false);
    hideOutcomeOverlay();
  };

  const start = useCallback(async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (busyRef.current) return;
    if (!Number.isFinite(bet) || bet <= 0) { setBetError("Invalid bet amount"); return; }
    if (bet > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }

    busyRef.current = true;
    setShowWinPopup(false);
    resetSessionUi();

    // Play bet sound
    playSound(BetSound);

    try {
      const res = await gamesAPI.rpsStart({ betAmount: bet });
      const r = res.data?.result;
      const newRoundId = res.data?.roundId;
      if (!r || !newRoundId) throw new Error("Bad response");
      setRoundId(newRoundId);
      setInProgress(true);
      setStepIndex(r.stepIndex ?? 0);
      if (typeof r.balance === "number") updateBalance(r.balance);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to start");
    } finally { busyRef.current = false; }
  }, [isAuthenticated, openLoginModal, bet, user?.balance, toast, updateBalance]);

  const continueNext = useCallback(() => {
    if (!canContinue) return;
    hideOutcomeOverlay();
    setIsSliding(true);

    // Play slide sound
    playSound(SlideSound);

    setTimeout(() => {
      setHistory((prev) => [...prev, { playerChoice, houseChoice, outcome: lastOutcome }]);
      setPlayerChoice(null);
      setHouseChoice(null);
      setLastOutcome(null);
      setActiveHouseFaceUp(false);
      setIsSliding(false);
    }, SLIDE_MS);
  }, [canContinue, playerChoice, houseChoice, lastOutcome]);

  const choose = useCallback(async (choice) => {
    if (!roundId || !inProgress || busyRef.current || isRevealing) return;
    if (lastOutcome === "win") return;

    busyRef.current = true;
    setIsRevealing(true);
    clearTimers();
    hideOutcomeOverlay();

    // Play choose sound
    playSound(ChooseSound);

    setPlayerChoice(choice);
    setHouseChoice(null);
    setLastOutcome(null);
    setActiveHouseFaceUp(false);

    try {
      const res = await gamesAPI.rpsChoose({ roundId, choice });
      const r = res.data?.result;
      if (!r) throw new Error("Bad response");

      setHouseChoice(r.houseChoice);

      // Play flip sound when card starts flipping
      setTimeout(() => {
        setActiveHouseFaceUp(true);
        playSound(FlipSound);
      }, REVEAL_DELAY_MS);

      setTimeout(() => {
        setLastOutcome(r.outcome);
        if (typeof r.stepIndex === "number") setStepIndex(r.stepIndex);

        showOutcomeOverlay(choice, r.outcome);

        // Play appropriate sound based on outcome
        if (r.outcome === "win") {
          // Play mid-round win sound
          playSound(WinMidRoundSound);
        } else if (r.outcome === "tie") {
          // Play draw state sound
          playSound(DrawStateSound);

          drawTimerRef.current = setTimeout(() => {
            resetForRedraw();
            drawTimerRef.current = null;
          }, DRAW_RESET_MS);
        }

        if (r.lost) {
          // Play lose sound. End the round IMMEDIATELY so a new bet can be
          // placed — the losing popup + cards STAY on screen (the overlay's
          // auto-hide timer is cancelled; the next Bet clears everything).
          playSound(LoseSound);
          if (overlayTimerRef.current) {
            clearTimeout(overlayTimerRef.current);
            overlayTimerRef.current = null;
          }
          setRoundId(null);
          setInProgress(false);
          setStepIndex(0);
        }

        setIsRevealing(false);
        busyRef.current = false;
      }, REVEAL_DELAY_MS + FLIP_MS);
    } catch (e) {
      const msg = e.response?.data?.message || "";
      if (msg.toLowerCase().includes("already resolved") || msg.toLowerCase().includes("already ended")) {
        endSessionLocal();
      } else {
        toast.error(msg || "Play failed");
      }
      setIsRevealing(false);
      busyRef.current = false;
    }
  }, [roundId, inProgress, isRevealing, lastOutcome]);

  const cashout = useCallback(async () => {
    if (!roundId || !canCashout || busyRef.current) return;
    busyRef.current = true;
    hideOutcomeOverlay();
    try {
      const res = await gamesAPI.rpsCashout({ roundId });
      const r = res.data?.result;
      if (!r) throw new Error("Bad response");

      const payout = r.payout || 0;
      if (typeof r.balance === "number") updateBalance(r.balance);

      endSessionLocal();

      // Play win sound after successful cashout
      playSound(WinSound);

      setWinAmount(payout);
      setShowWinPopup(true);
      setTimeout(() => setShowWinPopup(false), 1800);
    } catch (e) {
      toast.error(e.response?.data?.message || "Cashout failed");
    } finally { busyRef.current = false; }
  }, [roundId, canCashout, updateBalance]);

  const randomPick = useCallback(() => {
    if (!canChoose) return;
    choose(CHOICES[Math.floor(Math.random() * 3)].value);
  }, [canChoose, choose]);
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("rps", inProgress);


  const dealerOffset = isSliding ? activeIdx + 1 + PAD_LEFT : activeIdx + PAD_LEFT;
  const playerOffset = isSliding ? activeIdx + 1 : activeIdx;

  return (
    <div className={styles.container}>
      {/* Sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${styles.active}`} type="button">
            Manual
          </button>
          <button className={`${styles.modeBtn} sidebar-mode-auto-disabled`} type="button" disabled>
            Auto
          </button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Bet Amount</span>
            <span>${format2(bet)}</span>
          </div>
          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <input type="number" placeholder="0.00" value={betAmount} onChange={(e) => setBetAmount(e.target.value)}
                step="0.01" disabled={inProgress || isRevealing} />
              <CurrencyIcon className={styles.btcIcon} />
            </div>
            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || inProgress || isRevealing}>½</button>
              <div className={styles.divider} />
              <button onClick={() => adjustBet(2)} disabled={isLocked || inProgress || isRevealing}>2×</button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        {!inProgress ? (
          <span className="ui-bet-wrap">
            <button className={styles.betButton} onClick={start} disabled={isLocked || isRevealing} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>Bet</button>
            <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
          </span>
        ) : (
          <div className={styles.betRow}>
            <button className={styles.cashoutBtn} onClick={cashout} disabled={!canCashout}>Cashout</button>
            <button className={styles.continueBtn} onClick={continueNext} disabled={!canContinue}>Continue</button>
          </div>
        )}

        <button className={styles.secondaryButton} onClick={randomPick} disabled={!canChoose}>Random Pick</button>

        <div className={styles.choiceRow}>
          {CHOICES.map((c) => (
            <button key={c.value}
              className={`${styles.choiceSmall} ${playerChoice === c.value ? styles.choiceSmallActive : ""}`}
              onClick={() => choose(c.value)} disabled={!canChoose} type="button">
              <span className={styles.choiceSmallLabel}>{c.label}</span>
              <img className={styles.choiceSmallIcon} src={c.sidebarIcon} alt="" draggable="false" />
            </button>
          ))}
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Total Profit ({format2(currentMultiplier)}×)</span>
            <span>${format2((bet * currentMultiplier - bet) || 0)}</span>
          </div>
          <div className={`${styles.readonlyMoney} ${styles.profitInput}`}>
            <input type="text" value={format2(inProgress ? bet * currentMultiplier : 0)} readOnly />
            <CurrencyIcon className={styles.btcIcon} />
          </div>
        </div>
      </div>

      {/* Stage */}
      <div className={styles.stage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Cashout popup — direct child of the stage, dead-centre overlay */}
        {showWinPopup && winAmount > 0 && (
          <div className={`${styles.cashoutPopup} ${styles.popupWin}`}>
            <div className={styles.cashoutPopupTitle}>YOU WON</div>
            <div className={styles.cashoutPopupAmount}>${format2(winAmount)}</div>
          </div>
        )}

        <div className={styles.stageInner}>
          {/* Result overlay */}
          {showResultOverlay && resultOverlayAsset && (
            <div key={resultOverlayKey} className={`${styles.resultOverlay} ${styles[overlayColorClass(resultOverlayOutcome)] || ""}`}>
              <div className={styles.resultOverlayInner}>
                <img className={styles.resultOverlayImg} src={resultOverlayAsset} alt="" draggable="false" />
              </div>
            </div>
          )}

          {/* Dealer Row */}
          <div className={styles.trackViewport}>
            <div
              className={styles.dealerStrip}
              style={{
                transform: `translateX(calc(50% - ${dealerOffset} * var(--shift) - var(--cardW) / 2))`,
                transition: isSliding ? `transform ${SLIDE_MS}ms ease` : "none",
              }}
            >
              {Array.from({ length: TOTAL_SLOTS }).map((_, rawIdx) => {
                const idx = rawIdx - PAD_LEFT;
                const isActive = idx === activeIdx;
                const isHistory = idx >= 0 && idx < activeIdx;
                const isPadding = idx < 0;

                let cardContent;
                if (isPadding) {
                  cardContent = <div className={styles.emptySlotDealer} />;
                } else if (isHistory) {
                  const h = history[idx];
                  cardContent = <img src={houseFace(h.houseChoice)} alt="" draggable="false" />;
                } else if (isActive && houseChoice) {
                  cardContent = (
                    <div className={`${styles.flipWrap} ${activeHouseFaceUp ? styles.flipFaceUp : ""}`}>
                      <div className={`${styles.flipFace} ${styles.flipFront}`}>
                        <img src={houseFace(houseChoice)} alt="" draggable="false" />
                      </div>
                      <div className={`${styles.flipFace} ${styles.flipBack}`}>
                        <img src={Cardback} alt="" draggable="false" />
                      </div>
                    </div>
                  );
                } else if (isActive) {
                  cardContent = <img src={Cardback} alt="" draggable="false" />;
                } else {
                  cardContent = <img src={Cardback} alt="" draggable="false" />;
                }

                return (
                  <div key={rawIdx} className={styles.dealerSlotCol}>
                    <div className={`${styles.rowCard} ${isActive ? styles.activeOutline : ""}`}>
                      {cardContent}
                    </div>
                    <div className={styles.multPillWrap}>
                      {isPadding ? (
                        <div className={styles.multPillSkeleton} />
                      ) : idx < multipliers.length ? (
                        <div className={`${styles.multPill} ${idx === activeIdx ? styles.multPillActive : ""}`}>
                          {multipliers[idx].toFixed(2)}×
                        </div>
                      ) : (
                        <div className={styles.multPillSpacer} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Player Row */}
          <div className={styles.trackViewport}>
            <div
              className={styles.playerStrip}
              style={{
                transform: `translateX(calc(-50% + ${playerOffset} * var(--shift) + var(--cardW) / 2))`,
                transition: isSliding ? `transform ${SLIDE_MS}ms ease` : "none",
              }}
            >
              {Array.from({ length: TOTAL_SLOTS }).map((_, idx) => {
                const isActive = idx === activeIdx;
                const isHistory = idx < activeIdx;

                let cardContent;
                if (isHistory) {
                  const h = history[idx];
                  cardContent = (
                    <div className={styles.playerCardWrap}>
                      <img className={styles.playerHistoryChoice} src={defOf(h.playerChoice)?.playerCard} alt="" draggable="false" />
                    </div>
                  );
                } else if (isActive && playerChoice) {
                  cardContent = (
                    <div className={styles.playerActiveCard}>
                      <img className={styles.playerCardBase} src={PlayerCardBase} alt="" draggable="false" />
                      <img className={styles.playerCardChoice} src={defOf(playerChoice)?.playerCard} alt="" draggable="false" />
                    </div>
                  );
                } else if (isActive) {
                  cardContent = (
                    <div className={styles.playerActiveCard}>
                      <img className={styles.playerCardBase} src={PlayerCardBase} alt="" draggable="false" />
                    </div>
                  );
                } else {
                  cardContent = <div className={styles.emptySlot} />;
                }

                return (
                  <div key={idx} className={styles.playerSlotCol}>
                    <div className={styles.rowCard}>
                      {cardContent}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Choice Pads */}
          <div className={styles.choicePadsWrap}>
            <div className={styles.choicePads}>
              {CHOICES.map((c) => (
                <button key={c.value} type="button"
                  className={`${styles.padBtn} ${!canChoose ? styles.padDisabled : ""}`}
                  onClick={() => choose(c.value)} disabled={!canChoose}>
                  <div className={styles.padOuter}>
                    <div className={styles.padBase} />
                    <div className={styles.padTop}>
                      <div className={styles.padInnerDark}>
                        <img className={styles.padIcon} src={c.playerCard} alt={c.label} draggable="false" />
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}