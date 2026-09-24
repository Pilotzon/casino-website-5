import { useEffect, useMemo, useRef } from "react";

function buildMap(atlasFrames) {
  const map = new Map();
  const framesObj =
    atlasFrames?.frames && typeof atlasFrames.frames === "object"
      ? atlasFrames.frames
      : atlasFrames;

  if (!framesObj) return map;

  for (const [name, entry] of Object.entries(framesObj)) {
    if (!entry?.frame) continue;

    map.set(name, {
      sx: (entry.frame.x ?? 0) | 0,
      sy: (entry.frame.y ?? 0) | 0,
      sw: (entry.frame.w ?? entry.frame.width ?? 0) | 0,
      sh: (entry.frame.h ?? entry.frame.height ?? 0) | 0,
      sourceW: (entry.sourceSize?.w ?? (entry.frame.w ?? entry.frame.width) ?? 0) | 0,
      sourceH: (entry.sourceSize?.h ?? (entry.frame.h ?? entry.frame.height) ?? 0) | 0,
      offX: (entry.spriteSourceSize?.x ?? 0) | 0,
      offY: (entry.spriteSourceSize?.y ?? 0) | 0,
    });
  }
  return map;
}

export default function DragonCompositePlayer({
  src,
  atlasFrames,

  headAnim = null,
  wingsAnim = null,
  mode = "both", // "head" | "wings" | "both"

  forcedBox = { w: 1600, h: 720 },
  scale = 0.65,
  className = "",

  smoothing = true,
  dprCap = 1,

  blend = 0.65,

  // ✅ callback when a non-looping anim finishes
  onDone = null,
}) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);

  const dpr =
    typeof window !== "undefined"
      ? Math.min(dprCap, Math.max(1, window.devicePixelRatio || 1))
      : 1;

  const map = useMemo(() => buildMap(atlasFrames), [atlasFrames]);

  const needHead = mode === "head" || mode === "both";
  const needWings = mode === "wings" || mode === "both";

  const headFrames = headAnim?.frames || [];
  const wingsFrames = wingsAnim?.frames || [];

  const headLen = headFrames.length | 0;
  const wingsLen = wingsFrames.length | 0;

  const ok = (!needHead || headLen > 0) && (!needWings || wingsLen > 0);

  // choose timing source (if only head, use head fps/loop; if only wings, use wings fps/loop)
  const fps = Math.max(1, Number((needHead ? headAnim?.fps : wingsAnim?.fps) ?? 60));
  const loop = !!(needHead ? headAnim?.loop : wingsAnim?.loop);

  const cssW = Math.max(1, Math.round(forcedBox.w * scale));
  const cssH = Math.max(1, Math.round(forcedBox.h * scale));
  const bufW = Math.max(1, Math.round(cssW * dpr));
  const bufH = Math.max(1, Math.round(cssH * dpr));

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = bufW;
    c.height = bufH;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
  }, [bufW, bufH, cssW, cssH]);

  useEffect(() => {
    const img = new Image();
    imgRef.current = img;
    img.src = src;
    return () => {
      imgRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !ok) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawName = (name) => {
      const fr = map.get(name);
      if (!fr) return;

      const scaleX = forcedBox.w / Math.max(1, fr.sourceW);
      const scaleY = forcedBox.h / Math.max(1, fr.sourceH);

      const dx = Math.round(fr.offX * scaleX * scale);
      const dy = Math.round(fr.offY * scaleY * scale);
      const dw = Math.round(fr.sw * scaleX * scale);
      const dh = Math.round(fr.sh * scaleY * scale);

      ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, dw, dh);
    };

    const maxLen = Math.max(needHead ? headLen : 0, needWings ? wingsLen : 0);
    if (maxLen <= 0) return;

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let idx = 0;

    let prevIdx = 0;
    let doneCalled = false;

    const frameMs = 1000 / fps;

    const tick = (t) => {
      const dt = Math.min(100, t - last);
      last = t;

      acc += dt;
      while (acc >= frameMs) {
        acc -= frameMs;
        idx += 1;

        if (loop) {
          idx = idx % maxLen;
        } else {
          if (idx >= maxLen - 1) {
            idx = maxLen - 1;
            if (!doneCalled) {
              doneCalled = true;
              onDone?.();
            }
          }
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = !!smoothing;
      ctx.clearRect(0, 0, cssW, cssH);

      if (blend > 0) {
        ctx.globalAlpha = blend;
        if (needWings) drawName(wingsFrames[Math.min(prevIdx, wingsLen - 1)]);
        if (needHead) drawName(headFrames[Math.min(prevIdx, headLen - 1)]);
      }

      ctx.globalAlpha = 1;
      if (needWings) drawName(wingsFrames[Math.min(idx, wingsLen - 1)]);
      if (needHead) drawName(headFrames[Math.min(idx, headLen - 1)]);

      prevIdx = idx;

      raf = requestAnimationFrame(tick);
    };

    if (img.complete && img.naturalWidth > 0) raf = requestAnimationFrame(tick);
    else img.onload = () => (raf = requestAnimationFrame(tick));

    return () => cancelAnimationFrame(raf);
  }, [
    ok,
    map,
    forcedBox.w,
    forcedBox.h,
    scale,
    dpr,
    smoothing,
    blend,
    fps,
    loop,
    headFrames,
    wingsFrames,
    headLen,
    wingsLen,
    needHead,
    needWings,
    onDone,
    cssW,
    cssH,
  ]);

  return <canvas ref={canvasRef} className={className} />;
}