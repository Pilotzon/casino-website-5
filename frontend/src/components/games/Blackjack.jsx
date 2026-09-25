import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import WinPopup from "../common/WinPopup";

const BJ_START_URL = "/api/games/blackjack/start";
const BJ_ACTION_URL = "/api/games/blackjack/action";

/* ============================================================================
 * Deal choreography (ms)
 *
 * Every card leaves the deck (top right) face-down, slides to its place and
 * only turns over once it has landed. The opening deal goes player, dealer,
 * player, dealer — the dealer's second card (the hole card) stays down until
 * the settlement turns it over in place, then the dealer draws.
 * ==========================================================================*/
export const DEAL_GAP_MS = 180; // between consecutive cards of one deal
export const DEAL_MOVE_MS = 380; // deck -> place
export const DEAL_FLIP_MS = 280; // turn-over after landing
export const REVEAL_FLIP_MS = 420; // the hole card turning over at settlement
const REVEAL_PAUSE_MS = 140; // beat between the player's last card and the reveal
const DRAW_PAUSE_MS = 120; // beat between the reveal and the dealer's draws
const RESULT_PAUSE_MS = 180; // last card face-up -> result popup
// a turning card counts towards its total once its face is showing — the
// turn eases out, so the face is up well before the transition ends
const FACE_SHOWN_AT = 0.6;
const DEAL_EASE = "cubic-bezier(0.25, 0.8, 0.3, 1)";

// Where the top card sits on the deck art (deckentity.png, 126×60): it spans
// the full image width and its bottom edge is 72% of the way down — a dealt
// card starts exactly on top of it, so it reads as lifting off the deck.
const DECK_CARD_WIDTH = 1;
const DECK_CARD_BOTTOM = 0.72;

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
    r: c.r ?? c.rank ?? c.value,
    s: c.s ?? c.suit,
    hidden: false,
  };
}

/* A round is dealt from ONE shuffled 52-card deck, so rank + suit is unique
 * within a round and makes a stable identity: a card keeps its key when a
 * split moves it to the new hand (so it is not dealt a second time), and the
 * dealer's hole card keeps its slot key while it turns over. */
function keyDealer(hand, roundId) {
  return (hand ?? [])
    .map(toUiCard)
    .filter(Boolean)
    .map((c, i) => ({ ...c, key: i === 1 ? `d-hole-${roundId}` : `d-${roundId}-${c.r}${c.s}` }));
}

function keyHands(hands, roundId) {
  return (hands ?? [[]]).map((hand) =>
    (hand ?? [])
      .map(toUiCard)
      .filter(Boolean)
      .map((c, i) => ({ ...c, key: c.hidden ? `p-${roundId}-hidden-${i}` : `p-${roundId}-${c.r}${c.s}` }))
  );
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

function rankPoints(r) {
  if (r === "A") return 1;
  if (["K", "Q", "J"].includes(r)) return 10;
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The total label for a hand (face-up cards only).
 * A soft hand shows both totals — "7, 17" for A+6 — until it is decided:
 * a soft 21 is just "21", and a finished hand shows its best total.
 */
export function handTotalLabel(cards, final = false) {
  let low = 0;
  let aces = 0;
  let count = 0;
  for (const c of cards || []) {
    if (!c || c.hidden || !c.r) continue;
    count += 1;
    low += rankPoints(c.r);
    if (c.r === "A") aces += 1;
  }
  if (count === 0) return null;
  const high = aces > 0 && low + 10 <= 21 ? low + 10 : low;
  if (high !== low && high !== 21 && !final) return `${low}, ${high}`;
  return String(high);
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

  const [ui, setUi] = useState(() => ({
    phase: "idle", // idle | playerTurn | settled
    roundId: null,

    dealer: [],
    playerHands: [[]],
    activeHandIndex: 0,

    handBets: [],
    handOutcomes: [],

    settled: false,
    payout: 0,

    busy: false,

    showResult: false,
    resultStatus: null, // "win" | "lose" | "push"
    resultPayout: 0,
  }));

  // ---- deal timeline -------------------------------------------------------
  const deckRef = useRef(null);
  const knownRef = useRef(new Set()); // card keys already dealt this round
  const planRef = useRef(new Map()); // key -> { delay } | { flipDelay } for the latest update
  const holeDownRef = useRef(false); // the dealer's hole card is lying face-down
  const dealClockRef = useRef(0); // performance.now() at which the running deal ends
  const timersRef = useRef([]);
  const [revealed, setRevealed] = useState(() => new Set()); // face-up (counted) card keys
  const [animating, setAnimating] = useState(false);

  const clearTimeline = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  useEffect(() => () => clearTimeline(), []);

  const markRevealed = (key) =>
    setRevealed((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

  const resetTable = () => {
    clearTimeline();
    knownRef.current = new Set();
    planRef.current = new Map();
    holeDownRef.current = false;
    dealClockRef.current = 0;
    setRevealed(new Set());
    setAnimating(false);
  };

  const bet = useMemo(() => Number.parseFloat(betAmount) || 0, [betAmount]);

  const canDeal = !ui.busy && !animating && (ui.phase === "idle" || ui.phase === "settled");
  const canAct = !ui.busy && !animating && ui.phase === "playerTurn" && !ui.settled;

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

  /**
   * Apply a server snapshot and schedule how it plays out on the table:
   * which cards are new (dealt from the deck, in order), whether the hole card
   * turns over, and when the sounds and the result come. Totals follow the
   * cards themselves: each card reports when its face is showing.
   */
  const applyServerState = (data) => {
    const gs = data.gameState;
    if (!gs) throw new Error("Invalid server response (missing gameState)");

    if (typeof gs.balance === "number") updateBalance?.(gs.balance);

    const settled = gs.status === "finished";
    const roundId = gs.roundId ?? ui.roundId ?? "x";
    const dealer = keyDealer(gs.dealerHand, roundId);
    const playerHands = keyHands(gs.playerHands, roundId);
    const serverOutcomes = gs.handOutcomes ?? [];
    const serverPayout = gs.payout ?? 0;

    const known = knownRef.current;
    const plan = new Map();
    const events = [];
    const now = performance.now();
    let t = Math.max(0, dealClockRef.current - now); // queue behind a deal still running
    let end = t;

    const deal = (card) => {
      plan.set(card.key, { delay: t });
      known.add(card.key);
      events.push([t, () => sfx.play("card", { volume: 1 })]);
      if (card.hidden) holeDownRef.current = true;
      end = Math.max(end, t + DEAL_MOVE_MS + (card.hidden ? 0 : DEAL_FLIP_MS));
      t += DEAL_GAP_MS;
    };

    const dealNew = (cards) => cards.forEach((c) => { if (!known.has(c.key)) deal(c); });

    if (known.size === 0) {
      // opening deal: player, dealer, player, dealer (hole card)
      const first = playerHands[0] ?? [];
      [first[0], dealer[0], first[1], dealer[1]].filter(Boolean).forEach(deal);
      playerHands.forEach(dealNew);
      dealNew(dealer);
    } else {
      const before = known.size;
      playerHands.forEach(dealNew);

      // settlement: the hole card turns over where it lies, then the dealer draws
      const hole = dealer[1];
      if (hole && !hole.hidden && holeDownRef.current) {
        holeDownRef.current = false;
        const start = known.size > before ? end + REVEAL_PAUSE_MS : t;
        plan.set(hole.key, { flipDelay: start });
        events.push([start, () => sfx.play("flip", { volume: 1 })]);
        end = Math.max(end, start + REVEAL_FLIP_MS);
        t = Math.max(t, start + REVEAL_FLIP_MS + DRAW_PAUSE_MS);
      }
      dealNew(dealer);
    }

    planRef.current = plan;
    dealClockRef.current = now + end;

    if (settled) {
      const { status, payout } = summarizeResult(serverOutcomes, serverPayout);
      events.push([
        end + RESULT_PAUSE_MS,
        () => {
          if (status === "win") sfx.play("win", { volume: 1 });
          else if (status === "lose") sfx.play("lose", { volume: 1 });
          setUi((prev) => ({
            ...prev,
            showResult: true,
            resultStatus: status,
            resultPayout: payout,
            handOutcomes: serverOutcomes,
          }));
          setAnimating(false);
        },
      ]);
    } else {
      events.push([end, () => setAnimating(false)]);
    }

    setAnimating(true);
    events.forEach(([at, fn]) => timersRef.current.push(setTimeout(fn, Math.max(0, at))));

    setUi((s) => ({
      ...s,
      phase: settled ? "settled" : "playerTurn",
      roundId: gs.roundId ?? s.roundId,

      dealer,
      playerHands,
      activeHandIndex: gs.activeHandIndex ?? 0,

      handBets: gs.handBets ?? [],
      handOutcomes: settled ? [] : serverOutcomes,

      settled,
      payout: serverPayout,
      busy: false,

      ...(settled ? null : { showResult: false, resultStatus: null, resultPayout: 0 }),
    }));
  };

  const handleDeal = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }

    if (!Number.isFinite(bet) || bet <= 0) { setBetError("Invalid bet amount"); return; }
    if (bet > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }
    if (!canDeal) return;

    const prevBalance = user?.balance ?? 0;

    updateBalance?.((b) => b - bet);

    setUi((s) => ({
      ...s,
      busy: true,
      showResult: false,
      resultStatus: null,
      resultPayout: 0,
      handOutcomes: [],
    }));

    try {
      const data = await apiPost(BJ_START_URL, { betAmount: bet });
      // a fresh table: the previous round's cards leave, the new ones are dealt
      resetTable();
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
    if (ui.busy || animating) return;

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

  // ---- totals (face-up cards only, so they count up as cards turn over) ----
  const faceUp = (cards) => (cards || []).filter((c) => !c.hidden && revealed.has(c.key));
  const dealerFinal = ui.phase === "settled" && ui.dealer.every((c) => !c.hidden && revealed.has(c.key));
  const dealerLabel = handTotalLabel(faceUp(ui.dealer), dealerFinal);

  const totalBet = sum(ui.handBets);
  const popupMultiplier =
    ui.resultStatus === "push" ? 1 : ui.resultStatus === "win" && totalBet > 0 ? ui.resultPayout / totalBet : 0;

  const plan = planRef.current;

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
          <img ref={deckRef} className={styles.deckEntityImg} src={deckEntityPng} alt="" draggable="false" />
        </div>

        {ui.showResult && (
          <WinPopup
            tone={ui.resultStatus === "win" ? "win" : ui.resultStatus === "push" ? "push" : "lose"}
            multiplier={popupMultiplier}
            amount={ui.resultStatus === "lose" ? totalBet : ui.resultPayout}
            amountPrefix={ui.resultStatus === "lose" ? "-" : ""}
          />
        )}

        <div className={styles.dealerArea}>
          {dealerLabel != null ? (
            <div className={styles.totalPillDark} data-bj-total="dealer">{dealerLabel}</div>
          ) : null}

          <div className={styles.fanTop}>
            {ui.dealer.map((c, i) => (
              <Card
                key={c.key}
                index={i}
                card={c}
                faceUp={!c.hidden}
                dealDelay={plan.get(c.key)?.delay}
                flipDelay={plan.get(c.key)?.flipDelay}
                flipMs={i === 1 ? REVEAL_FLIP_MS : DEAL_FLIP_MS}
                deckRef={deckRef}
                outline="none"
                cardBackSrc={cardBackSvg}
                onFaceShown={() => markRevealed(c.key)}
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
              const outcome = ui.handOutcomes?.[hIdx] ?? null;
              const outline =
                ui.showResult && ui.phase === "settled" && ["win", "lose", "push"].includes(outcome) ? outcome : "none";
              // decided (settled, or play has moved past it) and every card is face-up
              const handDone =
                (ui.phase === "settled" || hIdx < (ui.activeHandIndex ?? 0)) && hand.every((c) => revealed.has(c.key));
              const label = handTotalLabel(faceUp(hand), handDone);
              const pillTone =
                outline === "win" ? styles.totalPillWin : outline === "lose" ? styles.totalPillLose : outline === "push" ? styles.totalPillPush : "";

              return (
                <div key={hIdx} className={styles.handWrap}>
                  {label != null ? (
                    <div className={`${styles.totalPillPlayer} ${pillTone}`} data-bj-total={`hand-${hIdx}`} data-outline={outline}>
                      {label}
                    </div>
                  ) : null}

                  <div className={styles.fanBottom}>
                    {hand.map((c, i) => (
                      <Card
                        key={c.key}
                        index={i}
                        card={c}
                        faceUp={!c.hidden}
                        dealDelay={plan.get(c.key)?.delay}
                        flipMs={DEAL_FLIP_MS}
                        deckRef={deckRef}
                        outline={outline}
                        cardBackSrc={cardBackSvg}
                        onFaceShown={() => markRevealed(c.key)}
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

/**
 * One card on the table.
 *
 * `dealDelay` (read once, on mount) = this card is being dealt: it waits that
 * long, slides from the deck to its place face-down, and turns over after it
 * lands when `faceUp`. Cards without it (already on the table — e.g. moved to
 * a new hand by a split) simply appear in place.
 * When `faceUp` later turns true (the dealer's hole card) it turns over in
 * place after `flipDelay`.
 */
function Card({ index, card, faceUp = true, dealDelay, flipDelay = 0, flipMs = DEAL_FLIP_MS, deckRef, outline = "none", cardBackSrc, onFaceShown }) {
  const r = card?.r;
  const s = card?.s;
  const red = s ? isRedSuit(s) : false;
  const suitSrc = s ? suitIconSrc(s) : null;

  const motionRef = useRef(null);
  const dealRef = useRef(dealDelay);
  const [shownFace, setShownFace] = useState(() => (dealDelay == null ? faceUp : false));
  const faceShownRef = useRef(onFaceShown);
  faceShownRef.current = onFaceShown;

  // start turning over now; report once the face is showing
  const turnOver = () => {
    setShownFace(true);
    return setTimeout(() => faceShownRef.current?.(), flipMs * FACE_SHOWN_AT);
  };

  // a card that is simply on the table (not being dealt) counts right away
  useEffect(() => {
    if (dealRef.current == null && faceUp) faceShownRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deal: deck -> place (WAAPI, so it runs off the compositor), then turn over.
  useLayoutEffect(() => {
    const delay = dealRef.current;
    if (delay == null) return undefined;

    let anim = null;
    let landTimer = null;
    let faceTimer = null;
    let live = true;
    const el = motionRef.current;
    const deck = deckRef?.current;
    if (el && deck && typeof el.animate === "function") {
      const a = el.getBoundingClientRect();
      const d = deck.getBoundingClientRect();
      if (a.width > 0 && d.width > 0) {
        const scale = Math.min(1, (d.width * DECK_CARD_WIDTH) / a.width);
        const fromX = d.left + d.width / 2 - (a.left + a.width / 2);
        const fromY = d.top + d.height * DECK_CARD_BOTTOM - (a.height * scale) / 2 - (a.top + a.height / 2);
        anim = el.animate(
          [
            { transform: `translate(${fromX}px, ${fromY}px) scale(${scale})`, opacity: 0, offset: 0 },
            { opacity: 1, offset: 0.1 },
            { transform: "translate(0px, 0px) scale(1)", opacity: 1, offset: 1 },
          ],
          { duration: DEAL_MOVE_MS, delay, easing: DEAL_EASE, fill: "backwards" }
        );
      }
    }

    // turn over only once it has landed: on the move's own finish event
    // (a timer could beat a move the compositor started a frame late)
    const land = () => {
      if (live && faceUp) faceTimer = turnOver();
    };
    if (anim) anim.onfinish = land;
    else landTimer = setTimeout(land, delay + DEAL_MOVE_MS);

    return () => {
      live = false;
      clearTimeout(landTimer);
      clearTimeout(faceTimer);
      if (anim) {
        anim.onfinish = null;
        anim.cancel();
      }
    };
    // mount-only: a card is dealt once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hole card turning over at settlement (in place, no move).
  const prevFaceUp = useRef(faceUp);
  useEffect(() => {
    if (prevFaceUp.current === faceUp) return undefined;
    prevFaceUp.current = faceUp;
    if (!faceUp) {
      setShownFace(false);
      return undefined;
    }
    let faceTimer = null;
    const t = setTimeout(() => {
      faceTimer = turnOver();
    }, Math.max(0, flipDelay || 0));
    return () => {
      clearTimeout(t);
      clearTimeout(faceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceUp]);

  const overlapX = 34;
  const overlapY = 12;
  const x = index * overlapX;
  const y = index * overlapY;

  const outlineClass =
    outline === "win"
      ? styles.cardOutlineWin
      : outline === "lose"
        ? styles.cardOutlineLose
        : outline === "push"
          ? styles.cardOutlinePush
          : "";

  return (
    <div
      className={styles.cardSlot}
      style={{ transform: `translate(${x}px, ${y}px)`, zIndex: 10 + index }}
      data-bj-card={faceUp && r ? `${r}${s ? s[0] : ""}` : "hidden"}
      data-face={shownFace ? "up" : "down"}
    >
      <div ref={motionRef} className={styles.cardMotion}>
        <div className={`${styles.card} ${outlineClass}`} style={{ "--flip-ms": `${flipMs}ms` }}>
          <div className={`${styles.flipWrap} ${shownFace ? styles.flipFaceUp : ""}`}>
            <div className={`${styles.flipFace} ${styles.flipFront}`}>
              {r ? (
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
              ) : null}
            </div>
            <div className={`${styles.flipFace} ${styles.flipBack}`}>
              <div className={styles.cardBackWrap}>
                <img className={styles.cardBackImg} src={cardBackSrc} alt="" draggable="false" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
