import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import styles from "./diceCube.module.css";

/* ============================================================================
 * Dice result marker — a white hexagon drawn as an isometric cube:
 *   top face white, left face a little darker, right face darker still,
 *   slightly rounded corners, the CURRENT position printed in the centre.
 * Its bottom corner sits on the slider track, exactly above the roll.
 *
 * Driven imperatively by Dice.jsx (so the per-frame travel never re-renders
 * the whole game):
 *   press()           Bet clicked — shrink to 0.97 around the bottom corner
 *   land(value, won)  starts moving half-way through the shrink (or as soon
 *                     as the result is in), the number shows the live
 *                     position in gray, then it lands: text turns green (won)
 *                     or red (lost) and it bounces 0.97 -> 1.05 -> 1.00
 *   release()         the bet failed — back to full size where it stands
 *   markStale()       target / mode changed — the old verdict colour goes
 * ==========================================================================*/

export const CUBE_PRESS_MS = 200; // 1 -> 0.97
const CUBE_BOUNCE_MS = 520; // 0.97 -> 1.05 -> 1.00
const PRESSED = 0.97;

/* Pointy-top regular hexagon in a 100-wide box (height 2R = 115.47) */
const HEX = (() => {
  const w = 100;
  const R = w / Math.sqrt(3); // circumradius = edge length
  const h = 2 * R;
  const C = [w / 2, R];
  const V = [
    [w / 2, 0], // 0 top
    [w, R / 2], // 1 upper right
    [w, R * 1.5], // 2 lower right
    [w / 2, h], // 3 bottom (sits on the track)
    [0, R * 1.5], // 4 lower left
    [0, R / 2], // 5 upper left
  ];
  const f = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const round = 8.5 / R; // corner rounding, as a share of an edge
  let outline = "";
  V.forEach((v, i) => {
    const pin = lerp(v, V[(i + 5) % 6], round);
    const pout = lerp(v, V[(i + 1) % 6], round);
    outline += `${i === 0 ? "M" : "L"}${f(pin)}Q${f(v)} ${f(pout)}`;
  });
  outline += "Z";
  const poly = (pts) => pts.map(f).join(" ");
  return {
    w,
    h,
    outline,
    top: poly([V[5], V[0], V[1], C]),
    right: poly([C, V[1], V[2], V[3]]),
    left: poly([V[5], C, V[3], V[4]]),
  };
})();

function cubicBezier(x1, y1, x2, y2) {
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const ct = 1 - t;
      const bx = 3 * ct * ct * t * x1 + 3 * ct * t * t * x2 + t * t * t;
      const dx = 3 * ct * ct * x1 + 6 * ct * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(dx) < 1e-6) break;
      t = Math.max(0, Math.min(1, t - (bx - x) / dx));
    }
    const ct = 1 - t;
    return 3 * ct * ct * t * y1 + 3 * ct * t * t * y2 + t * t * t;
  };
}

// smooth start, long soft arrival — the landing bounce provides the impact
const travelEase = cubicBezier(0.45, 0, 0.22, 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampPos = (v) => Math.min(100, Math.max(0, Number(v) || 0));

function currentScale(el) {
  if (!el || typeof getComputedStyle !== "function") return 1;
  const t = getComputedStyle(el).transform;
  const m = /matrix\(([^,]+),/.exec(t || "");
  const s = m ? parseFloat(m[1]) : 1;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

const DiceResultCube = forwardRef(function DiceResultCube(_props, ref) {
  const clipId = `dice-cube-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootRef = useRef(null); // positioned along the track (left: %)
  const bodyRef = useRef(null); // scaled, anchored at the bottom corner
  const textRef = useRef(null);
  const posRef = useRef(50);
  const rafRef = useRef(0);
  const pressedAtRef = useRef(0);
  const animRef = useRef(null);
  const waitersRef = useRef(new Set());
  const [shown, setShown] = useState(false);
  const [tone, setTone] = useState("idle"); // idle | moving | win | loss

  // unmounting mid-flight: stop the loop and let any awaiting caller go on
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      waitersRef.current.forEach((resolve) => resolve());
      waitersRef.current.clear();
    },
    []
  );

  const setPos = (p) => {
    posRef.current = p;
    if (rootRef.current) rootRef.current.style.left = `${p}%`;
    if (textRef.current) textRef.current.textContent = p.toFixed(2);
  };

  const scaleTo = (keyframes, options) => {
    const el = bodyRef.current;
    if (!el || typeof el.animate !== "function") return null;
    const next = el.animate(keyframes, { fill: "forwards", ...options });
    const prev = animRef.current;
    animRef.current = next;
    // drop the previous (filled) animation once the new one owns the scale
    if (prev && prev !== next) prev.cancel();
    return next;
  };

  useImperativeHandle(
    ref,
    () => ({
      press() {
        cancelAnimationFrame(rafRef.current);
        setShown(true);
        setTone("moving");
        pressedAtRef.current = performance.now();
        const from = currentScale(bodyRef.current);
        scaleTo([{ transform: `scale(${from})` }, { transform: `scale(${PRESSED})` }], {
          duration: CUBE_PRESS_MS,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        });
      },

      async land(value, won) {
        // begin travelling half-way through the shrink (or right away if the
        // result arrived later than that)
        const since = performance.now() - pressedAtRef.current;
        if (since < CUBE_PRESS_MS / 2) await sleep(CUBE_PRESS_MS / 2 - since);

        const from = posRef.current;
        const to = clampPos(value);
        const duration = Math.min(720, 320 + Math.abs(to - from) * 4.2);
        await new Promise((resolve) => {
          waitersRef.current.add(resolve);
          const t0 = performance.now();
          const step = (now) => {
            const t = Math.min(1, (now - t0) / duration);
            setPos(from + (to - from) * travelEase(t));
            if (t < 1) rafRef.current = requestAnimationFrame(step);
            else {
              waitersRef.current.delete(resolve);
              resolve();
            }
          };
          rafRef.current = requestAnimationFrame(step);
        });

        setPos(to);
        setTone(won ? "win" : "loss");
        // landing bounce: a quick rise that decelerates into 1.05, then it
        // settles back with a small damped overshoot (dips just under 1.00)
        scaleTo(
          [
            { transform: `scale(${PRESSED})`, easing: "cubic-bezier(0.22, 0.7, 0.35, 1)" },
            { transform: "scale(1.05)", offset: 0.34, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
            { transform: "scale(1)" },
          ],
          { duration: CUBE_BOUNCE_MS }
        );
      },

      release() {
        cancelAnimationFrame(rafRef.current);
        setTone("idle");
        const from = currentScale(bodyRef.current);
        scaleTo([{ transform: `scale(${from})` }, { transform: "scale(1)" }], {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
        });
      },

      markStale() {
        setTone((t) => (t === "win" || t === "loss" ? "idle" : t));
      },
    }),
    []
  );

  return (
    <div
      ref={rootRef}
      className={`${styles.cube} ${shown ? styles.cubeShown : ""}`}
      style={{ left: "50%" }}
      data-tone={tone}
      data-dice-cube=""
      aria-hidden={!shown}
    >
      <div ref={bodyRef} className={styles.cubeBody}>
        <svg className={styles.cubeSvg} viewBox={`0 0 ${HEX.w} ${HEX.h.toFixed(2)}`} aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clipId}>
              <path d={HEX.outline} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <polygon className={styles.faceTop} points={HEX.top} />
            <polygon className={styles.faceLeft} points={HEX.left} />
            <polygon className={styles.faceRight} points={HEX.right} />
          </g>
        </svg>
        <span ref={textRef} className={styles.cubeText}>
          50.00
        </span>
      </div>
    </div>
  );
});

export default DiceResultCube;
