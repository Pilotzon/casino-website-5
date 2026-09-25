import { useEffect, useMemo, useRef, useState } from "react";
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

// ✅ Flip sounds (midwin.mp3 is currently a copy of Win.mp3 — replace the
// file with the real mid-sequence win sting; the trigger is wired below)
import flipRoundMp3 from "../../assets/flip/Flip.mp3";
import flipWinMp3 from "../../assets/flip/Win.mp3";
import flipMidWinMp3 from "../../assets/flip/midwin.mp3";
import CurrencyIcon from "../common/CurrencyIcon";

function Flip({ gameRow, soundEnabled = true, soundVolume = 0.8 }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const sfx = useGameAudio(
    {
      flip: flipRoundMp3,
      win: flipWinMp3,
      midwin: flipMidWinMp3,
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
      const inner = el.clientWidth - PAD;
      const n = Math.max(1, Math.floor((inner + MIN_GAP) / (SLOT_W + MIN_GAP)));
      setHistorySlots(Math.min(96, n));
    };
    measure();
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
  // Round flow: bet FIRST (amount locked in), THEN pick Heads/Tails —
  // the video only plays after a side is chosen. A win offers Continue
  // (the payout rides as the next bet ≈ doubling) or Collect.
  const [stage, setStage] = useState("bet"); // bet | choose | flipping
  const [chainBet, setChainBet] = useState(0); // riding stake for the next flip
  const [originalBet, setOriginalBet] = useState(0); // the sequence's first stake
  const [chainCount, setChainCount] = useState(0); // consecutive wins this round
  const [history, setHistory] = useState([]); // this round's flips (reset per round)

  // ✅ Win popup (Limbo-like)
  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winPayout, setWinPayout] = useState(0);
  const [winMult, setWinMult] = useState(1.98);

  // video state
  const [phase, setPhase] = useState("idle_once"); // idle_once | transition | hold
  const [videoSrc, setVideoSrc] = useState(startingOnce);

  // used only to choose next transition
  const [currentSide, setCurrentSide] = useState("heads");

  // lock while transition video is playing
  const [isBusy, setIsBusy] = useState(false);
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betAmount).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betAmount, isLocked, betErrorMessage]);

  // keep last result until video ends (history + balance + popup after)
  const pendingResultRef = useRef(null);

  const videoRef = useRef(null);
  // Sync flip guard (state updates lag a frame — this ref can't double-fire
  // on rapid clicks) + play token so overlapping video sequences never stack.
  const flipBusyRef = useRef(false);
  const playTokenRef = useRef(0);
  // Snappier flips: every transition plays once, faster than realtime.
  const FLIP_PLAYBACK_RATE = 1.5;

  // payout is 1.98x (see totalProfit below for the live profit math)

  const allVideos = useMemo(() => [startingOnce, h2h, h2t, t2h, t2t], []);

  const pickTransitionVideo = (fromSide, toSide) => {
    if (fromSide === "heads" && toSide === "heads") return h2h;
    if (fromSide === "heads" && toSide === "tails") return h2t;
    if (fromSide === "tails" && toSide === "tails") return t2t;
    return t2h;
  };

  // Preload/warm all videos to minimize delays
  useEffect(() => {
    const els = allVideos.map((src) => {
      const v = document.createElement("video");
      v.src = src;
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      try {
        v.load();
      } catch { }
      return v;
    });
    return () => {
      els.length = 0;
    };
  }, [allVideos]);

  const waitForEvent = (el, eventName, timeoutMs = 2500) =>
    new Promise((resolve) => {
      if (!el) return resolve(false);

      let done = false;
      const onEvent = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(true);
      };

      const cleanup = () => {
        el.removeEventListener(eventName, onEvent);
        clearTimeout(t);
      };

      el.addEventListener(eventName, onEvent, { once: true });
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        resolve(false);
      }, timeoutMs);
    });

  const setAndPlay = async (src) => {
    // a newer sequence cancels this one at every await — the video can
    // never be told to play twice for one flip
    const myPlay = ++playTokenRef.current;

    setVideoSrc(src);

    // wait for React to apply src
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    if (playTokenRef.current !== myPlay) return;

    const v = videoRef.current;
    if (!v) return;

    v.loop = false;

    try {
      v.pause();
    } catch { }
    try {
      v.load();
    } catch { }

    await waitForEvent(v, "canplay", 2500);
    if (playTokenRef.current !== myPlay) return;

    try {
      v.currentTime = 0;
    } catch { }

    v.playbackRate = FLIP_PLAYBACK_RATE;

    try {
      await v.play();
    } catch {
      // autoplay may fail for initial idle_once on some browsers; bet click will work later
    }
  };

  // On mount: the coin sits frozen on the first frame — nothing plays
  // until a side is chosen (see flip()).
  useEffect(() => {
    setPhase("hold");
    setVideoSrc(startingOnce);
    const v = videoRef.current;
    if (!v) return undefined;
    const freezeAtStart = () => {
      try {
        v.pause();
        if (v.currentTime !== 0) v.currentTime = 0;
      } catch { /* metadata not ready yet — loadeddata retries */ }
    };
    freezeAtStart();
    // one-shot: freezes the initial frame only, then detaches so later
    // flip loads are never paused/rewound by a stale listener
    v.addEventListener("loadeddata", freezeAtStart, { once: true });
    return () => v.removeEventListener("loadeddata", freezeAtStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const freezeLastFrame = () => {
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch { }
    }
    setPhase("hold");
  };

  const onVideoEnded = () => {
    if (phase === "idle_once") {
      freezeLastFrame();
      return;
    }

    if (phase === "transition") {
      freezeLastFrame();

      const pending = pendingResultRef.current;
      pendingResultRef.current = null;

      if (pending) {
        setHistory((prev) => [pending, ...prev].slice(0, 32));

        if (typeof pending.balance === "number") {
          updateBalance(pending.balance);
        }

        // ✅ mid-sequence win sting after video ends (no popup here — the
        // popup waits for an explicit cashout, and never shows on a loss)
        if (pending.won) {
          sfx.play("midwin", { volume: 1 });
          const payout = Number(pending.payout || 0);
          setWinPayout(payout);
          const flipBet = Number(pending.flipBet || 0);
          setWinMult(flipBet > 0 ? payout / flipBet : 1.98);
          // Continue: the payout rides as the next flip's stake
          setChainBet(payout);
          setChainCount((c) => c + 1);
          setStage("choose");
        } else {
          // Loss ends the round — back to placing a bet
          setChainBet(0);
          setOriginalBet(0);
          setChainCount(0);
          setStage("bet");
        }
      } else {
        setStage("bet");
      }

      flipBusyRef.current = false;
      setIsBusy(false);
    }
  };

  // Step 1 — place the bet (amount locked, history reset). No video yet:
  // the player picks Heads/Tails next, and only then does the coin flip.
  const handleBet = () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    if (isBusy || stage !== "bet") return;

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }

    // reset popup + history for the new round
    setShowWinPopup(false);
    setWinPayout(0);
    setHistory([]);

    setChainBet(amount);
    setOriginalBet(amount);
    setChainCount(0);
    setStage("choose");
  };

  // Step 2 — a side is chosen: the bet rides, the coin flips.
  const flip = async (side) => {
    if (stage !== "choose" || isBusy || flipBusyRef.current) return;
    flipBusyRef.current = true;

    setStage("flipping");
    setIsBusy(true);

    // ✅ round start sound
    sfx.play("flip", { volume: 1 });

    try {
      const response = await gamesAPI.playFlip({ betAmount: chainBet, selectedSide: side });
      const result = response.data.result;

      const fromSide = currentSide;
      const toSide = result.outcome;

      setCurrentSide(toSide);
      pendingResultRef.current = { ...result, flipBet: chainBet };

      const transitionSrc = pickTransitionVideo(fromSide, toSide);
      setPhase("transition");
      await setAndPlay(transitionSrc);
    } catch (error) {
      pendingResultRef.current = null;
      flipBusyRef.current = false;
      setIsBusy(false);
      setStage("choose");
      toast.error(error.response?.data?.message || "Bet failed");
    }
  };

  // Walk away with the winnings (already paid out — just ends the round).
  // The win popup appears ONLY here, on explicit cashout — never mid-chain,
  // and never on a loss without a cashout.
  const handleCollect = () => {
    if (stage !== "choose" || chainCount === 0) return;
    const payout = Number(chainBet || 0);
    setWinPayout(payout);
    setWinMult(originalBet > 0 ? payout / originalBet : 1.98);
    setShowWinPopup(true);
    sfx.play("win", { volume: 1 });
    setChainBet(0);
    setOriginalBet(0);
    setChainCount(0);
    setStage("bet");
  };

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * factor).toFixed(2));
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("flip", stage !== "bet");


  const handleRandomPick = () => {
    if (stage !== "choose" || isBusy) return;
    flip(Math.random() < 0.5 ? "heads" : "tails");
  };

  const roundActive = stage !== "bet";
  const awaitingChoice = stage === "choose";
  // Total Profit: while a sequence is live it is the locked-in gain
  // (riding stake − original stake); otherwise the entered bet × 0.98.
  const totalProfit = roundActive
    ? chainBet - originalBet
    : (parseFloat(betAmount || 0) || 0) * 0.98;

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
                disabled={roundActive}
              />
              <CurrencyIcon className={styles.btcIcon} />
            </div>
            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isBusy || roundActive}>
                ½
              </button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isBusy || roundActive}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <span className="ui-bet-wrap">
          {/* No cancel exists: once a bet is placed the round cannot be
              reversed — pre-first-flip there is no main action (the player
              picks a side instead). */}
          {stage === "choose" && chainCount === 0 ? null : (
          <button
            className={styles.betButton}
            onClick={stage === "bet" ? handleBet : handleCollect}
            disabled={isLocked || stage === "flipping"}
            data-bet-sound="true"
            title={isLocked ? betErrorMessage : undefined}>
          {stage === "flipping" ? "Flipping..." : stage === "choose" ? "Cashout" : "Bet"}
          </button>
          )}
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        <button
          className={styles.randomButton}
          disabled={!awaitingChoice || isBusy}
          type="button"
          onClick={handleRandomPick}
        >
          Random Pick
        </button>

        <div className={styles.sideSelector}>
          <button
            className={styles.sideBtn}
            onClick={() => flip("heads")}
            disabled={!awaitingChoice || isBusy}
            type="button"
          >
            <span className={styles.textSide}>Heads</span>
            <div className={styles.dotHeads}></div>
          </button>
          <button
            className={styles.sideBtn}
            onClick={() => flip("tails")}
            disabled={!awaitingChoice || isBusy}
            type="button"
          >
            <span className={styles.textSide}>Tails</span>
            <div className={styles.dotTails}></div>
          </button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>{roundActive ? "Total Profit" : "Total Profit (0.98×)"}</span>
            <span>$0.00</span>
          </div>
          <div className={`${styles.readonlyInput} ${styles.profitInput}`}>
            <input type="text" value={Number(totalProfit || 0).toFixed(2)} readOnly />
            <CurrencyIcon className={styles.btcIcon} />
          </div>
        </div>
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* ✅ Limbo-style win popup */}
        {showWinPopup && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupMult}>{Number(winMult || 1.98).toFixed(2)}×</div>
            <div className={styles.winPopupDivider} aria-hidden="true" />
            <div className={styles.winPopupAmount}>{Number(winPayout || 0).toFixed(2)}<CurrencyIcon /></div>
          </div>
        )}

        <div className={styles.coinVideoWrap}>
          <video
            ref={videoRef}
            className={styles.coinVideo}
            src={videoSrc}
            preload="auto"
            playsInline
            muted
            onEnded={onVideoEnded}
          />
        </div>

        <div className={styles.historyBar}>
          <div className={styles.historyLabel}>History</div>
          <div className={styles.historyGrid} ref={historyGridRef}>
            {[...Array(historySlots)].map((_, i) => {
              const res = history[i];
              return (
                <div key={i} className={styles.slot}>
                  {res && (
                    <div
                      className={`${styles.historyIcon} ${res.outcome === "heads" ? styles.hHead : styles.hTail
                        }`}
                    />
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