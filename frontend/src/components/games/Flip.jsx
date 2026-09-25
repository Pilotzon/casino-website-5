import { useCallback, useEffect, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import styles from "./flip.module.css";

import useGameAudio from "../../hooks/useGameAudio";

// Videos only
import startingOnce from "../../assets/flip/starting_once_animation.mp4";
import h2h from "../../assets/flip/flipping_heads-to-heads.mp4";
import h2t from "../../assets/flip/flipping_heads-to-tails.mp4";
import t2h from "../../assets/flip/flipping_tails-to-heads.mp4";
import t2t from "../../assets/flip/flipping_tails-to-tails.mp4";

// ✅ Flip sounds
import flipRoundMp3 from "../../assets/flip/Flip.mp3";
import flipWinMp3 from "../../assets/flip/Win.mp3";
import CurrencyIcon from "../common/CurrencyIcon";
import WinPopup, { formatPopupMultiplier } from "../common/WinPopup";

/* ============================================================================
 * Coin Flip — one round, many flips
 *
 *   Bet ─► round opens (stake taken); the coin freezes on the FIRST frame of
 *          its next flip video and waits
 *   Heads / Tails / Random Pick ─► that video plays; the server's verdict
 *          decides which one (the "from" side is what the coin shows now)
 *     · win  → the round stays open: the multiplier doubles (1.98×, 3.96×,
 *              7.92× …) and the coin waits for the next call
 *     · lose → the round is over
 *   Cashout ─► pays bet × multiplier (after at least one win)
 *
 * The history bar lists THIS round's flips and is cleared by every new Bet.
 * An open round lives on the server: reloading the page brings it back.
 *
 * Every clip is its own <video> element (stacked, only the active one shows),
 * so going from the frozen first frame to the playing flip never reloads a
 * source — heads→heads and heads→tails share their first frame, as do the
 * two tails clips, so the swap is seamless.
 * ==========================================================================*/
const CLIPS = { start: startingOnce, h2h, h2t, t2h, t2t };
const clipKey = (from, to) => `${from === "tails" ? "t" : "h"}2${to === "tails" ? "t" : "h"}`;
const FLIP_BASE_MULTIPLIER = 1.98;

function Flip({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    {
      flip: flipRoundMp3,
      win: flipWinMp3,
    },
    { enabled: soundEnabled, volume: soundVolume }
  );

  const [betAmount, setBetAmount] = useState("");

  // History strip: render exactly as many slots as fit the strip's inner
  // width (per device) — never a horizontal scrollbar; the gaps flex so
  // the row is always centred.
  const historyGridRef = useRef(null);
  const [historySlots, setHistorySlots] = useState(24);
  useEffect(() => {
    const el = historyGridRef.current;
    if (!el) return undefined;
    const SLOT_W = 22, MIN_GAP = 4, PAD = 20;
    const measure = () => {
      // not laid out (hidden / no layout yet): keep the last count
      if (!(el.clientWidth > 0)) return;
      const inner = el.clientWidth - PAD;
      const n = Math.max(1, Math.floor((inner + MIN_GAP) / (SLOT_W + MIN_GAP)));
      setHistorySlots(Math.min(96, n));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const { isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);

  // ---- round state -----------------------------------------------------------
  // round: the server's public round ({ roundId, betAmount, wins,
  // currentMultiplier, nextMultiplier, canCashout, canFlip, maxFlips }) or null
  const [round, setRound] = useState(null);
  const [flips, setFlips] = useState([]); // this round's flips, oldest first
  const [busy, setBusy] = useState(false); // a request is out or a flip is playing
  const [popup, setPopup] = useState(null); // { multiplier, amount } after a cashout

  // ---- coin videos -------------------------------------------------------------
  const videoRefs = useRef({});
  const [activeClip, setActiveClip] = useState("start");
  const coinSideRef = useRef("heads"); // the side the coin is showing
  const playingRef = useRef(null); // { key, onDone } while a flip clip plays
  const safetyRef = useRef(null);

  const video = (key) => videoRefs.current[key];

  const quiet = (fn) => {
    try {
      fn();
    } catch {
      /* media API not available (tests) */
    }
  };

  /** Freeze the coin on the first frame of its next flip (from `side`). */
  const showFirstFrame = useCallback((side) => {
    const key = clipKey(side, side);
    const v = video(key);
    if (v) {
      quiet(() => v.pause());
      quiet(() => {
        v.currentTime = 0;
      });
    }
    const start = video("start");
    if (start) quiet(() => start.pause());
    setActiveClip(key);
  }, []);

  /** Rest the coin on `side` (the last frame of a flip that ends there). */
  const showRest = useCallback((side) => {
    const key = clipKey(side, side);
    const v = video(key);
    if (v) {
      quiet(() => v.pause());
      quiet(() => {
        if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration;
      });
    }
    setActiveClip(key);
  }, []);

  const endFlipClip = () => {
    clearTimeout(safetyRef.current);
    const playing = playingRef.current;
    playingRef.current = null;
    playing?.onDone();
  };

  /** Play the flip from→to; `onDone` runs when the clip ends (or can't play). */
  const playFlipClip = (from, to, onDone) => {
    const key = clipKey(from, to);
    const v = video(key);
    playingRef.current = { key, onDone };
    setActiveClip(key);
    if (!v) return endFlipClip();
    quiet(() => {
      v.currentTime = 0;
    });
    // never let a stuck video hold the round: give up a beat after its length
    const len = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 2;
    safetyRef.current = setTimeout(endFlipClip, len * 1000 + 1500);
    let started;
    try {
      started = v.play();
    } catch {
      started = null;
    }
    if (!started || typeof started.then !== "function") return endFlipClip();
    started.catch(() => endFlipClip());
    return undefined;
  };

  const onClipEnded = (key) => {
    if (playingRef.current?.key === key) endFlipClip();
  };

  useEffect(() => () => clearTimeout(safetyRef.current), []);

  // On mount: bring back an open round, otherwise play the intro once.
  useEffect(() => {
    let cancelled = false;
    const intro = () => {
      const v = video("start");
      if (!v) return;
      quiet(() => {
        v.currentTime = 0;
      });
      try {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* no media in tests */
      }
    };

    if (!isAuthenticated) {
      // logged out (or never in): nothing of a previous session's round stays
      setRound(null);
      setFlips([]);
      intro();
      return undefined;
    }

    (async () => {
      let open = null;
      try {
        const res = await gamesAPI.activeFlip();
        open = res?.data?.result ?? null;
      } catch {
        open = null;
      }
      if (cancelled) return;
      if (open?.inProgress) restoreRound(open);
      else intro();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const restoreRound = (open) => {
    const past = Array.isArray(open.flips) ? open.flips : [];
    setRound(open);
    setFlips(past);
    setPopup(null);
    if (open.betAmount) setBetAmount(String(open.betAmount));
    const side = past.length ? past[past.length - 1].outcome : "heads";
    coinSideRef.current = side;
    showFirstFrame(side);
  };

  const loadOpenRound = async () => {
    try {
      const res = await gamesAPI.activeFlip();
      const open = res?.data?.result;
      if (open?.inProgress) {
        restoreRound(open);
        toast.info("You have a flip round open — finish it first");
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  };

  // ---- actions --------------------------------------------------------------------
  const handleBet = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    if (busy || round) return;

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }

    setBusy(true);
    setPopup(null);
    try {
      const res = await gamesAPI.startFlip({ betAmount: amount });
      const r = res.data.result;
      if (typeof r.balance === "number") updateBalance(r.balance);
      setRound(r);
      setFlips([]); // the history bar starts over with every round
      showFirstFrame(coinSideRef.current);
    } catch (error) {
      if (error?.response?.status === 409 && error?.response?.data?.code === "FLIP_ROUND_OPEN") {
        if (!(await loadOpenRound())) toast.error(error.response.data.message || "Finish your current flip round first");
      } else {
        toast.error(error?.response?.data?.message || "Bet failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async (side) => {
    if (!round || busy || !round.canFlip) return;
    const called = side === "random" ? (Math.random() < 0.5 ? "heads" : "tails") : side;

    setBusy(true);
    sfx.play("flip", { volume: 1 });

    let r;
    try {
      const res = await gamesAPI.chooseFlip({ roundId: round.roundId, side: called });
      r = res.data.result;
    } catch (error) {
      setBusy(false);
      toast.error(error?.response?.data?.message || "Flip failed");
      // a stale round (finished elsewhere) — resync with the server
      if (error?.response?.status === 400) {
        if (!(await loadOpenRound())) setRound(null);
      }
      return;
    }

    const from = coinSideRef.current;
    const to = r.outcome;
    coinSideRef.current = to;

    // the verdict shows once the coin has landed
    playFlipClip(from, to, () => {
      const past = Array.isArray(r.flips) ? r.flips : null;
      setFlips((prev) => past ?? [...prev, { side: r.side, outcome: r.outcome, won: r.won }]);
      if (r.lost) {
        setRound(null);
        showRest(to);
      } else {
        sfx.play("win", { volume: 1 });
        setRound(r);
        if (r.canFlip) showFirstFrame(to);
        else showRest(to);
      }
      setBusy(false);
    });
  };

  const handleCashout = async () => {
    if (!round?.canCashout || busy) return;
    setBusy(true);
    try {
      const res = await gamesAPI.cashoutFlip({ roundId: round.roundId });
      const r = res.data.result;
      if (typeof r.balance === "number") updateBalance(r.balance);
      sfx.play("win", { volume: 1 });
      setPopup({ multiplier: r.multiplier, amount: r.payout });
      setRound(null);
      showRest(coinSideRef.current);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Cashout failed");
      if (error?.response?.status === 400 && !(await loadOpenRound())) setRound(null);
    } finally {
      setBusy(false);
    }
  };

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * factor).toFixed(2));
  };

  // Warn before a page refresh while a flip is in the air (see RefreshGuard).
  // An open round between flips is kept by the server and restored on load.
  useActiveBetFlag("flip", busy && Boolean(round));

  const inRound = Boolean(round);
  const canPick = inRound && !busy && Boolean(round?.canFlip);
  const bet = inRound ? Number(round.betAmount) || 0 : parseFloat(betAmount || 0) || 0;
  const wins = round?.wins ?? 0;
  // profit shown: the cash-out value mid-round; a first win's profit otherwise
  const profitMultiplier = inRound ? (wins > 0 ? Number(round.currentMultiplier) : 1) : FLIP_BASE_MULTIPLIER;
  const profit = bet * (profitMultiplier - 1);

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
                disabled={inRound}
              />
              <CurrencyIcon className={styles.btcIcon} />
            </div>
            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || busy || inRound}>
                ½
              </button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || busy || inRound}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <span className="ui-bet-wrap">
          {inRound ? (
            <button
              className={styles.betButton}
              onClick={handleCashout}
              disabled={isLocked || busy || !round.canCashout}
              data-flip-cashout="true"
              title={!round.canCashout ? "Win a flip to cash out" : undefined}
            >
              Cashout
            </button>
          ) : (
            <button
              className={styles.betButton}
              onClick={handleBet}
              disabled={isLocked || busy}
              data-bet-sound="true"
              title={isLocked ? betErrorMessage : undefined}>
            {busy ? "..." : "Bet"}
            </button>
          )}
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        <button
          className={styles.randomButton}
          disabled={!canPick}
          type="button"
          onClick={() => handlePick("random")}
          title={!inRound ? "Place a bet first" : undefined}
        >
          Random Pick
        </button>

        <div className={styles.sideSelector}>
          <button
            className={styles.sideBtn}
            onClick={() => handlePick("heads")}
            disabled={!canPick}
            type="button"
            title={!inRound ? "Place a bet first" : undefined}
          >
            <span className={styles.textSide}>Heads</span>
            <div className={styles.dotHeads}></div>
          </button>
          <button
            className={styles.sideBtn}
            onClick={() => handlePick("tails")}
            disabled={!canPick}
            type="button"
            title={!inRound ? "Place a bet first" : undefined}
          >
            <span className={styles.textSide}>Tails</span>
            <div className={styles.dotTails}></div>
          </button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Total Profit ({formatPopupMultiplier(profitMultiplier)})</span>
            <span>$0.00</span>
          </div>
          <div className={`${styles.readonlyInput} ${styles.profitInput}`}>
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
        {popup && <WinPopup multiplier={popup.multiplier} amount={popup.amount} />}

        <div className={styles.coinVideoWrap} data-flip-clip={activeClip}>
          {Object.entries(CLIPS).map(([key, src]) => (
            <video
              key={key}
              ref={(el) => {
                if (el) videoRefs.current[key] = el;
                else delete videoRefs.current[key];
              }}
              className={`${styles.coinVideo} ${activeClip === key ? styles.coinVideoActive : ""}`}
              src={src}
              preload="auto"
              playsInline
              muted
              onEnded={() => onClipEnded(key)}
              aria-hidden={activeClip === key ? undefined : "true"}
            />
          ))}
        </div>

        <div className={styles.historyBar}>
          <div className={styles.historyHead}>
            <div className={styles.historyLabel}>History</div>
            {inRound && round.canFlip ? (
              <div className={styles.historyNext} data-flip-next>
                Next <b>{formatPopupMultiplier(round.nextMultiplier)}</b>
              </div>
            ) : null}
          </div>
          <div className={styles.historyGrid} ref={historyGridRef} data-flip-history>
            {[...Array(historySlots)].map((_, i) => {
              // a streak longer than the strip keeps its newest flips in view
              const res = flips[Math.max(0, flips.length - historySlots) + i];
              return (
                <div
                  key={i}
                  className={`${styles.slot} ${res ? (res.won ? styles.slotWon : styles.slotLost) : ""}`}
                  data-flip-slot={res ? `${res.outcome}-${res.won ? "won" : "lost"}` : undefined}
                >
                  {res && (
                    <div className={`${styles.historyIcon} ${res.outcome === "heads" ? styles.hHead : styles.hTail}`} />
                  )}
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

export default Flip;
