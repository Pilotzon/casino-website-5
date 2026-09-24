import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ChanceGraph.module.css";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function safeTime(t) {
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d : null;
}
function monthLabel(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short" });
}

/**
 * ✅ Smooth chart spline as cubic Beziers, with no overshoot:
 * Monotone cubic spline (Fritsch–Carlson) -> cubic Bézier path.
 */
function monotoneBezierPath(points) {
  if (!points || points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const n = points.length;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const dx = new Array(n - 1);
  const dy = new Array(n - 1);
  const m = new Array(n - 1); // secant slopes

  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    dy[i] = ys[i + 1] - ys[i];
    m[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
  }

  // initial tangents
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = (m[i - 1] + m[i]) / 2;

  // Fritsch–Carlson monotonicity constraints
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }

  // cubic Bezier segments
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i],
      y0 = ys[i];
    const x1 = xs[i + 1],
      y1 = ys[i + 1];
    const h = dx[i];

    const c1x = x0 + h / 3;
    const c1y = y0 + (t[i] * h) / 3;

    const c2x = x1 - h / 3;
    const c2y = y1 - (t[i + 1] * h) / 3;

    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x1} ${y1}`;
  }
  return d;
}

function buildPlotPointsFromSeries(series, dims) {
  if (!series || series.length < 2) return [];
  const n = series.length;
  return series.map((p, i) => {
    const u = i / Math.max(1, n - 1);
    return {
      x: dims.padL + u * dims.plotW,
      y: dims.yTo(Number(p.v) || 0),
    };
  });
}

export default function ChanceGraph({
  points = [],
  height = 260,
  onHoverPoint,
  activeLabel,
  redrawKey,
  morphKey,
}) {
  const wrapRef = useRef(null);
  const pathRef = useRef(null); // ✅ used to sample the actual curved SVG path
  const didDrawOnceRef = useRef(false);

  const [w, setW] = useState(900);

  const [shouldAnimateDraw, setShouldAnimateDraw] = useState(true);

  const [hoverX01, setHoverX01] = useState(null);
  const draggingRef = useRef(false);

  // morph
  const rafRef = useRef(null);
  const prevYsRef = useRef(null);
  const [morphYs, setMorphYs] = useState(null);

  // draw animation control
  const [drawNonce, setDrawNonce] = useState(0);
  const lastRedrawRef = useRef(undefined);

const [splitXAnim, setSplitXAnim] = useState(null); // px position of mask boundary
const leaveRafRef = useRef(null);
const leavingRef = useRef(false);
const lastHoverHandleXRef = useRef(null);

  useEffect(() => {
    setDrawNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const rk = redrawKey ?? "0";
    if (lastRedrawRef.current === undefined) {
      lastRedrawRef.current = rk;
      return;
    }
    if (lastRedrawRef.current !== rk) {
      lastRedrawRef.current = rk;
      setDrawNonce((n) => n + 1);
    }
  }, [redrawKey]);

useEffect(() => {
  setShouldAnimateDraw(true);
}, [drawNonce]);

useEffect(() => {
  return () => cancelAnimationFrame(leaveRafRef.current);
}, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setW(Math.max(320, r.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = points || [];

  const maxSeen = useMemo(() => {
    const vals = pts.map((p) => Number(p.v) || 0);
    const m = Math.max(...vals, 0);
    if (m <= 20) return 20;
    if (m <= 60) return 60;
    return 100;
  }, [pts]);

  const dims = useMemo(() => {
    const padL = 14;
    const padR = 54;
    const padT = 18;
    const padB = 40;

    const minV = 0;
    const maxV = maxSeen;

    const plotW = w - padL - padR;
    const plotH = height - padT - padB;

    const xFrom01 = (u) => padL + clamp(u, 0, 1) * plotW;
    const yTo = (v) => padT + plotH * (1 - (v - minV) / (maxV - minV || 1));

    // inverse mapping: screen y -> value
    const vFromY = (y) => {
      const u = clamp(1 - (y - padT) / (plotH || 1), 0, 1);
      return minV + u * (maxV - minV);
    };

    return { padL, padR, padT, padB, minV, maxV, plotW, plotH, xFrom01, yTo, vFromY };
  }, [w, height, maxSeen]);

  const yTicks = useMemo(() => {
    if (maxSeen === 20) return [10, 20];
    if (maxSeen === 60) return [10, 20, 30, 40, 50, 60];
    const out = [];
    for (let v = 0; v <= 100; v += 10) out.push(v);
    return out;
  }, [maxSeen]);

  const months = useMemo(() => {
    if (!pts || pts.length < 2) return [];
    const out = [];
    let last = "";
    for (let i = 0; i < pts.length; i++) {
      const m = monthLabel(pts[i].t);
      if (m && m !== last) {
        out.push({ i, label: m, x01: i / Math.max(1, pts.length - 1) });
        last = m;
      }
    }
    return out.slice(0, 6);
  }, [pts]);

  // morph values match REAL point count
  const targetYs = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    return pts.map((p) => Number(p.v) || 0);
  }, [pts]);

  useEffect(() => {
    if (!targetYs) return;
    if (!morphYs) setMorphYs(targetYs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetYs]);

  useEffect(() => {
    if (!targetYs) return;
    if (!morphKey) return;

    const from = morphYs || prevYsRef.current || targetYs;
    const to = targetYs;
    prevYsRef.current = to;

    if (!from || from.length !== to.length) {
      setMorphYs(to);
      return;
    }

    const dur = 520;
    const start = performance.now();

    const tick = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setMorphYs(from.map((a, i) => lerp(a, to[i], eased)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphKey]);

  useEffect(() => {
    if (!targetYs) return;
    setMorphYs(targetYs);
    prevYsRef.current = targetYs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redrawKey]);

  const plotPoints = useMemo(() => buildPlotPointsFromSeries(pts, dims), [pts, dims]);

  const morphedPlotPoints = useMemo(() => {
    if (!plotPoints.length) return [];
    if (!morphYs || morphYs.length !== plotPoints.length) return plotPoints;
    return plotPoints.map((p, i) => ({ x: p.x, y: dims.yTo(morphYs[i]) }));
  }, [plotPoints, morphYs, dims]);

  const pathD = useMemo(() => monotoneBezierPath(morphedPlotPoints), [morphedPlotPoints]);

  const endPoint = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    const last = pts[pts.length - 1];
    return {
      x: dims.padL + dims.plotW,
      y: dims.yTo(Number(last?.v) || 0),
      t: last?.t,
      v: Number(last?.v) || 0,
    };
  }, [pts, dims]);

  /**
   * ✅ NEW: sample the ACTUAL curved svg path so the handle sits on the line.
   * We binary-search along the path length for x ≈ targetX.
   */
  const handlePoint = useMemo(() => {
    if (!pathD) return null;

    // when not hovering, stick to end point
    if (hoverX01 == null) return endPoint ? { x: endPoint.x, y: endPoint.y } : null;

    const el = pathRef.current;
    if (!el) return null;

    const xTarget = dims.xFrom01(hoverX01);
    const total = el.getTotalLength();
    if (!Number.isFinite(total) || total <= 0) return null;

    let lo = 0;
    let hi = total;

    let best = el.getPointAtLength(0);
    let bestDx = Infinity;

    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      const p = el.getPointAtLength(mid);
      const dx = p.x - xTarget;

      const adx = Math.abs(dx);
      if (adx < bestDx) {
        bestDx = adx;
        best = p;
      }

      if (dx < 0) lo = mid;
      else hi = mid;
    }

    return { x: best.x, y: best.y };
  }, [pathD, hoverX01, dims, endPoint]);

  const handleX = handlePoint?.x ?? null;
  const handleY = handlePoint?.y ?? null;

  /**
   * Keep time interpolation as before, but value comes from the curve position
   * so tooltip % matches the handle.
   */
  const hoverData = useMemo(() => {
    if (hoverX01 == null) return null;
    if (!pts || pts.length < 2) return null;

    const u = clamp(hoverX01, 0, 1);
    const pos = u * (pts.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(pts.length - 1, i0 + 1);
    const t = pos - i0;

    const p0 = pts[i0];
    const p1 = pts[i1];

    const d0 = safeTime(p0?.t);
    const d1 = safeTime(p1?.t);
    let tIso = p0?.t;
    if (d0 && d1) {
      const ms = lerp(d0.getTime(), d1.getTime(), t);
      tIso = new Date(ms).toISOString();
    }

    // ✅ value from curve (so handle + tooltip agree)
    const v = handleY != null ? dims.vFromY(handleY) : lerp(Number(p0?.v) || 0, Number(p1?.v) || 0, t);

    return { t: tIso, v };
  }, [hoverX01, pts, handleY, dims]);

  const isHovering = hoverX01 != null;

  // time label follows handle
  const timeBoxW = 240;
  const half = timeBoxW / 2;
  const timeStyle = useMemo(() => {
    const x = handleX;
    if (x == null) return { left: "50%", marginLeft: `-${half}px`, textAlign: "center" };
    if (x <= half + 6) return { left: "6px", marginLeft: "0px", textAlign: "left" };
    if (x >= w - dims.padR - half - 6) {
      return { left: `${w - dims.padR - 6}px`, marginLeft: `-${timeBoxW}px`, textAlign: "right" };
    }
    return { left: `${x}px`, marginLeft: `-${half}px`, textAlign: "center" };
  }, [handleX, w, dims.padR, half]);

  const timeData = isHovering ? hoverData : endPoint ? { t: endPoint.t, v: endPoint.v } : null;
  const timeObj = timeData?.t ? safeTime(timeData.t) : null;

  const tip = useMemo(() => {
    if (!isHovering || !hoverData || handleX == null || handleY == null) return null;

    const pct = Math.round(Number(hoverData.v) || 0);
    const label = activeLabel || "Option";
    const text = `${label} ${pct}%`;

    const pillW = clamp(10 + text.length * 7.2, 90, 190);
    const pillH = 24;

    const pad = 10;
    const topAvoid = 34;
    const rightAvoid = dims.padR + 8;

    let x = handleX + 12;
    if (x + pillW > w - rightAvoid) x = handleX - pillW - 12;
    x = clamp(x, pad, w - rightAvoid - pillW);

    let y = handleY - 28;
    y = clamp(y, topAvoid, height - dims.padB - pillH - 6);

    return { x, y, w: pillW, h: pillH, text };
  }, [isHovering, hoverData, handleX, handleY, activeLabel, w, height, dims.padB, dims.padR]);

  // masks
  const splitX = splitXAnim;
  const maskIdLeft = "mask-left-stable";
  const maskIdRight = "mask-right-stable";

  const setHoverFromClientX = (clientX) => {
    const el = wrapRef.current;
    if (!el || pts.length < 2) return;
    const r = el.getBoundingClientRect();
    const u = clamp((clientX - r.left) / r.width, 0, 1);
    setHoverX01(u);
  };

useEffect(() => {
  if (hoverX01 != null && handleX != null) {
    // hovering => keep masks following cursor and remember last X
    leavingRef.current = false;
    cancelAnimationFrame(leaveRafRef.current);

    lastHoverHandleXRef.current = handleX; // ✅ REQUIRED for leave animation start
    setSplitXAnim(handleX);
  }
}, [hoverX01, handleX]);

const clearHover = () => {
  if (draggingRef.current) return;

  // if we can't animate, just clear everything
  if (!endPoint) {
    setHoverX01(null);
    setSplitXAnim(null);
    leavingRef.current = false;
    onHoverPoint?.(null, null);
    return;
  }

  // ✅ TELEPORT + HIDE HANDLE FIRST
  // This removes hover UI instantly (handle/crosshair/tooltip).
  setHoverX01(null);
  onHoverPoint?.(null, null);

  // animate the split boundary to the end
const fromX = lastHoverHandleXRef.current;
if (fromX == null) {
  setSplitXAnim(null);
  return;
}
setSplitXAnim(fromX);

  leavingRef.current = true;
  cancelAnimationFrame(leaveRafRef.current);

  const toX = endPoint.x;
  const dur = 420;
  const start = performance.now();

  const tick = (now) => {
    const t = clamp((now - start) / dur, 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    setSplitXAnim(lerp(fromX, toX, eased));

    if (t < 1) {
      leaveRafRef.current = requestAnimationFrame(tick);
    } else {
      setSplitXAnim(null); // ✅ remove masks after finish
      leavingRef.current = false;
    }
  };

  leaveRafRef.current = requestAnimationFrame(tick);
};

  // call onHoverPoint whenever computed hoverData changes
  useEffect(() => {
    if (!onHoverPoint) return;
    if (!isHovering) return;
    onHoverPoint(hoverData ?? null, hoverX01);
  }, [onHoverPoint, isHovering, hoverData, hoverX01]);

  const onPointerDown = (e) => {
    if (pts.length < 2) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setHoverX01(clamp((e.clientX - r.left) / r.width, 0, 1));
  };

  const onPointerMove = (e) => {
    if (pts.length < 2) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setHoverX01(clamp((e.clientX - r.left) / r.width, 0, 1));
  };

  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className={styles.wrap} ref={wrapRef} style={{ height }}>
      <div className={`${styles.hoverTimeTop} ${timeObj ? styles.hoverTimeTopOpen : ""}`} style={timeStyle}>
        {timeObj ? timeObj.toLocaleString() : ""}
      </div>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={clearHover}
onMouseMove={(e) => {
  if (draggingRef.current) return;
  if (leavingRef.current) return; // ✅ don't re-enter hover during leave anim
  setHoverFromClientX(e.clientX);
}}
        onMouseLeave={clearHover}
      >
        <defs>
          {splitX != null ? (
            <>
              <mask id={maskIdLeft} maskUnits="userSpaceOnUse">
                <rect x="0" y="0" width={splitX} height={height} fill="white" />
                <rect x={splitX} y="0" width={w - splitX} height={height} fill="black" />
              </mask>
              <mask id={maskIdRight} maskUnits="userSpaceOnUse">
                <rect x="0" y="0" width={splitX} height={height} fill="black" />
                <rect x={splitX} y="0" width={w - splitX} height={height} fill="white" />
              </mask>
            </>
          ) : null}
        </defs>

        {/* grid */}
        {yTicks.map((v) => {
          const y = dims.yTo(v);
          return <line key={v} x1={0} x2={w} y1={y} y2={y} className={styles.grid} />;
        })}

{/* line */}
{pathD ? (
  splitX != null ? (
    <>
      <path
        ref={pathRef}
        d={pathD}
        className={styles.lineStatic}
        fill="none"
        mask={`url(#${maskIdLeft})`}
      />
      <path
        d={pathD}
        className={styles.lineFuture}
        fill="none"
        mask={`url(#${maskIdRight})`}
      />
    </>
  ) : shouldAnimateDraw ? (
    <path
      ref={pathRef}
      key={`draw-${drawNonce}`}   // only changes when redrawKey changes / mount
      d={pathD}
      className={styles.lineAnim}
      fill="none"
      pathLength="1"
      onAnimationEnd={() => setShouldAnimateDraw(false)} // ✅ after first draw, stay static
    />
  ) : (
    <path
      ref={pathRef}
      d={pathD}
      className={styles.lineStatic} // ✅ leaving hover returns to static, no replay
      fill="none"
    />
  )
) : null}
        {/* scan overlay only on draw (not on hover state) */}
        {pathD && splitX == null ? (
          <path key={`scan-${drawNonce}`} d={pathD} className={styles.scanLine} fill="none" pathLength="1" />
        ) : null}

        {/* hover crosshair */}
        {isHovering && handleX != null ? <line x1={handleX} x2={handleX} y1={0} y2={height} className={styles.hoverLine} /> : null}

        {/* tooltip */}
        {tip ? (
          <g transform={`translate(${tip.x}, ${tip.y})`} className={styles.tip}>
            <rect width={tip.w} height={tip.h} rx="8" className={styles.tipBg} />
            <text x="10" y="16" className={styles.tipText}>
              {tip.text}
            </text>
          </g>
        ) : null}

        {/* handle */}
        {handleX != null && handleY != null ? <circle cx={handleX} cy={handleY} r="5" className={styles.handleDot} /> : null}

        {/* end shockwave */}
        {!isHovering && endPoint ? (
          <>
            <circle cx={endPoint.x} cy={endPoint.y} r="5" className={styles.endDot} />
            <circle cx={endPoint.x} cy={endPoint.y} r="12" className={styles.shockwave}>
              <animateTransform
                attributeName="transform"
                type="translate"
                values={`${endPoint.x} ${endPoint.y}; ${endPoint.x} ${endPoint.y}`}
                dur="1.25s"
                repeatCount="indefinite"
              />
              <animateTransform attributeName="transform" additive="sum" type="scale" from="0.55" to="1.75" dur="1.25s" repeatCount="indefinite" />
              <animateTransform
                attributeName="transform"
                additive="sum"
                type="translate"
                from={`${-endPoint.x} ${-endPoint.y}`}
                to={`${-endPoint.x} ${-endPoint.y}`}
                dur="1.25s"
                repeatCount="indefinite"
              />
              <animate attributeName="opacity" from="0.35" to="0" dur="1.25s" repeatCount="indefinite" />
            </circle>
          </>
        ) : null}

        {/* axis */}
        {yTicks.map((v) => {
          const y = dims.yTo(v);
          return (
            <text key={`yt${v}`} x={w - 10} y={y + 4} textAnchor="end" className={styles.axisText}>
              {v}%
            </text>
          );
        })}

        {/* months */}
        {months.map((m) => {
          const x = dims.padL + m.x01 * dims.plotW;
          return (
            <text key={`${m.label}-${m.i}`} x={x} y={height - 10} textAnchor="middle" className={styles.monthText}>
              {m.label}
            </text>
          );
        })}
      </svg>

      {!pts || pts.length < 2 ? <div className={styles.empty}>Not enough deposits yet</div> : null}
    </div>
  );
}