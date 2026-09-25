import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import useActiveBetFlag from "../../hooks/useActiveBetFlag";
import useGameDisabled from "../../hooks/useGameDisabled";
import BetLockBadge from "../common/BetLockBadge";
import DisabledGameStage from "./DisabledGameStage";
import BetError from "../common/BetError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { gamesAPI } from "../../services/api";

import limboStyles from "./limbo.module.css";
import styles from "./RussianRoulette.module.css";

import gunImg from "../../assets/russian-roulette/Gun.png";
import tableImg from "../../assets/russian-roulette/SemiCircleTable.png";

import bulletImg from "../../assets/russian-roulette/Bullet.png";
import bulletBackImg from "../../assets/russian-roulette/BulletBack.png";
import cylinderEmptyImg from "../../assets/russian-roulette/CylinderEmpty.png";

import playerRed from "../../assets/russian-roulette/PlayerRed.png";
import playerGreen from "../../assets/russian-roulette/PlayerGreen.png";
import playerBlue from "../../assets/russian-roulette/PlayerBlue.png";
import playerPurple from "../../assets/russian-roulette/PlayerPurple.png";
import playerYellow from "../../assets/russian-roulette/PlayerYellow.png";
import CurrencyIcon from "../common/CurrencyIcon";

const PLAYERS = 5;
const USER_INDEX = 2;
const LS_RR_ROUND = "rr_v2_roundId";

const SCENE_W = 900;
const SCENE_H = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function animateNumber({ from, to, duration = 900, onUpdate }) {
  const start = performance.now();
  return new Promise((resolve) => {
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      onUpdate(from + (to - from) * easeOutCubic(t));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}
function centerOfRect(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function clampAngleDeg(a) {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

export default function RussianRoulette({ gameRow }) {
  const { user, isAuthenticated, updateBalance, openLoginModal } = useAuth();
  const toast = useToast();

  const [isPlaying, setIsPlaying] = useState(false);
  const [betLand, setBetLand] = useState("");
  const { isDisabled, isMobileDisabled, isLocked, disabledTitle, disabledDesc, betErrorMessage } = useGameDisabled(gameRow);
  const [betLockedError, setBetLockedError] = useState("");
  useEffect(() => {
    if (isLocked && String(betLand).trim() !== "") setBetLockedError(betErrorMessage);
    else setBetLockedError("");
  }, [betLand, isLocked, betErrorMessage]);
  const [betError, setBetError] = useState(null);
  // inline bet errors clear themselves as soon as they are resolved
  useEffect(() => {
    setBetError((cur) => {
      if (!cur) return cur;
      if (cur === "Log in to place a bet") return isAuthenticated ? null : cur;
      const amt = parseFloat(betLand) || 0;
      return amt > 0 && amt <= (user?.balance ?? 0) ? null : cur;
    });
  }, [betLand, isAuthenticated, user?.balance]);
  const [betShot, setBetShot] = useState("");

  const [roundId, setRoundId] = useState(null);
  const [phase, setPhase] = useState("idle");

  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [landedOnUser, setLandedOnUser] = useState(false);
  const [alive, setAlive] = useState([true, true, true, true, true]);

  const [bulletsThisRound, setBulletsThisRound] = useState(1);
  const [cylinder, setCylinder] = useState(null);

  const [gunAngle, setGunAngle] = useState(0);
  const gunAngleRef = useRef(0);

  const [cylinderAngle, setCylinderAngle] = useState(0);
  const cylinderAngleRef = useRef(0);

  const [liftedPlayer, setLiftedPlayer] = useState(null);
  const [shotPlayer, setShotPlayer] = useState(null);

  const [poppingIndex, setPoppingIndex] = useState(null);
  const [spentChamberIndex, setSpentChamberIndex] = useState(null);

  const [muzzleFlash, setMuzzleFlash] = useState(false);
  const [flyingBullet, setFlyingBullet] = useState({
    active: false,
    from: null,
    to: null,
    angleDeg: 0,
  });

  const [winPopup, setWinPopup] = useState(null);
  const winPopupTimer = useRef(null);

  const [sceneScale, setSceneScale] = useState(1);

  const stageRef = useRef(null);
  const sceneWrapRef = useRef(null);
  const pivotRef = useRef(null);
  const pivotMarkerRef = useRef(null);

  const playerRefs = useRef(Array.from({ length: PLAYERS }, () => null));

  const playerImgs = useMemo(
    () => [playerGreen, playerBlue, playerRed, playerPurple, playerYellow],
    []
  );

  /* ===== Responsive scene scaling ===== */
  const computeScale = useCallback(() => {
    const wrap = sceneWrapRef.current;
    if (!wrap) return;
    const wrapW = wrap.clientWidth;
    const wrapH = wrap.clientHeight;
    const s = Math.min(wrapW / SCENE_W, wrapH / SCENE_H, 1);
    setSceneScale(s);
  }, []);

  useEffect(() => {
    computeScale();
    window.addEventListener("resize", computeScale);
    return () => window.removeEventListener("resize", computeScale);
  }, [computeScale]);

  const busy = isPlaying || phase === "phase1_spinning" || phase === "phase2_animating";

  const bet2AllowedByBullets = bulletsThisRound < 6;
  const canBet2 = phase === "phase1_done" && landedOnUser && bet2AllowedByBullets;
  const canContinue = phase === "phase1_done" && landedOnUser && bet2AllowedByBullets;
  const canShoot = phase === "phase2_ready" || phase === "bet2_placed";
  const showShotBetDisabled = !canBet2;

  const adjustBet = (setter, val, current) => {
    const curr = parseFloat(current) || 0;
    setter((curr * val).toFixed(2));
  };

  const GUN_SPRITE_OFFSET_DEG = 90;
  const BULLET_SPRITE_OFFSET_DEG = 90;

  const GUN_IMG_W = 103;
  const GUN_IMG_H = 577;

  const TIP_X = 52;
  const TIP_Y = 0;

  const GRIP_X = 52;
  const GRIP_Y = 346;

  const GRIP_TO_TIP_SRC = Math.sqrt(
    Math.pow(TIP_X - GRIP_X, 2) + Math.pow(TIP_Y - GRIP_Y, 2)
  );

  const GRIP_TO_TIP_BASE_RAD = Math.atan2(TIP_Y - GRIP_Y, TIP_X - GRIP_X);

  const TIP_LEFT_PCT = `${(TIP_X / GUN_IMG_W) * 100}%`;
  const TIP_TOP_PCT = `${(TIP_Y / GUN_IMG_H) * 100}%`;

  const PIVOT_X_PCT = `${(GRIP_X / GUN_IMG_W) * 100}%`;
  const PIVOT_Y_PCT = `${(GRIP_Y / GUN_IMG_H) * 100}%`;

  // Gun always renders at the same size in scene-space (scene is scaled uniformly)
  const GUN_SCALE = 0.20;
  const GUN_RENDER_W = Math.round(GUN_IMG_W * GUN_SCALE);
  const GUN_RENDER_H = Math.round(GUN_IMG_H * GUN_SCALE);

  const GRIP_TO_TIP_PX = GRIP_TO_TIP_SRC * GUN_SCALE;

  const GRIP_SCREEN_X = Math.round(GRIP_X * GUN_SCALE);
  const GRIP_SCREEN_Y = Math.round(GRIP_Y * GUN_SCALE);

  const GRIP_SCENE_X = 450;
  const GRIP_SCENE_Y = 350;

  const BULLET_SCALE = 0.22;
  const BULLET_RENDER_W = Math.round(25 * BULLET_SCALE);
  const BULLET_RENDER_H = Math.round(101 * BULLET_SCALE);
  const BULLET_SPAWN_PUSH_PX = 12;

  function getPivotScreenPos() {
    const el = pivotMarkerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function computeTipScreenPos(angleDeg, pushPx = 0) {
    const pivotPos = getPivotScreenPos();
    if (!pivotPos) return null;

    const totalAngleRad = GRIP_TO_TIP_BASE_RAD + (angleDeg * Math.PI) / 180;

    // Account for CSS scale transform on the scene
    const effectiveDist = (GRIP_TO_TIP_PX + pushPx) * sceneScale;

    return {
      x: pivotPos.x + effectiveDist * Math.cos(totalAngleRad),
      y: pivotPos.y + effectiveDist * Math.sin(totalAngleRad),
    };
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function aimGunToPlayer(playerIndex, extraTurns = 0, animate = true) {
    const pEl = playerRefs.current[playerIndex];
    if (!pEl) return;

    await waitForPaint();

    const pivotPos = getPivotScreenPos();
    if (!pivotPos) return;

    const tb = pEl.getBoundingClientRect();
    const target = centerOfRect(tb);

    const angleRad = Math.atan2(target.y - pivotPos.y, target.x - pivotPos.x);
    const angleDeg = (angleRad * 180) / Math.PI;

    const desired = angleDeg + GUN_SPRITE_OFFSET_DEG;

    const from = gunAngleRef.current;
    const to = from + extraTurns * 360 + (desired - (from % 360));

    if (!animate) {
      gunAngleRef.current = to;
      setGunAngle(to);
      await waitForPaint();
      return;
    }

    await animateNumber({
      from,
      to,
      duration: 1050,
      onUpdate: (v) => {
        gunAngleRef.current = v;
        setGunAngle(v);
      },
    });

    const norm = clampAngleDeg(gunAngleRef.current);
    gunAngleRef.current = norm;
    setGunAngle(norm);
    await waitForPaint();
  }

  async function recoilGun() {
    const base = gunAngleRef.current;
    const kick = base - 6;
    await animateNumber({
      from: base,
      to: kick,
      duration: 85,
      onUpdate: (v) => {
        gunAngleRef.current = v;
        setGunAngle(v);
      },
    });
    await animateNumber({
      from: kick,
      to: base,
      duration: 170,
      onUpdate: (v) => {
        gunAngleRef.current = v;
        setGunAngle(v);
      },
    });
  }

  const cylinderDisplay = useMemo(() => {
    const base =
      Array.isArray(cylinder) && cylinder.length === 6
        ? cylinder
        : (() => {
          const n = Math.max(1, Math.min(6, Number(bulletsThisRound) || 1));
          return Array.from({ length: 6 }, (_, i) => (i < n ? "bullet" : "blank"));
        })();

    if (spentChamberIndex == null) return base;
    return base.map((v, i) => (i === spentChamberIndex ? "blank" : v));
  }, [cylinder, bulletsThisRound, spentChamberIndex]);

  const SLOT_START_DEG = -60;
  const TOP_MARKER_DEG = -90;

  const bulletSlots = useMemo(() => {
    const radius = 18.5;
    const xOffset = 0.0;
    const yOffset = 0.0;

    return Array.from({ length: 6 }, (_, i) => {
      const a = ((SLOT_START_DEG + i * 60) * Math.PI) / 180;
      return {
        x: 50 + radius * Math.cos(a) + xOffset,
        y: 50 + radius * Math.sin(a) + yOffset,
      };
    });
  }, []);

  function showWinPayout(totalPayout) {
    setWinPopup({ amount: totalPayout });
    if (winPopupTimer.current) clearTimeout(winPopupTimer.current);
    winPopupTimer.current = setTimeout(() => setWinPopup(null), 2200);
  }

  const resolveShotInternal = async (rid) => {
    const useRoundId = rid ?? roundId;
    if (!useRoundId) return;

    setIsPlaying(true);
    setPhase("phase2_animating");

    try {
      const resp = await gamesAPI.russianRouletteResolveShot({ roundId: useRoundId });
      const res = resp.data.result;

      const targetIndex = res.targetPlayerIndex;
      setLiftedPlayer(targetIndex);

      await aimGunToPlayer(targetIndex, 0, false);

      const targetAngleDeg = TOP_MARKER_DEG - (SLOT_START_DEG + res.topIndex * 60);

      const cylFrom = cylinderAngleRef.current;
      const cylTo = cylFrom + 720 + targetAngleDeg;

      await animateNumber({
        from: cylFrom,
        to: cylTo,
        duration: 820,
        onUpdate: (v) => {
          cylinderAngleRef.current = v;
          setCylinderAngle(v);
        },
      });

      setCylinder(res.cylinder);

      const currentAngle = gunAngleRef.current;
      const tipScreenPos = computeTipScreenPos(currentAngle, BULLET_SPAWN_PUSH_PX);

      await recoilGun();

      if (res.wasShot === true) {
        setPoppingIndex(res.topIndex);
        setMuzzleFlash(true);

        await sleep(90);
        setMuzzleFlash(false);

        await sleep(140);
        setPoppingIndex(null);

        setSpentChamberIndex(res.topIndex);

        const stageEl = stageRef.current;
        const playerEl = playerRefs.current[targetIndex];

        if (stageEl && playerEl && tipScreenPos) {
          const stageRect = stageEl.getBoundingClientRect();
          const playerRect = playerEl.getBoundingClientRect();

          const targetPointPx = {
            x: playerRect.left + playerRect.width / 2,
            y: playerRect.top + playerRect.height * 0.35,
          };

          const dx = targetPointPx.x - tipScreenPos.x;
          const dy = targetPointPx.y - tipScreenPos.y;
          const travelAngleRad = Math.atan2(dy, dx);
          const travelAngleDeg = (travelAngleRad * 180) / Math.PI;

          const fromPct = {
            x: ((tipScreenPos.x - stageRect.left) / stageRect.width) * 100,
            y: ((tipScreenPos.y - stageRect.top) / stageRect.height) * 100,
          };
          const toPct = {
            x: ((targetPointPx.x - stageRect.left) / stageRect.width) * 100,
            y: ((targetPointPx.y - stageRect.top) / stageRect.height) * 100,
          };

          setFlyingBullet({
            active: true,
            from: fromPct,
            to: toPct,
            angleDeg: travelAngleDeg + BULLET_SPRITE_OFFSET_DEG,
          });

          await sleep(100);
          setFlyingBullet({ active: false, from: null, to: null, angleDeg: 0 });
        }

        setShotPlayer(targetIndex);
        setAlive((prev) => {
          const next = [...prev];
          next[targetIndex] = false;
          return next;
        });
      } else {
        await sleep(280);
      }

      if (typeof res.balance === "number") updateBalance(res.balance);

      const totalPayout = Number(res.totalPayout) || 0;
      const totalWager = Number(res.totalWager) || 0;
      const netProfit = Number(res.netProfit);

      if (totalPayout > 0) showWinPayout(totalPayout);

      // Losing a round is an outcome, not an error — it gets the "Loss" toast.
      if (Number.isFinite(netProfit) && netProfit < 0) {
        toast.loss(`You lost ${(-netProfit).toFixed(2)} $ this round`);
      } else if (totalPayout === 0 && totalWager > 0) {
        toast.loss(`You lost ${totalWager.toFixed(2)} $ this round`);
      }

      setPhase("phase2_done");
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to shoot");
      setPhase("phase2_ready");
    } finally {
      setIsPlaying(false);
    }
  };

  const resolveShot = async () => resolveShotInternal(roundId);

  const startRound = async () => {
    if (isLocked) { setBetLockedError(betErrorMessage); return; }
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (busy) return;
    if (phase !== "idle" && phase !== "phase2_done") return;

    const amount = parseFloat(betLand);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }

    setIsPlaying(true);

    setSelectedPlayer(null);
    setLandedOnUser(false);
    setLiftedPlayer(null);
    setShotPlayer(null);
    setPoppingIndex(null);
    setSpentChamberIndex(null);
    setFlyingBullet({ active: false, from: null, to: null, angleDeg: 0 });
    setMuzzleFlash(false);
    setCylinder(null);
    setWinPopup(null);

    setPhase("idle");
    gunAngleRef.current = 0;
    setGunAngle(0);
    cylinderAngleRef.current = 0;
    setCylinderAngle(0);

    updateBalance((b) => b - amount);

    try {
      const resp = await gamesAPI.russianRouletteStart({ betAmount: amount });
      const gs = resp.data.gameState;
      const res = resp.data.result;

      setRoundId(gs.roundId);
      localStorage.setItem(LS_RR_ROUND, String(gs.roundId));

      setAlive(gs.alive ?? [true, true, true, true, true]);
      setLandedOnUser(!!res.landedOnUser);

      setBulletsThisRound(Number(res.bullets) || 1);
      setCylinder(gs.cylinder ?? res.cylinder ?? null);

      updateBalance(res.balance);

      setPhase("phase1_spinning");

      await aimGunToPlayer(res.selectedPlayerIndex, 3, true);

      setSelectedPlayer(res.selectedPlayerIndex);
      setLiftedPlayer(res.selectedPlayerIndex);

      await sleep(220);

      if (!res.landedOnUser || Number(res.bullets) >= 6) {
        setPhase("phase2_ready");
        await sleep(280);
        await resolveShotInternal(gs.roundId);
      } else {
        setPhase("phase1_done");
      }
    } catch (e) {
      updateBalance((b) => b + amount);
      toast.error(e.response?.data?.message || "Failed to start");
      setPhase("idle");
    } finally {
      setIsPlaying(false);
    }
  };

  const placeShotBet = async () => {
    if (!isAuthenticated) { setBetError("Log in to place a bet"); return; }
    if (busy) return;
    if (!canBet2) return;
    if (!roundId) return toast.error("Missing round");

    const amount = parseFloat(betShot);
    if (isNaN(amount) || amount <= 0) { setBetError("Invalid bet amount"); return; }
    if (amount > user.balance) { setBetError("Insufficient balance"); return; }

    setIsPlaying(true);
    updateBalance((b) => b - amount);

    try {
      await gamesAPI.russianRouletteBetShot({ roundId, betAmount: amount });
      setPhase("bet2_placed");
    } catch (e) {
      updateBalance((b) => b + amount);
      toast.error(e.response?.data?.message || "Failed to place bet");
    } finally {
      setIsPlaying(false);
    }
  };
  // Warn before a page refresh while a bet is live (see RefreshGuard).
  useActiveBetFlag("russian_roulette", isPlaying || (phase !== "idle" && phase !== "done"));


  const continueToPhase2 = () => {
    if (!canContinue) return;
    setShotPlayer(null);
    setPoppingIndex(null);
    setSpentChamberIndex(null);
    setMuzzleFlash(false);
    setFlyingBullet({ active: false, from: null, to: null, angleDeg: 0 });
    setPhase("phase2_ready");
  };

  return (
    <div className={limboStyles.container}>
      <div className={limboStyles.sidebar}>
        <div className={limboStyles.modeToggle}>
          <button className={`${limboStyles.modeBtn} ${limboStyles.active}`}>Manual</button>
          <button className={`${limboStyles.modeBtn} sidebar-mode-auto-disabled`} disabled>
            Auto
          </button>
        </div>

        <div className={limboStyles.controlGroup}>
          <div className={limboStyles.labelRow}>
            <span>Bet (Land on me)</span>
            <span>$0.00</span>
          </div>
          <div className={limboStyles.inputGroup}>
            <div className={limboStyles.inputWrapper}>
              <input
                type="number"
                placeholder="0.00" value={betLand}
                onChange={(e) => setBetLand(e.target.value)}
                step="0.00000001"
                disabled={isLocked || busy}
              />
              <CurrencyIcon className={limboStyles.btcIcon} />
            </div>
            <div className={limboStyles.splitButtons}>
              <button onClick={() => adjustBet(setBetLand, 0.5, betLand)} disabled={isLocked || busy}>
                ½
              </button>
              <div className={limboStyles.divider}></div>
              <button onClick={() => adjustBet(setBetLand, 2, betLand)} disabled={isLocked || busy}>
                2×
              </button>
            </div>
          </div>
            <BetError message={betLockedError} />
            <BetError message={betError} />
        </div>

        <span className="ui-bet-wrap">
          <button className={limboStyles.betButton} onClick={startRound} disabled={isLocked || busy} data-bet-sound="true" title={isLocked ? betErrorMessage : undefined}>
            {phase === "phase1_spinning" ? "Spinning..." : "Bet"}
          </button>
          <BetLockBadge locked={isLocked} title={disabledTitle} description={disabledDesc} />
        </span>

        <div className={limboStyles.controlGroup} style={{ marginTop: 10 }}>
          <div className={limboStyles.labelRow}>
            <span>Bet (Will I be shot)</span>
            <span className={styles.smallMuted}>
              {!landedOnUser ? "Locked" : bulletsThisRound >= 6 ? "Disabled at 6 bullets" : "Unlocked"}
            </span>
          </div>

          <div className={limboStyles.inputGroup}>
            <div className={limboStyles.inputWrapper}>
              <input
                type="number"
                placeholder="0.00" value={betShot}
                onChange={(e) => setBetShot(e.target.value)}
                step="0.00000001"
                disabled={showShotBetDisabled || busy}
              />
              <CurrencyIcon className={limboStyles.btcIcon} />
            </div>
            <div className={limboStyles.splitButtons}>
              <button
                onClick={() => adjustBet(setBetShot, 0.5, betShot)}
                disabled={showShotBetDisabled || busy}
              >
                ½
              </button>
              <div className={limboStyles.divider}></div>
              <button
                onClick={() => adjustBet(setBetShot, 2, betShot)}
                disabled={showShotBetDisabled || busy}
              >
                2×
              </button>
            </div>
          </div>

          <button
            className={limboStyles.betButton}
            onClick={placeShotBet}
            data-bet-sound="true"
            disabled={isLocked || !canBet2 || busy}
            style={{ marginTop: 12 }}
           title={isLocked ? betErrorMessage : undefined}>
            Place Shot Bet
          </button>
        </div>

        {/* Bullets this bet — standard sidebar label + readonly input,
            same treatment as every other sidebar field */}
        <div className={limboStyles.controlGroup}>
          <div className={limboStyles.labelRow}>
            <span>Bullets this bet</span>
          </div>
          <div className={limboStyles.readonlyInput}>
            <input type="text" value={`${bulletsThisRound}/6`} readOnly />
          </div>
        </div>

        {/* Continue + Shoot — sidebar side-buttons, one row (Coin Flip
            pattern). Shoot uses the shared blue primary variant. */}
        <div className={styles.actionRow}>
          <button className={styles.btnGhost} onClick={continueToPhase2} disabled={!canContinue || busy}>
            Continue
          </button>
          <button className={styles.btnGo} onClick={resolveShot} disabled={!canShoot || busy}>
            Shoot
          </button>
        </div>
      </div>

      <div className={styles.stage} ref={stageRef}>
        {isLocked ? (
          <DisabledGameStage title={disabledTitle} message={disabledDesc} mobile={isMobileDisabled} />
        ) : (
          <>
        {/* Win popup — direct child of the stage (outside the scaled
            scene) so it is always dead-centred at full size. */}
        {winPopup && (
          <div className={styles.winPopup} role="status" aria-live="polite">
            <div className={styles.winPopupTitle}>YOU WON</div>
            <div className={styles.winPopupAmount}>{Number(winPopup.amount).toFixed(2)}<CurrencyIcon /></div>
          </div>
        )}

        <div className={styles.sceneWrap} ref={sceneWrapRef}>
          <div
            className={styles.scene}
            style={{ "--scene-scale": sceneScale }}
          >
            <img className={styles.table} src={tableImg} alt="" draggable={false} />

            <div className={styles.players}>
              {playerImgs.map((src, i) => (
                <div
                  key={i}
                  ref={(el) => (playerRefs.current[i] = el)}
                  className={[
                    styles.player,
                    styles[`p${i}`],
                    liftedPlayer === i ? styles.lift : "",
                    shotPlayer === i ? styles.shot : "",
                    alive[i] ? "" : styles.dead,
                  ].join(" ")}
                >
                  {i === USER_INDEX && <div className={styles.youTag}>You</div>}
                  <img src={src} alt="" draggable={false} />
                </div>
              ))}
            </div>

            <div
              className={styles.gunPivot}
              ref={pivotRef}
              style={{
                width: `${GUN_RENDER_W}px`,
                height: `${GUN_RENDER_H}px`,
                left: `${GRIP_SCENE_X - GRIP_SCREEN_X}px`,
                top: `${GRIP_SCENE_Y - GRIP_SCREEN_Y}px`,
              }}
            >
              <div
                ref={pivotMarkerRef}
                className={styles.pivotMarker}
                style={{ left: PIVOT_X_PCT, top: PIVOT_Y_PCT }}
              />

              <div
                className={styles.gunRot}
                style={{
                  transform: `rotate(${gunAngle}deg)`,
                  transformOrigin: `${PIVOT_X_PCT} ${PIVOT_Y_PCT}`,
                }}
              >
                <img className={styles.gunImg} src={gunImg} alt="" draggable={false} />

                <div
                  className={[styles.bulletFlash, muzzleFlash ? styles.flashOn : ""].join(" ")}
                  style={{ left: TIP_LEFT_PCT, top: TIP_TOP_PCT }}
                />
              </div>
            </div>

            <div className={styles.cylinder}>
              <div className={styles.cylTopMarker} />
              <div className={styles.cylRot} style={{ transform: `rotate(${cylinderAngle}deg)` }}>
                <img className={styles.cylBase} src={cylinderEmptyImg} alt="" draggable={false} />

                {bulletSlots.map((p, idx) => {
                  const chamber = cylinderDisplay[idx];
                  const visible = chamber === "bullet";
                  const isPopping = poppingIndex === idx;

                  return (
                    <div
                      key={idx}
                      className={[
                        styles.slot,
                        visible ? "" : styles.slotHidden,
                        isPopping ? styles.slotPop : "",
                      ].join(" ")}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    >
                      <img src={bulletBackImg} alt="" draggable={false} />
                    </div>
                  );
                })}
              </div>
            </div>

            {flyingBullet.active && (
              <div
                className={styles.fly}
                style={{
                  left: `${flyingBullet.from.x}%`,
                  top: `${flyingBullet.from.y}%`,
                  width: `${BULLET_RENDER_W}px`,
                  height: `${BULLET_RENDER_H}px`,
                  ["--toX"]: `${flyingBullet.to.x}%`,
                  ["--toY"]: `${flyingBullet.to.y}%`,
                  ["--ang"]: `${flyingBullet.angleDeg}deg`,
                  ["--spawnPush"]: `${BULLET_SPAWN_PUSH_PX}px`,
                }}
              >
                <img src={bulletImg} alt="" draggable={false} />
              </div>
            )}

          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}