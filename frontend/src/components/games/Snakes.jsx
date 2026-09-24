import { useEffect, useMemo, useRef, useState } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";
import SnakeIcon from "../../assets/snakes/SnakeIcon";
import styles from "./Snakes.module.css";
import Modal from "../common/Modal";

// Import sounds
import diceRollSound from "../../assets/snakes/DiceRoll.mp3";
import winSound from "../../assets/snakes/Win.mp3";
import loseSound from "../../assets/snakes/Lose.mp3";
import revealedSound from "../../assets/snakes/Revealed.mp3";
import cashoutSound from "../../assets/snakes/Cashout.mp3";
import betSound from "../../assets/Bet.mp3";
import multUpSound from "../../assets/snakes/MultUp.mp3";

const DIFFS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "expert", label: "Expert" },
  { value: "master", label: "Master" },
];

const PERIMETER = [
  [0, 0], [1, 0], [2, 0], [3, 0],
  [3, 1], [3, 2], [3, 3],
  [2, 3], [1, 3], [0, 3],
  [0, 2], [0, 1],
];

const PERIMETER_ROWS = PERIMETER.map(([, r]) => r);
const TOTAL_TILES = 12;

const fmt2 = (n) => Number(n || 0).toFixed(2);

function isMobileNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function nextRollWays(currPos, targetPos) {
  const dist = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  let ways = 0;
  for (const [sumStr, w] of Object.entries(dist)) {
    const sum = Number(sumStr);
    const to = (currPos + sum) % TOTAL_TILES;
    if (to === targetPos) ways += w;
  }
  return ways;
}

// Dice dot patterns for values 1-6
const DICE_PATTERNS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const DIFF_THEME = {
  easy: { hoverBase: "#2299F2", hoverBg: "#55DFFF", startArrow: "#3B7589" },
  medium: { hoverBase: "#105EB4", hoverBg: "#047BFF", startArrow: "#225689" },
  hard: { hoverBase: "#008A01", hoverBg: "#02E700", startArrow: "#217839" },
  expert: { hoverBase: "#7100C7", hoverBg: "#962EFF", startArrow: "#5C5C89" },
  master: { hoverBase: "#FF7F00", hoverBg: "#FFC200", startArrow: "#706C39" },
};

function DiceFace({  value, isRolling, isPressed, isUnpress }) {
  const pattern = DICE_PATTERNS[value] || [];

  const dieClass = [
    styles.die,
    isRolling ? styles.dieRolling : "",
    isPressed ? styles.diePressed : "",
    isUnpress ? styles.dieUnpress : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={dieClass}>
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={`${styles.dieDot} ${pattern.includes(i) ? styles.visible : ""}`}
        />
      ))}
    </div>
  );
}

export default function Snakes({ gameRow }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

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

  const [isBusy, setIsBusy] = useState(false);

  const [roundId, setRoundId] = useState(null);
  const [status, setStatus] = useState("idle");

  const [board, setBoard] = useState(null);

  const gameBoardRef = useRef(null);
  const layoutSeqRef = useRef(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const layoutRetryRef = useRef(0);

  const [currentPosition, setCurrentPosition] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [walkingFrom, setWalkingFrom] = useState(null);
  const [walkingDestination, setWalkingDestination] = useState(null);
  const [enteringTile, setEnteringTile] = useState(null);
  const [exitingTile, setExitingTile] = useState(null);

  const [diceFaces, setDiceFaces] = useState({ d1: 1, d2: 1 });
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceLeftPressed, setDiceLeftPressed] = useState(false);
  const [diceRightPressed, setDiceRightPressed] = useState(false);
  const [diceUnpressLeft, setDiceUnpressLeft] = useState(false);
  const [diceUnpressRight, setDiceUnpressRight] = useState(false);

  const [rolledOnce, setRolledOnce] = useState(false);

  const [totalMultiplier, setTotalMultiplier] = useState(1);
  const [displayedMultiplier, setDisplayedMultiplier] = useState(1);
  const [isMultiplierAnimating, setIsMultiplierAnimating] = useState(false);
  const [isMultiplierGreen, setIsMultiplierGreen] = useState(false);
  const [totalPayoutAccrued, setTotalPayoutAccrued] = useState(0);

  const [rollDots, setRollDots] = useState(0);

  const [landedOnSnake, setLandedOnSnake] = useState(false);
  const [hasWon, setHasWon] = useState(false);

  const [zoomPulse, setZoomPulse] = useState(false);

  const [landingTile, setLandingTile] = useState(null);

  const [selectedTile, setSelectedTile] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [mobileModalOpen, setMobileModalOpen] = useState(false);

  const [showWinPopup, setShowWinPopup] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [showLossPopup, setShowLossPopup] = useState(false);

  // Audio refs
  const diceRollAudioRef = useRef(null);
  const winAudioRef = useRef(null);
  const loseAudioRef = useRef(null);
  const cashoutAudioRef = useRef(null);
  const betAudioRef = useRef(null);
  const multUpAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const revealedBufferRef = useRef(null);

  const animRef = useRef(0);
  const multAnimRef = useRef(0);
  const isMobile = isMobileNow();
  const bet = useMemo(() => Number.parseFloat(betAmount) || 0, [betAmount]);

  const canBet = (status === "idle" || landedOnSnake || hasWon) && !isBusy;
  const canRoll = status === "in_progress" && !isBusy && !isAnimating && !landedOnSnake && !hasWon;
  const canCashout = status === "in_progress" && !isBusy && totalPayoutAccrued > 0 && !isAnimating && !landedOnSnake && !hasWon;

  const themeVars = useMemo(() => {
    const t = DIFF_THEME[difficulty] || DIFF_THEME.medium;
    return {
      "--diff-hover-base": t.hoverBase,
      "--diff-hover-bg": t.hoverBg,
      "--start-arrow": t.startArrow,
    };
  }, [difficulty]);

  // Initialize Web Audio API for pitch-shifted sounds
  useEffect(() => {
    const initAudio = async () => {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();

        // Load revealed sound buffer
        const response = await fetch(revealedSound);
        const arrayBuffer = await response.arrayBuffer();
        revealedBufferRef.current = await audioContextRef.current.decodeAudioData(arrayBuffer);
      } catch (e) {
        console.log("Audio init error:", e);
      }
    };

    initAudio();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Sound helpers
  const playDiceRoll = () => {
    if (diceRollAudioRef.current) {
      diceRollAudioRef.current.currentTime = 0;
      diceRollAudioRef.current.play().catch(() => { });
    }
  };

  const stopDiceRoll = () => {
    if (diceRollAudioRef.current) {
      diceRollAudioRef.current.pause();
      diceRollAudioRef.current.currentTime = 0;
    }
  };

  const playWin = () => {
    if (winAudioRef.current) {
      winAudioRef.current.currentTime = 0;
      winAudioRef.current.play().catch(() => { });
    }
  };

  const playLose = () => {
    if (loseAudioRef.current) {
      loseAudioRef.current.currentTime = 0;
      loseAudioRef.current.play().catch(() => { });
    }
  };

  const playCashout = () => {
    if (cashoutAudioRef.current) {
      cashoutAudioRef.current.currentTime = 0;
      cashoutAudioRef.current.play().catch(() => { });
    }
  };

  const playBet = () => {
    if (betAudioRef.current) {
      betAudioRef.current.currentTime = 0;
      betAudioRef.current.play().catch(() => { });
    }
  };

  const playMultUp = () => {
    if (multUpAudioRef.current) {
      multUpAudioRef.current.currentTime = 0;
      multUpAudioRef.current.play().catch(() => { });
    }
  };

  // Play revealed sound with pitch based on step number (0-indexed)
  const playRevealedWithPitch = (stepIndex) => {
    if (!audioContextRef.current || !revealedBufferRef.current) return;

    try {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = revealedBufferRef.current;

      const basePitch = 1.0;
      const pitchIncrement = 0.08;
      const playbackRate = basePitch + (stepIndex * pitchIncrement);

      source.playbackRate.value = Math.min(playbackRate, 2.0);

      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 0.6;

      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      source.start(0);
    } catch (e) {
      console.log("Revealed sound error:", e);
    }
  };

  // Animate multiplier from old value to new value
  const animateMultiplier = async (fromValue, toValue) => {
    const my = ++multAnimRef.current;

    if (toValue <= fromValue) {
      setDisplayedMultiplier(toValue);
      return;
    }

    setIsMultiplierAnimating(true);

    playMultUp();

    const diff = toValue - fromValue;
    const steps = Math.min(Math.ceil(diff * 100), 50);
    const increment = diff / steps;
    const stepDuration = Math.max(30, 400 / steps);

    let current = fromValue;

    for (let i = 0; i < steps; i++) {
      if (multAnimRef.current !== my) {
        setDisplayedMultiplier(toValue);
        setIsMultiplierAnimating(false);
        return;
      }

      current += increment;
      setDisplayedMultiplier(Math.min(current, toValue));

      await new Promise((r) => setTimeout(r, stepDuration));
    }

    if (multAnimRef.current === my) {
      setDisplayedMultiplier(toValue);
      setIsMultiplierAnimating(false);
    }
  };

  const tileView = (idx) => {
    const t = board?.[idx];
    if (!t) return { kind: idx === 0 ? "start" : "unknown", label: "" };
    if (t.type === "start") return { kind: "start", label: "" };
    if (t.type === "snake") return { kind: "snake", label: "" };
    if (t.type === "multiplier") return { kind: "mult", label: `${Number(t.multiplier).toFixed(2)}x`, mult: Number(t.multiplier) };
    return { kind: "unknown", label: "" };
  };

  useEffect(() => {
    let alive = true;
    const seq = ++layoutSeqRef.current;

    (async () => {
      try {
        if (status !== "idle" && !landedOnSnake && !hasWon) return;
        const res = await gamesAPI.snakesLayout({ difficulty });
        const b = res.data?.data?.board;
        if (!alive) return;
        if (status !== "idle" && !landedOnSnake && !hasWon) return;
        if (layoutSeqRef.current !== seq) return;
        if (gameBoardRef.current) return;

        if (Array.isArray(b) && b.length === 12) {
          setBoard(b);
          layoutRetryRef.current = 0;
        }

        setZoomPulse(true);
        setTimeout(() => setZoomPulse(false), 400);
      } catch (e) {
        console.log("snakes layout err:", e?.response?.data?.message || e.message);
        // recover instead of leaving the board empty (max 3 tries)
        if (alive && !gameBoardRef.current && layoutRetryRef.current < 3) {
          layoutRetryRef.current += 1;
          setTimeout(() => {
            if (alive) setLayoutTick((t) => t + 1);
          }, 2500);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [difficulty, status, landedOnSnake, hasWon, layoutTick]);

  useEffect(() => {
    if (status !== "idle" && !landedOnSnake && !hasWon) return;
    const onDown = (e) => {
      if (e.target.closest(`.${styles.tile}`)) return;
      if (e.target.closest(`.${styles.wheelHoverPanel}`)) return;
      // taps INSIDE the mobile tile modal must not deselect/close it
      if (e.target.closest(".ui-modal-card")) return;
      setSelectedTile(null);
      setHoverInfo(null);
      setMobileModalOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [status, landedOnSnake, hasWon]);

  const handleTileClick = (idx) => {
    if (status !== "idle" && !landedOnSnake && !hasWon) return;
    if (!board) return;

    if (idx === 0) return;

    if (selectedTile === idx) {
      setSelectedTile(null);
      setHoverInfo(null);
      setMobileModalOpen(false);
      return;
    }

    setSelectedTile(idx);

    const t = board[idx];
    const isSnake = t?.type === "snake";
    const payoutX = t?.type === "multiplier" ? Number(t.multiplier) : 0;

    const payout = bet * payoutX;
    const profit = payout - bet;
    const ways = nextRollWays(0, idx);

    setHoverInfo({ profit, ways, payout, payoutX, isSnake });

    if (isMobile) setMobileModalOpen(true);
  };

  const animateDice = async (finalD1, finalD2) => {
    setDiceRolling(true);
    const my = animRef.current;
    const rng = mulberry32((Date.now() & 0xffffffff) ^ (finalD1 * 13) ^ (finalD2 * 97));

    const t0 = performance.now();
    const duration = 520;

    while (performance.now() - t0 < duration) {
      if (animRef.current !== my) {
        setDiceRolling(false);
        return false;
      }
      setDiceFaces({
        d1: 1 + Math.floor(rng() * 6),
        d2: 1 + Math.floor(rng() * 6),
      });
      await new Promise((r) => setTimeout(r, 55));
    }

    if (animRef.current !== my) {
      setDiceRolling(false);
      return false;
    }

    setDiceFaces({ d1: finalD1, d2: finalD2 });
    await new Promise((r) => setTimeout(r, 110));
    setDiceRolling(false);
    return true;
  };

  const stepWalk = async (from, to, diceSum) => {
    const my = animRef.current;

    setCurrentPosition(from);

    if (from === to) {
      return true;
    }

    let step = from;
    let stepsToTake = diceSum;
    let stepIndex = 0;

    while (stepsToTake > 0) {
      if (animRef.current !== my) {
        setCurrentPosition(to);
        setEnteringTile(null);
        setExitingTile(null);
        return false;
      }

      const prevStep = step;
      step = (step + 1) % TOTAL_TILES;
      stepsToTake--;

      // Exit previous tile (fade out), enter new tile (fade in) - both run in parallel
      setExitingTile(prevStep);
      setCurrentPosition(step);
      setEnteringTile(step);

      // Play revealed sound with increasing pitch
      playRevealedWithPitch(stepIndex);
      stepIndex++;

      // Wait for animations (enter + exit run in parallel)
      await new Promise((r) => setTimeout(r, 100));

      // Clear states
      if (animRef.current === my) {
        setEnteringTile(null);
        setExitingTile(null);
      }
    }

    setCurrentPosition(to);
    setEnteringTile(null);
    setExitingTile(null);

    return true;
  };

  const resetLocalSession = () => {
    setRoundId(null);
    setStatus("idle");
    gameBoardRef.current = null;
    setCurrentPosition(0);
    setIsAnimating(false);
    setWalkingFrom(null);
    setWalkingDestination(null);
    setEnteringTile(null);
    setExitingTile(null);
    setRolledOnce(false);
    setTotalMultiplier(1);
    setDisplayedMultiplier(1);
    setIsMultiplierAnimating(false);
    setIsMultiplierGreen(false);
    setTotalPayoutAccrued(0);
    setRollDots(0);
    setDiceFaces({ d1: 1, d2: 1 });
    setDiceRolling(false);
    setDiceLeftPressed(false);
    setDiceRightPressed(false);
    setDiceUnpressLeft(false);
    setDiceUnpressRight(false);
    setSelectedTile(null);
    setHoverInfo(null);
    setMobileModalOpen(false);
    setLandingTile(null);
    setLandedOnSnake(false);
    setHasWon(false);
    setShowLossPopup(false);
  };

  const start = async () => {
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (!Number.isFinite(bet) || bet <= 0) { setBetError("Invalid bet amount"); return; }
    if (bet > (user?.balance ?? 0)) { setBetError("Insufficient balance"); return; }

    playBet();

    resetLocalSession();

    setIsBusy(true);
    const my = ++animRef.current;

    try {
      const res = await gamesAPI.snakesStart({ betAmount: bet, difficulty });
      const gs = res.data?.gameState;
      if (!gs?.roundId) throw new Error("Bad response");

      if (Array.isArray(gs.board)) {
        gameBoardRef.current = gs.board;
        setBoard(gs.board);
      }

      setRoundId(gs.roundId);
      setStatus(gs.status || "in_progress");

      const startPos = Number(gs.position ?? 0);
      setCurrentPosition(startPos);

      setTotalMultiplier(gs.totalMultiplier ?? 1);
      setDisplayedMultiplier(gs.totalMultiplier ?? 1);
      setTotalPayoutAccrued(gs.totalPayoutAccrued ?? 0);

      if (typeof gs.balanceAfterBet === "number") updateBalance(gs.balanceAfterBet);

    } catch (e) {
      toast.error(e.response?.data?.message || e.message || "Failed to start");
      resetLocalSession();
    } finally {
      if (animRef.current === my) setIsBusy(false);
    }
  };

  const roll = async () => {
    if (!roundId) return;
    if (isAnimating) return;

    setIsBusy(true);
    setIsAnimating(true);
    const my = ++animRef.current;

    try {
      setRolledOnce(true);
      setLandingTile(null);
      setDiceUnpressLeft(false);
      setDiceUnpressRight(false);
      setEnteringTile(null);
      setExitingTile(null);

      // Both dice press and start rolling
      setDiceLeftPressed(true);
      setDiceRightPressed(true);

      playDiceRoll();

      const res = await gamesAPI.snakesRoll({ roundId });
      const r = res.data?.result;
      const gs = res.data?.gameState;
      if (!r || !gs) throw new Error("Bad response");

      const { d1, d2, sum } = r.roll;
      const from = Number(r.from);
      const to = Number(r.to);

      setWalkingFrom(from);
      setWalkingDestination(to);

      if (Array.isArray(gs.board)) {
        gameBoardRef.current = gs.board;
        setBoard(gs.board);
      }

      const diceOk = await animateDice(d1, d2);
      if (!diceOk || animRef.current !== my) {
        setIsAnimating(false);
        setDiceLeftPressed(false);
        setDiceRightPressed(false);
        setWalkingFrom(null);
        setWalkingDestination(null);
        stopDiceRoll();
        return;
      }

      stopDiceRoll();

      // Left die unpresses first
      setDiceLeftPressed(false);
      setDiceUnpressLeft(true);

      // Right die unpresses 400ms later
      await new Promise((r) => setTimeout(r, 100));
      if (animRef.current === my) {
        setDiceRightPressed(false);
        setDiceUnpressRight(true);
      }

      // Wait for unpress animation to complete
      await new Promise((r) => setTimeout(r, 200));
      if (animRef.current === my) {
        setDiceUnpressLeft(false);
        setDiceUnpressRight(false);
      }

      const walkOk = await stepWalk(from, to, sum);
      if (!walkOk || animRef.current !== my) {
        setIsAnimating(false);
        setWalkingFrom(null);
        setWalkingDestination(null);
        return;
      }

      setCurrentPosition(to);
      setWalkingFrom(null);
      setWalkingDestination(null);

      setLandingTile(to);
      setTimeout(() => {
        if (animRef.current === my) setLandingTile(null);
      }, 300);

      const oldMultiplier = totalMultiplier;
      const newMultiplier = gs.totalMultiplier ?? totalMultiplier;

      setTotalMultiplier(newMultiplier);
      setTotalPayoutAccrued(gs.totalPayoutAccrued ?? totalPayoutAccrued);
      setStatus(gs.status);

      setRollDots((prev) => (prev + 1) % 5);

      if (gs.status === "lost" || r.status === "lost") {
        setLandedOnSnake(true);
        setDisplayedMultiplier(0);
        playLose();

        // Show loss popup temporarily
        setShowLossPopup(true);

        await new Promise((rr) => setTimeout(rr, 1800));
        if (animRef.current !== my) return;

        setShowLossPopup(false);
      }
      else if (gs.status === "auto_cashed_out" || r.status === "auto_cashed_out") {
        // Play win sound immediately when landing on safe tile
        playWin();
        setIsMultiplierGreen(true);

        await animateMultiplier(oldMultiplier, newMultiplier);

        if (typeof r.balance === "number") updateBalance(r.balance);

        const payout = Number(r.payout || gs.totalPayoutAccrued || 0);

        setHasWon(true);

        playCashout();

        await new Promise((rr) => setTimeout(rr, 400));
        if (animRef.current !== my) return;

        if (payout > 0) {
          setShowWinPopup(true);
          setWinAmount(payout);
        }

        await new Promise((rr) => setTimeout(rr, 1800));
        if (animRef.current !== my) return;

        setShowWinPopup(false);
        setWinAmount(0);
      }
      else {
        // Play win sound immediately when landing on safe tile
        playWin();
        setIsMultiplierGreen(true);
        await animateMultiplier(oldMultiplier, newMultiplier);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || "Roll failed");
      setDiceLeftPressed(false);
      setDiceRightPressed(false);
      setWalkingFrom(null);
      setWalkingDestination(null);
      setEnteringTile(null);
      setExitingTile(null);
      stopDiceRoll();
    } finally {
      if (animRef.current === my) {
        setIsBusy(false);
        setIsAnimating(false);
      }
    }
  };

  const cashout = async () => {
    if (!roundId) return;
    if (isAnimating) return;

    setIsBusy(true);
    const my = ++animRef.current;

    try {
      const res = await gamesAPI.snakesCashout({ roundId });
      const r = res.data?.result;
      const gs = res.data?.gameState;
      if (!r || !gs) throw new Error("Bad response");

      if (typeof r.balance === "number") updateBalance(r.balance);

      const payout = Number(r.payout || gs.totalPayoutAccrued || totalPayoutAccrued || 0);

      if (payout > 0) {
        setHasWon(true);
        playCashout();
      }

      await new Promise((rr) => setTimeout(rr, 150));
      if (animRef.current !== my) return;

      if (payout > 0) {
        setShowWinPopup(true);
        setWinAmount(payout);

        await new Promise((rr) => setTimeout(rr, 1800));
        if (animRef.current !== my) return;

        setShowWinPopup(false);
        setWinAmount(0);
      }

    } catch (e) {
      toast.error(e.response?.data?.message || e.message || "Cashout failed");
    } finally {
      if (animRef.current === my) setIsBusy(false);
    }
  };

  const getTileZIndex = (idx) => {
    if (selectedTile === idx) {
      return 100;
    }
    if (enteringTile === idx) {
      return 25;
    }
    const row = PERIMETER_ROWS[idx];
    if (status !== "idle" && currentPosition === idx) {
      return 20;
    }
    return (row + 1);
  };

  const tileClass = (idx) => {
    const { kind } = tileView(idx);
    const isHere = status !== "idle" && currentPosition === idx;
    const isSnakeTile = kind === "snake";

    const isSelected = (status === "idle" || landedOnSnake || hasWon) && selectedTile === idx;

    const shouldDim = rolledOnce && status === "in_progress" && !isHere && !landedOnSnake && !hasWon;

    const isLanding = landingTile === idx;

    const isWalking = walkingDestination !== null;

    const isAtStartAndHere = isWalking && isHere && idx === walkingFrom;
    const isAtDestinationAndHere = isWalking && isHere && idx === walkingDestination;
    const isIntermediateAndHere = isWalking && isHere && idx !== walkingFrom && idx !== walkingDestination;

    const hasLandedHere = isHere && !isWalking && !landedOnSnake && !hasWon;

    // Check if this tile is entering or exiting
    const isEntering = enteringTile === idx;
    const isExiting = exitingTile === idx;

    // Walking states - only base color changes, front stays gray
    const showWalkingNormal = isIntermediateAndHere && !isSnakeTile && !isEntering;
    const showWalkingSnake = isIntermediateAndHere && isSnakeTile && !isEntering;

    // Entering animation states
    const showEnteringNormal = isEntering && isIntermediateAndHere && !isSnakeTile;
    const showEnteringSnake = isEntering && isIntermediateAndHere && isSnakeTile;

    // Active states - both base and front change color
    const showActiveNormal = (isAtStartAndHere || isAtDestinationAndHere || hasLandedHere) && !isSnakeTile && !isEntering;
    const showActiveSnake = (isAtStartAndHere || isAtDestinationAndHere) && isSnakeTile && !landedOnSnake && !isEntering;

    // Entering active states (for start and destination tiles)
    const showActiveEnteringNormal = isEntering && (isAtStartAndHere || isAtDestinationAndHere) && !isSnakeTile;
    const showActiveEnteringSnake = isEntering && (isAtStartAndHere || isAtDestinationAndHere) && isSnakeTile && !landedOnSnake;

    const showLandedOnSnake = landedOnSnake && isHere && isSnakeTile;

    const showWonTile = hasWon && isHere && !isSnakeTile;

    return [
      styles.tile,
      kind === "snake" ? styles.tileSnake : "",
      kind === "start" ? styles.tileStart : "",
      kind === "mult" ? styles.tileMult : "",
      (showActiveNormal || showWonTile) ? styles.tileActive : "",
      showActiveSnake ? styles.tileActiveSnake : "",
      showWalkingNormal ? styles.tileWalking : "",
      showWalkingSnake ? styles.tileWalkingSnakeThrough : "",
      showEnteringNormal ? styles.tileWalking : "",
      showEnteringSnake ? styles.tileWalkingSnakeThrough : "",
      showActiveEnteringNormal ? styles.tileActiveEntering : "",
      showActiveEnteringSnake ? styles.tileActiveSnakeEntering : "",
      showLandedOnSnake ? styles.tileLandedSnake : "",
      isSelected ? styles.tileSelected : "",
      shouldDim ? styles.tileDimAfterRoll : "",
      zoomPulse ? styles.tileZoomPulse : "",
      isLanding && !showLandedOnSnake ? styles.tileLanding : "",
      isExiting ? styles.tileExiting : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  const centerMultClass = () => {
    return [
      styles.centerMult,
      (hasWon || isMultiplierAnimating || isMultiplierGreen) ? styles.centerMultWin : "",
      landedOnSnake ? styles.centerMultLose : "",
      isMultiplierAnimating ? styles.centerMultAnimating : "",
    ].filter(Boolean).join(" ");
  };

  const panelMeta = useMemo(() => {
    if (!hoverInfo || selectedTile == null) return null;
    const [c, r] = PERIMETER[selectedTile];
    const left = `calc(${c} * var(--board-cell) + (var(--board-cell) / 2))`;
    const top = `calc(${r} * var(--board-cell))`;
    const onTop = r === 0;

    return {
      style: {
        left,
        top,
        transform: onTop
          ? "translate(-50%, calc(var(--board-cell) + 10px))"
          : "translate(-50%, -90px)",
      },
      placement: onTop ? "below" : "above",
    };
  }, [hoverInfo, selectedTile]);

  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("snakes", status === "in_progress");

  return (
    <div className={styles.container} style={themeVars}>
      {/* Audio elements */}
      <audio ref={diceRollAudioRef} src={diceRollSound} preload="auto" />
      <audio ref={winAudioRef} src={winSound} preload="auto" />
      <audio ref={loseAudioRef} src={loseSound} preload="auto" />
      <audio ref={cashoutAudioRef} src={cashoutSound} preload="auto" />
      <audio ref={betAudioRef} src={betSound} preload="auto" />
      <audio ref={multUpAudioRef} src={multUpSound} preload="auto" />

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
                step="0.01"
                min="0"
                disabled={isLocked || isBusy || (status === "in_progress" && !landedOnSnake && !hasWon)}
              />
              <span className={styles.btcIcon}>$</span>
            </div>

            <div className={styles.splitButtons}>
              <button onClick={() => setBetAmount((bet * 0.5).toFixed(2))} disabled={isLocked || isBusy || (status === "in_progress" && !landedOnSnake && !hasWon)} type="button">
                ½
              </button>
              <div className={styles.divider} />
              <button onClick={() => setBetAmount((bet * 2).toFixed(2))} disabled={isLocked || isBusy || (status === "in_progress" && !landedOnSnake && !hasWon)} type="button">
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
          <div className={`${styles.readonlyInput} ${styles.hasCaret}`}>
            <select
              className={styles.select}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              disabled={isLocked || isBusy || (status === "in_progress" && !landedOnSnake && !hasWon)}
            >
              {DIFFS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <span className="ui-bet-wrap">
          <button className={styles.betButton} onClick={start} disabled={isLocked || !canBet} type="button" data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
          Bet
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        {!landedOnSnake && !hasWon && (
          <button className={styles.rollButton} onClick={roll} disabled={!canRoll} type="button">
            Roll
          </button>
        )}

        {status === "in_progress" && !landedOnSnake && !hasWon && (
          <div className={styles.controlGroup}>
            <div className={styles.labelRow}>
              <span>Cashout Total</span>
              <span>${fmt2(totalPayoutAccrued)}</span>
            </div>

            <button className={styles.cashoutButton} onClick={cashout} disabled={!canCashout} type="button">
              Cashout
            </button>
          </div>
        )}
      </div>

      <div className={styles.gameStage}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Win / loss popups — direct children of the stage so they are
            always dead-centred over the board as true overlays. */}
        {showWinPopup && winAmount > 0 && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupTitle}>YOU WON</div>
            <div className={styles.winPopupAmount}>${fmt2(winAmount)}</div>
          </div>
        )}

        {showLossPopup && (
          <div className={styles.lossPopup} role="status" aria-live="polite">
            <div className={styles.lossPopupTitle}>YOU LOST</div>
            <div className={styles.lossPopupAmount}>-${fmt2(bet)}</div>
          </div>
        )}

        <div className={styles.boardWrap}>
          <div className={styles.board}>
            {PERIMETER.map(([c, r], idx) => {
              const { kind, label } = tileView(idx);

              return (
                <div
                  key={idx}
                  className={tileClass(idx)}
                  style={{
                    left: `calc(${c} * var(--board-cell))`,
                    top: `calc(${r} * var(--board-cell))`,
                    width: `calc(var(--board-cell) - var(--tile-gap-x))`,
                    height: `calc(var(--board-cell) - var(--tile-gap-y))`,
                    zIndex: getTileZIndex(idx),
                  }}
                  onClick={() => handleTileClick(idx)}
                >
                  <div className={styles.tileFront}>
                    {kind === "start" && (
                      <div className={styles.startIcon} aria-hidden="true">
                        <svg viewBox="0 0 100 100" className={styles.startArrowSvg}>
                          <polygon
                            points="30,20 75,50 30,80"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="12"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                    )}
                    {kind === "snake" && (
                      <div className={styles.snakeIcon} aria-hidden="true">
                        <SnakeIcon />
                      </div>
                    )}
                    {kind === "mult" && <div className={styles.multValue}>{label}</div>}
                  </div>
                </div>
              );
            })}

            {panelMeta && hoverInfo && !isMobile && (
              <div
                className={`${styles.wheelHoverPanel} ${styles.wheelHoverPanelVisible} ${panelMeta.placement === "below" ? styles.panelBelow : styles.panelAbove
                  }`}
                style={panelMeta.style}
              >
                <div className={styles.wheelHoverBoxes} style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                  <div className={styles.wheelHoverBox}>
                    <div className={styles.wheelHoverLabel}>Profit on Win</div>
                    <div className={styles.wheelHoverField}>
                      <input
                        className={styles.wheelHoverInput}
                        type="text"
                        readOnly
                        value={fmt2(hoverInfo.profit)}
                      />
                      <span className={styles.wheelHoverSuffix}>$</span>
                    </div>
                  </div>
                  <div className={styles.wheelHoverBox}>
                    <div className={styles.wheelHoverLabel}>Chance</div>
                    <div className={styles.wheelHoverField}>
                      <input
                        className={styles.wheelHoverInput}
                        type="text"
                        readOnly
                        value={`${hoverInfo.ways}/36`}
                      />
                    </div>
                  </div>
                </div>
                <div className={styles.wheelHoverArrow} />
              </div>
            )}

            <Modal
              isOpen={mobileModalOpen && isMobile && !!hoverInfo}
              onClose={() => setMobileModalOpen(false)}
              title="Tile details"
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="3.5" />
                  <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
                </svg>
              }
              description="What happens when the dice land here."
              >
              {hoverInfo && (
                <>
                  <div className={styles.modalGrid}>
                    <div className={styles.modalItem}>
                      <div className={styles.modalItemLabel}>Profit on Win</div>
                      <div className={styles.modalItemValue}>${fmt2(hoverInfo.profit)}</div>
                    </div>
                    <div className={styles.modalItem}>
                      <div className={styles.modalItemLabel}>Chance</div>
                      <div className={styles.modalItemValue}>{hoverInfo.ways}/36</div>
                    </div>
                    <div className={styles.modalItem}>
                      <div className={styles.modalItemLabel}>Payout</div>
                      <div className={styles.modalItemValue}>${fmt2(hoverInfo.payout)}</div>
                    </div>
                  </div>
                  <button className={styles.modalBtnPrimary} onClick={() => setMobileModalOpen(false)} type="button">
                    Close
                  </button>
                </>
              )}
            </Modal>

            <div className={styles.centerTile}>
              <div className={styles.diceHolder}>
                <DiceFace
                  value={diceFaces.d1}
                  isRolling={diceRolling}
                  isPressed={diceLeftPressed}
                  isUnpress={diceUnpressLeft}
                />
                <DiceFace
                  value={diceFaces.d2}
                  isRolling={diceRolling}
                  isPressed={diceRightPressed}
                  isUnpress={diceUnpressRight}
                />
              </div>

              <div className={centerMultClass()} translate="no">
                {status === "idle" ? "1.00x" : `${displayedMultiplier.toFixed(2)}x`}
              </div>
            </div>
          </div>

          <div className={styles.rollDots}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={`${styles.dot} ${i <= rollDots ? styles.dotActive : ""}`} />
            ))}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}