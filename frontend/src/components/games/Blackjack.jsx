import { useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import styles from "./blackjack.module.css";

import paysSvg from "../../assets/blackjack/background.svg";
import cardBackSvg from "../../assets/blackjack/cardback.svg";

import heartsSvg from "../../assets/blackjack/hearts.svg";
import spadesSvg from "../../assets/blackjack/spades.svg";
import clubsSvg from "../../assets/blackjack/clubs.svg";
import diamondsSvg from "../../assets/blackjack/diamonds.svg";

// Action icons
import hitSvg from "../../assets/blackjack/Hit.svg";
import standSvg from "../../assets/blackjack/Stand.svg";
import splitSvg from "../../assets/blackjack/Split.svg";
import doubleSvg from "../../assets/blackjack/Double.svg";

// simple deck image
import deckEntityPng from "../../assets/blackjack/deckentity.png";

// ✅ Sounds
import cardMp3 from "../../assets/blackjack/Card.mp3";
import winMp3 from "../../assets/blackjack/Win.mp3";
import loseWav from "../../assets/blackjack/Lose.wav";
import flipMp3 from "../../assets/blackjack/Flip.mp3";

import useGameAudio from "../../hooks/useGameAudio";
import CurrencyIcon from "../common/CurrencyIcon";

const BJ_START_URL = "/api/games/blackjack/start";
const BJ_ACTION_URL = "/api/games/blackjack/action";

// animation timings (match CSS)
const DEAL_FLIGHT_MS = 700; // one card's flight, deck -> seat (dealIn)
const DEAL_STEP_MS = 650; // gap between consecutive flights (sequential deal)
const DEAL_EXTRA_MS = 150; // lead-in before mid-round cards (hits, draws)
const DEAL_FLIP_MS = 420; // post-flight flip (dealFlipIn)
const FLIP_MS = 650;
const FLIP_TOTAL_OFFSET_MS = 200;

// Sequential deal order: P0, D0, P1, D1 — one card flies at a time.
// Mid-round cards (hits, splits, dealer draws) use a short lead-in.
function dealerDealDelay(i) {
  if (i < 2) return (1 + i * 2) * DEAL_STEP_MS;
  return DEAL_EXTRA_MS + (i - 2) * DEAL_STEP_MS;
}

function playerDealDelay(handIdx, i) {
  if (handIdx === 0 && i < 2) return i * 2 * DEAL_STEP_MS;
  if (handIdx === 0) return DEAL_EXTRA_MS;
  return DEAL_EXTRA_MS + handIdx * DEAL_STEP_MS;
}

function isRedSuit(s) {
  return s === "hearts" || s === "diamonds";
}

function suitIconSrc(s) {
  if (s === "spades") return spadesSvg;
  if (s === "hearts") return heartsSvg;
  if (s === "diamonds") return diamondsSvg;
  return clubsSvg;
}

function toUiCard(c) {
  if (!c) return null;
  if (c.hidden) return { hidden: true };
  return {
    id: c.id,
    r: c.r ?? c.rank ?? c.value,
    s: c.s ?? c.suit,
    hidden: false,
  };
}

function cardKey(c, i) {
  if (!c) return `x-${i}`;
  if (c.hidden) return `hidden-${i}`;
  return c.id ?? `${c.r}-${c.s}-${i}`;
}

function summarizeResult(handOutcomes, totalPayout) {
  const outs = handOutcomes || [];
  if (outs.some((o) => o === "win")) return { status: "win", payout: totalPayout };
  if (outs.length > 0 && outs.every((o) => o === "push")) return { status: "push", payout: totalPayout };
  return { status: "lose", payout: 0 };
}

function sum(arr) {
  return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
}

function rankValue(r) {
  if (r === "A") return 11;
  if (["K", "Q", "J"].includes(r)) return 10;
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

function handTotalUi(hand) {
  let total = 0;
  let aces = 0;

  for (const c of hand || []) {
    total += rankValue(c?.r);
    if (c?.r === "A") aces += 1;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

// Pill text for a hand. Soft hands (an ace that can still count as 11)
// ALWAYS show BOTH totals — e.g. A+5 renders "6, 16".
function handTotalDisplay(hand) {
  const cards = hand || [];
  let low = 0;
  let aces = 0;

  for (const c of cards) {
    if (c?.r === "A") {
      aces += 1;
      low += 1;
    } else {
      low += rankValue(c?.r);
    }
  }

  const high = aces > 0 ? low + 10 : low;

  if (aces > 0 && cards.length > 1 && high <= 21) {
    return `${low}, ${high}`;
  }

  return `${high <= 21 ? high : low}`;
}

export default function Blackjack({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const auth = useAuth();
  const { user, isAuthenticated, openLoginModal, updateBalance } = auth;
  const toast = useToast();

  const sfx = useGameAudio(
    {
      card: cardMp3,
      win: winMp3,
      lose: loseWav,
      flip: flipMp3,
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
  const revealTimerRef = useRef(null);
  const dealerTotalTimersRef = useRef([]);

  // ✅ Card deal sound timers (initial deal)
  const dealSoundTimersRef = useRef([]);

  // ✅ Dealer draw/flip sound timers (after stand / settlement)
  const dealerSoundTimersRef = useRef([]);

  const [ui, setUi] = useState(() => ({
    phase: "idle", // idle | playerTurn | settled
    roundId: null,

    dealer: [],
    playerHands: [[]],
    activeHandIndex: 0,

    handTotals: [],
    handBets: [],
    handOutcomes: [],

    // how many dealer cards the pill counts (the reveal count-up steps it)
    dealerShownCount: 0,
    dealerTotal: 0,

    settled: false,
    payout: 0,

    busy: false,

    showResult: false,
    resultStatus: null, // "win" | "lose" | "push"
    resultPayout: 0,
    pendingOutcomes: null,
    pendingPayout: 0,
  }));

  const bet = useMemo(() => Number.parseFloat(betAmount) || 0, [betAmount]);

  const canDeal = !ui.busy && (ui.phase === "idle" || ui.phase === "settled");
  const canAct = !ui.busy && ui.phase === "playerTurn" && !ui.settled;

  const activeHand = ui.playerHands?.[ui.activeHandIndex] ?? [];

  const canHit = canAct;
  const canStand = canAct;

  const canDouble =
    canAct &&
    activeHand.length === 2 &&
    (Number.isFinite(bet) ? (user?.balance ?? 0) >= bet : true);

  const canSplit =
    canAct &&
    activeHand.length === 2 &&
    activeHand?.[0]?.r &&
    activeHand?.[0]?.r === activeHand?.[1]?.r &&
    (Number.isFinite(bet) ? (user?.balance ?? 0) >= bet : true);

  const adjustBet = (mult) => {
    const curr = Number.parseFloat(betAmount) || 0;
    setBetAmount((curr * mult).toFixed(2));
  };

  const getAccessToken = () => {
    const ctxToken = auth?.accessToken || auth?.token || auth?.authToken || auth?.user?.accessToken;
    if (ctxToken) return ctxToken;

    return (
      localStorage.getItem("accessToken") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("token") ||
      ""
    );
  };

  const apiPost = async (url, body) => {
    const token = getAccessToken();

    if (!token) {
      openLoginModal?.();
      throw new Error("Please log in again");
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      body: JSON.stringify(body ?? {}),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = data?.message || `Request failed (${res.status})`;
      if (msg.toLowerCase().includes("access token required")) openLoginModal?.();
      throw new Error(msg);
    }

    if (!data) throw new Error("Empty response from server");
    return data;
  };

  const clearDealerTotalTimers = () => {
    dealerTotalTimersRef.current.forEach((t) => clearTimeout(t));
    dealerTotalTimersRef.current = [];
  };

  const clearDealSoundTimers = () => {
    dealSoundTimersRef.current.forEach((t) => clearTimeout(t));
    dealSoundTimersRef.current = [];
  };

  const clearDealerSoundTimers = () => {
    dealerSoundTimersRef.current.forEach((t) => clearTimeout(t));
    dealerSoundTimersRef.current = [];
  };

  const scheduleDealSounds = (gs) => {
    clearDealSoundTimers();

    // one swish per card flight, in deal order (P0, D0, P1, D1, …)
    const hands = gs?.playerHands ?? [[]];
    const dealerCount = (gs?.dealerHand ?? []).length;
    const p0 = hands[0]?.length ?? 0;
    const delays = [];
    for (let i = 0; i < Math.max(p0, dealerCount); i++) {
      if (i < p0) delays.push(playerDealDelay(0, i));
      if (i < dealerCount) delays.push(dealerDealDelay(i));
    }
    for (let h = 1; h < hands.length; h++) {
      const n = hands[h]?.length ?? 0;
      for (let i = 0; i < n; i++) delays.push(playerDealDelay(h, i));
    }
    for (const d of delays) {
      dealSoundTimersRef.current.push(
        setTimeout(() => {
          sfx.play("card", { volume: 1 });
        }, d)
      );
    }
  };

  const scheduleDealerRevealSounds = ({ gs, hadHoleCardHidden }) => {
    clearDealerSoundTimers();

    const dealerCount = (gs?.dealerHand ?? []).length;

    if (hadHoleCardHidden) {
      dealerSoundTimersRef.current.push(
        setTimeout(() => {
          sfx.play("flip", { volume: 1 });
        }, 0)
      );

      for (let i = 2; i < dealerCount; i++) {
        dealerSoundTimersRef.current.push(
          setTimeout(() => {
            sfx.play("card", { volume: 1 });
          }, dealerDealDelay(i))
        );
      }
    } else {
      for (let i = 1; i < dealerCount; i++) {
        const delay = i < 2 ? 0 : dealerDealDelay(i);
        dealerSoundTimersRef.current.push(
          setTimeout(() => {
            sfx.play("card", { volume: 1 });
          }, delay)
        );
      }
    }
  };

  const scheduleDealerTotalCountUp = ({ gs, hadHoleCardHidden }) => {
    clearDealerTotalTimers();

    const dealer = (gs.dealerHand ?? []).map(toUiCard).filter(Boolean);
    if (dealer.length === 0) return;

    if (hadHoleCardHidden) {
      dealerTotalTimersRef.current.push(
        setTimeout(() => {
          setUi((prev) => ({
            ...prev,
            dealerShownCount: Math.min(2, dealer.length),
          }));
        }, FLIP_TOTAL_OFFSET_MS)
      );

      for (let i = 2; i < dealer.length; i++) {
        // each draw joins the total as its flight lands
        const delay = dealerDealDelay(i) + DEAL_FLIGHT_MS;

        dealerTotalTimersRef.current.push(
          setTimeout(() => {
            setUi((prev) => ({
              ...prev,
              dealerShownCount: i + 1,
            }));
          }, delay)
        );
      }

      return;
    }

    for (let i = 1; i < dealer.length; i++) {
      const delay = i < 2 ? DEAL_EXTRA_MS : dealerDealDelay(i) + DEAL_FLIGHT_MS;

      dealerTotalTimersRef.current.push(
        setTimeout(() => {
          setUi((prev) => ({
            ...prev,
            dealerShownCount: i + 1,
          }));
        }, delay)
      );
    }
  };

  const scheduleReveal = ({ gs, outcomes, payout, hadHoleCardHidden }) => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    const { status, payout: summaryPayout } = summarizeResult(outcomes, payout);

    // the reveal waits for every flight still in the air: the hole flip,
    // any dealer draws landing one by one, and a possible double/hit card
    const dealerDraws = Math.max(0, (gs.dealerHand ?? []).length - 2);
    const drawEnd = dealerDraws > 0
      ? DEAL_EXTRA_MS + (dealerDraws - 1) * DEAL_STEP_MS + DEAL_FLIGHT_MS
      : 0;
    const playerNewEnd = DEAL_EXTRA_MS + DEAL_FLIGHT_MS;

    const delay = Math.max(hadHoleCardHidden ? FLIP_MS : 0, drawEnd, playerNewEnd);

    revealTimerRef.current = setTimeout(() => {
      if (status === "win") sfx.play("win", { volume: 1 });
      else if (status === "lose") sfx.play("lose", { volume: 1 });

      setUi((prev) => ({
        ...prev,
        showResult: true,
        resultStatus: status,
        resultPayout: summaryPayout,
        handOutcomes: prev.pendingOutcomes ?? prev.handOutcomes,
      }));
      revealTimerRef.current = null;
    }, delay);
  };

  const applyServerState = (data) => {
    const gs = data.gameState;
    if (!gs) throw new Error("Invalid server response (missing gameState)");

    if (typeof gs.balance === "number") updateBalance?.(gs.balance);

    const settled = gs.status === "finished";

    const dealer = (gs.dealerHand ?? []).map(toUiCard).filter(Boolean);
    const playerHands = (gs.playerHands ?? [[]]).map((hand) => (hand ?? []).map(toUiCard).filter(Boolean));

    const serverOutcomes = gs.handOutcomes ?? [];
    const serverPayout = gs.payout ?? 0;

    const hadHoleCardHidden = ui.dealer?.some((c) => c?.hidden);

    setUi((s) => ({
      ...s,
      phase: settled ? "settled" : "playerTurn",
      roundId: gs.roundId ?? s.roundId,

      dealer,
      playerHands,
      activeHandIndex: gs.activeHandIndex ?? 0,

      handTotals: gs.handTotals ?? [],
      handBets: gs.handBets ?? [],

      handOutcomes: settled ? [] : serverOutcomes,

      dealerShownCount: settled
        ? s.dealerShownCount
        : dealer.filter((c) => !c?.hidden).length,
      dealerTotal: typeof gs.dealerTotal === "number" ? gs.dealerTotal : 0,

      settled,
      payout: serverPayout,
      busy: false,

      pendingOutcomes: settled ? serverOutcomes : null,
      pendingPayout: settled ? serverPayout : 0,

      ...(settled ? null : { showResult: false, resultStatus: null, resultPayout: 0 }),
    }));

    if (settled) {
      scheduleDealerRevealSounds({ gs, hadHoleCardHidden });
      scheduleDealerTotalCountUp({ gs, hadHoleCardHidden });
      scheduleReveal({ gs, outcomes: serverOutcomes, payout: serverPayout, hadHoleCardHidden });
    }
  };

  const handleDeal = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }

    if (!Number.isFinite(bet) || bet <= 0) { setBetError("Invalid bet amount"); return; }
    if (bet > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }
    if (!canDeal) return;

    const prevBalance = user?.balance ?? 0;

    updateBalance?.((b) => b - bet);

    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    clearDealerTotalTimers();
    clearDealSoundTimers();
    clearDealerSoundTimers();

    setUi((s) => ({
      ...s,
      busy: true,
      showResult: false,
      resultStatus: null,
      resultPayout: 0,
      pendingOutcomes: null,
      pendingPayout: 0,
      handOutcomes: [],
    }));

    try {
      const data = await apiPost(BJ_START_URL, { betAmount: bet });

      scheduleDealSounds(data.gameState);

      applyServerState(data);
    } catch (e) {
      console.error("Blackjack deal failed:", e);
      updateBalance?.(prevBalance);
      toast.error(e.message || "Failed to start blackjack");
      setUi((s) => ({ ...s, busy: false }));
    }
  };

  const handleAction = async (action) => {
    if (!ui.roundId) return;
    if (!["hit", "stand", "double", "split"].includes(action)) return;
    if (ui.busy) return;

    const prevBalance = user?.balance ?? 0;
    const extraCost = action === "double" || action === "split" ? bet : 0;

    if (extraCost > 0) {
      if (extraCost > prevBalance) { setBetError("Insufficient balance"); return; }
      updateBalance?.((b) => b - extraCost);
    }

    try {
      setUi((s) => ({ ...s, busy: true }));

      const data = await apiPost(BJ_ACTION_URL, {
        roundId: ui.roundId,
        action,
        handIndex: ui.activeHandIndex ?? 0,
      });

      if (action === "hit" || action === "double") {
        setTimeout(() => sfx.play("card", { volume: 1 }), DEAL_EXTRA_MS);
      }
      if (action === "split") {
        setTimeout(() => sfx.play("card", { volume: 1 }), 0);
        setTimeout(() => sfx.play("card", { volume: 1 }), DEAL_EXTRA_MS + DEAL_STEP_MS);
        setTimeout(() => sfx.play("card", { volume: 1 }), 2 * DEAL_STEP_MS);
      }

      applyServerState(data);
    } catch (e) {
      console.error("Blackjack action failed:", e);
      if (extraCost > 0) updateBalance?.(prevBalance);
      toast.error(e.message || "Action failed");
      setUi((s) => ({ ...s, busy: false }));
    }
  };

  // Warn before a page refresh while a bet is live (see RefreshGuard).
  // (a dealt hand is not persisted client-side: refreshing mid-hand loses it)
  useActiveBetFlag(
    "blackjack",
    Boolean(ui.roundId) && !ui.settled && ui.phase !== "idle" && ui.phase !== "settled"
  );

  return (
    <div className={styles.container}>
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
            </div>

            <CurrencyIcon className={styles.btcIcon} />

            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)}>½</button>
              <div className={styles.divider} />
              <button onClick={() => adjustBet(2)}>2×</button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <div className={styles.actionGrid}>
          <button className={`${styles.actionButton} ${styles.actionHit}`} onClick={() => handleAction("hit")} disabled={!canHit}>
            Hit
            <img className={styles.actionIcon} src={hitSvg} alt="" draggable="false" />
          </button>

          <button className={`${styles.actionButton} ${styles.actionStand}`} onClick={() => handleAction("stand")} disabled={!canStand}>
            Stand
            <img className={styles.actionIcon} src={standSvg} alt="" draggable="false" />
          </button>

          <button className={`${styles.actionButton} ${styles.actionSplit}`} onClick={() => handleAction("split")} disabled={!canSplit}>
            Split
            <img className={styles.actionIcon} src={splitSvg} alt="" draggable="false" />
          </button>

          <button className={`${styles.actionButton} ${styles.actionDouble}`} onClick={() => handleAction("double")} disabled={!canDouble}>
            Double
            <img className={styles.actionIcon} src={doubleSvg} alt="" draggable="false" />
          </button>
        </div>

        <span className="ui-bet-wrap">
          <button className={styles.betButton} onClick={handleDeal} disabled={isLocked || !canDeal} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          {ui.busy ? "..." : "Bet"}
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        <div className={styles.deckEntity} aria-hidden="true">
          <img className={styles.deckEntityImg} src={deckEntityPng} alt="" draggable="false" />
        </div>

        {ui.showResult && (
          <div
            className={`${styles.resultPopup} ${ui.resultStatus === "win"
                ? styles.popupWin
                : ui.resultStatus === "lose"
                  ? styles.popupLose
                  : styles.popupPush
              }`}
          >
            {ui.resultStatus === "lose" ? (
              <>
                <div className={styles.resultPopupTitle}>YOU LOST</div>
                <div className={styles.resultPopupAmountMuted}>-{sum(ui.handBets).toFixed(2)}<CurrencyIcon /></div>
              </>
            ) : (
              <>
                <div className={styles.resultPopupMult}>
                  {(ui.resultStatus === "push"
                    ? 1
                    : sum(ui.handBets) > 0
                      ? Number(ui.resultPayout || 0) / sum(ui.handBets)
                      : 0
                  ).toFixed(2)}×
                </div>
                <div className={styles.resultPopupDivider} aria-hidden="true" />
                <div className={styles.resultPopupAmount}>{Number(ui.resultPayout || 0).toFixed(2)}<CurrencyIcon /></div>
              </>
            )}
          </div>
        )}

        <div className={styles.dealerArea}>
          {ui.roundId ? (
            /* Dealer total stays neutral dark — the win/loss highlight
               belongs only on the settled player's own total pill. */
            <div className={styles.totalPillDark}>
              {handTotalDisplay(
                ui.dealer
                  .filter((c) => !c?.hidden)
                  .slice(0, Math.max(1, ui.dealerShownCount || 0))
              )}
            </div>
          ) : null}

          <div className={styles.fanTop}>
            {ui.dealer.map((c, i) => (
              <Card
                key={i === 1 ? `dealer-hole-${ui.roundId ?? "x"}` : cardKey(c, i)}
                index={i}
                card={c}
                hidden={!!c.hidden}
                outline="none"
                animate
                cardBackSrc={cardBackSvg}
                flip={i === 1}
                faceUp={!c?.hidden}
                dealDelayMs={dealerDealDelay(i)}
              />
            ))}
          </div>
        </div>

        <div className={styles.ribbon} aria-hidden="true">
          <img className={styles.ribbonSvg} src={paysSvg} alt="" />
        </div>

        <div className={styles.playerArea}>
          <div className={styles.handsRow}>
            {ui.playerHands.map((hand, hIdx) => {
              const total = handTotalDisplay(hand);
              const outcome = ui.handOutcomes?.[hIdx] ?? null;

              const settled = ui.showResult && ui.phase === "settled";
              const outline = settled
                ? outcome === "win"
                  ? "win"
                  : outcome === "lose"
                    ? "lose"
                    : outcome === "push"
                      ? "push"
                      : "none"
                : "none";

              const pillTone = settled
                ? outcome === "win"
                  ? styles.totalWin
                  : outcome === "lose"
                    ? styles.totalLose
                    : outcome === "push"
                      ? styles.totalPush
                      : ""
                : "";

              return (
                <div key={hIdx} className={styles.handWrap}>
                  {ui.roundId ? (
                    <div className={`${styles.totalPillPlayer} ${pillTone}`}>
                      {total}
                    </div>
                  ) : null}

                  <div className={styles.fanBottom}>
                    {hand.map((c, i) => (
                      <Card
                        key={cardKey(c, i)}
                        index={i}
                        card={c}
                        hidden={false}
                        outline={outline}
                        animate
                        cardBackSrc={cardBackSvg}
                        dealDelayMs={playerDealDelay(hIdx, i)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ index, card, hidden, outline = "none", animate = false, cardBackSrc, flip = false, faceUp = true, dealDelayMs = 0 }) {
  const r = card?.r;
  const s = card?.s;
  const red = s ? isRedSuit(s) : false;
  const suitSrc = s ? suitIconSrc(s) : null;

  const overlapX = 39;
  const overlapY = 14;
  const x = index * overlapX;
  const y = index * overlapY;
  const rot = 0;

  const showFlip = !!flip;

  const frontFace = (
    <>
      <div className={styles.corner}>
        <div className={`${styles.rank} ${red ? styles.redText : styles.blackText}`}>{r}</div>
      </div>

      <div className={styles.center}>
        {suitSrc ? (
          <img
            className={`${styles.centerSuitIconLarge} ${red ? styles.suitIconRed : styles.suitIconBlack}`}
            src={suitSrc}
            alt=""
            draggable="false"
          />
        ) : null}
      </div>
    </>
  );

  const backFace = (
    <div className={styles.cardBackWrap}>
      <img className={styles.cardBackImg} src={cardBackSrc} alt="" draggable="false" />
    </div>
  );


  return (
    <div
      className={styles.cardSlot}
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`,
        zIndex: 10 + index,
      }}
    >
      <div
        className={`${styles.cardMotion} ${animate ? styles.cardDeal : ""}`}
        style={animate ? { animationDelay: `${dealDelayMs}ms` } : undefined}
      >
        <div
          className={`${styles.card} ${hidden ? styles.cardNoClip : ""} ${outline === "win" ? styles.cardOutlineWin : outline === "lose" ? styles.cardOutlineLose : outline === "push" ? styles.cardOutlinePush : ""
            }`}
        >
          {showFlip ? (
            <div className={`${styles.flipWrap} ${faceUp ? styles.flipFaceUp : ""}`}>
              <div className={`${styles.flipFace} ${styles.flipFront}`}>{frontFace}</div>
              <div className={`${styles.flipFace} ${styles.flipBack}`}>{backFace}</div>
            </div>
          ) : !hidden ? (
            /* Dealt face-down at the deck, flown to its seat, and flipped
               face-up only after the flight completes (the hole card keeps
               the old reveal path — it never deal-flips). */
            <div
              className={`${styles.flipWrap} ${animate ? styles.dealFlipDo : styles.flipFaceUp}`}
              style={animate ? { "--deal-flip-delay": `${dealDelayMs + DEAL_FLIGHT_MS}ms` } : undefined}
            >
              <div className={`${styles.flipFace} ${styles.flipFront}`}>{frontFace}</div>
              <div className={`${styles.flipFace} ${styles.flipBack}`}>{backFace}</div>
            </div>
          ) : (
            backFace
          )}
        </div>
      </div>
    </div>
  );
}