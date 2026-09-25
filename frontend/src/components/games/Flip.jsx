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

// ✅ Flip sounds
import flipRoundMp3 from "../../assets/flip/Flip.mp3";
import flipWinMp3 from "../../assets/flip/Win.mp3";
import CurrencyIcon from "../common/CurrencyIcon";

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
  const [selectedSide, setSelectedSide] = useState("heads");
  const [history, setHistory] = useState([]);

  // ✅ Win popup (Limbo-like)
  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winPayout, setWinPayout] = useState(0);

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

  // payout is 1.98x, profit on win is bet*(1.98-1)=0.98x
  const profit = (parseFloat(betAmount || 0) || 0) * 0.98;

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
    setVideoSrc(src);

    // wait for React to apply src
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

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

    try {
      v.currentTime = 0;
    } catch { }

    try {
      await v.play();
    } catch {
      // autoplay may fail for initial idle_once on some browsers; bet click will work later
    }
  };

  // On mount: play starting_once exactly once
  useEffect(() => {
    (async () => {
      setPhase("idle_once");
      setVideoSrc(startingOnce);
      await setAndPlay(startingOnce);
    })();
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

        // ✅ win sound + popup only after video ends
        if (pending.won) {
          sfx.play("win", { volume: 1 });
          setWinPayout(Number(pending.payout || 0));
          setShowWinPopup(true);
        }
      }

      setIsBusy(false);
    }
  };

  const handleBet = async () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    if (isBusy) return;

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }

    // reset popup each round
    setShowWinPopup(false);
    setWinPayout(0);

    setIsBusy(true);

    // ✅ round start sound
    sfx.play("flip", { volume: 1 });

    try {
      const response = await gamesAPI.playFlip({ betAmount: amount, selectedSide });
      const result = response.data.result;

      const fromSide = currentSide;
      const toSide = result.outcome;

      setCurrentSide(toSide);
      pendingResultRef.current = result;

      const transitionSrc = pickTransitionVideo(fromSide, toSide);
      setPhase("transition");
      await setAndPlay(transitionSrc);
    } catch (error) {
      pendingResultRef.current = null;
      setIsBusy(false);
      toast.error(error.response?.data?.message || "Bet failed");
    }
  };

  const adjustBet = (factor) => {
    const curr = parseFloat(betAmount) || 0;
    setBetAmount((curr * factor).toFixed(2));
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("flip", isBusy || phase === 'transition');


  const handleRandomPick = () => {
    if (isBusy) return;
    setSelectedSide(Math.random() < 0.5 ? "heads" : "tails");
  };

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
              />
              <CurrencyIcon className={styles.btcIcon} />
            </div>
            <div className={styles.splitButtons}>
              <button onClick={() => adjustBet(0.5)} disabled={isLocked || isBusy}>
                ½
              </button>
              <div className={styles.divider}></div>
              <button onClick={() => adjustBet(2)} disabled={isLocked || isBusy}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <span className="ui-bet-wrap">
          <button
            className={styles.betButton}
            onClick={handleBet}
            disabled={isLocked || isBusy}
            data-bet-sound="true"
            title={isLocked ? betErrorMessage : undefined}>
          {isBusy ? "Flipping..." : "Bet"}
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        <button
          className={styles.randomButton}
          disabled={isBusy}
          type="button"
          onClick={handleRandomPick}
        >
          Random Pick
        </button>

        <div className={styles.sideSelector}>
          <button
            className={`${styles.sideBtn} ${selectedSide === "heads" ? styles.activeSide : ""}`}
            onClick={() => setSelectedSide("heads")}
            disabled={isBusy}
            type="button"
          >
            <span className={styles.textSide}>Heads</span>
            <div className={styles.dotHeads}></div>
          </button>
          <button
            className={`${styles.sideBtn} ${selectedSide === "tails" ? styles.activeSide : ""}`}
            onClick={() => setSelectedSide("tails")}
            disabled={isBusy}
            type="button"
          >
            <span className={styles.textSide}>Tails</span>
            <div className={styles.dotTails}></div>
          </button>
        </div>

        <div className={styles.controlGroup}>
          <div className={styles.labelRow}>
            <span>Total Profit (0.98×)</span>
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
        {/* ✅ Limbo-style win popup */}
        {showWinPopup && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupTitle}>YOU WON</div>
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