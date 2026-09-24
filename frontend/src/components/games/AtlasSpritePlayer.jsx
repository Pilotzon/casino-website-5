import { useEffect, useMemo, useRef, useState } from "react";

export default function AtlasSpritePlayer({
  src,
  atlasFrames,
  anim,
  playing = true,
  scale = 1,
  className = "",
  smoothing = true,
  forcedBox = null,
  anchor = "bottom-center",
  offset = { x: 0, y: 0 },
  frameIndex = null,
  dprCap = 2, // ✅ NEW: cap DPR (use 1 for max performance)
}) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const rafRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const dpr =
    typeof window !== "undefined"
      ? Math.min(dprCap, Math.max(1, window.devicePixelRatio || 1))
      : 1;

  const framesByName = useMemo(() => {
    const map = new Map();
    if (!atlasFrames) return map;

    if (Array.isArray(atlasFrames)) {
      for (const f of atlasFrames) {
        if (!f?.name) continue;
        const sx = (f.x ?? 0) | 0;
        const sy = (f.y ?? 0) | 0;
        const sw = (f.width ?? 0) | 0;
        const sh = (f.height ?? 0) | 0;
        map.set(f.name, { name: f.name, sx, sy, sw, sh, sourceW: sw, sourceH: sh, offX: 0, offY: 0 });
      }
      return map;
    }

    const framesObj =
      atlasFrames.frames && typeof atlasFrames.frames === "object"
        ? atlasFrames.frames
        : atlasFrames;

    for (const [name, entry] of Object.entries(framesObj)) {
      if (!entry?.frame) continue;

      const sx = (entry.frame.x ?? 0) | 0;
      const sy = (entry.frame.y ?? 0) | 0;
      const sw = (entry.frame.w ?? entry.frame.width ?? 0) | 0;
      const sh = (entry.frame.h ?? entry.frame.height ?? 0) | 0;

      const sourceW = (entry.sourceSize?.w ?? sw) | 0;
      const sourceH = (entry.sourceSize?.h ?? sh) | 0;

      const offX = (entry.spriteSourceSize?.x ?? 0) | 0;
      const offY = (entry.spriteSourceSize?.y ?? 0) | 0;

      map.set(name, { name, sx, sy, sw, sh, sourceW, sourceH, offX, offY });
    }

    return map;
  }, [atlasFrames]);

  const frameNames = anim?.frames || [];
  const fps = Math.max(1, Number(anim?.fps ?? 24));
  const loop = !!anim?.loop;

  const frames = useMemo(
    () => frameNames.map((n) => framesByName.get(n)).filter(Boolean),
    [frameNames, framesByName]
  );

  const maxBox = useMemo(() => {
    let mw = 1,
      mh = 1;
    for (const fr of frames) {
      mw = Math.max(mw, fr.sourceW | 0);
      mh = Math.max(mh, fr.sourceH | 0);
    }
    return { mw, mh };
  }, [frames]);

  const boxW = Math.max(1, (forcedBox?.w ?? maxBox.mw) | 0);
  const boxH = Math.max(1, (forcedBox?.h ?? maxBox.mh) | 0);

  const cssW = Math.max(1, Math.round(boxW * scale));
  const cssH = Math.max(1, Math.round(boxH * scale));
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

  const getAnchorOffset = (dw, dh) => {
    const cw = cssW;
    const ch = cssH;

    if (anchor === "center") return { dx: ((cw - dw) / 2) | 0, dy: ((ch - dh) / 2) | 0 };
    if (anchor === "top-center") return { dx: ((cw - dw) / 2) | 0, dy: 0 };
    return { dx: ((cw - dw) / 2) | 0, dy: (ch - dh) | 0 };
  };

  const drawFrame = (fr) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !fr) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = !!smoothing;
    ctx.clearRect(0, 0, cssW, cssH);

    const { dx, dy } = getAnchorOffset(cssW, cssH);

    const ox = Math.round(offset.x * scale);
    const oy = Math.round(offset.y * scale);

    const scaleX = boxW / Math.max(1, fr.sourceW);
    const scaleY = boxH / Math.max(1, fr.sourceH);

    const offXInBox = Math.round(fr.offX * scaleX * scale);
    const offYInBox = Math.round(fr.offY * scaleY * scale);

    const dw = Math.round(fr.sw * scaleX * scale);
    const dh = Math.round(fr.sh * scaleY * scale);

    ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx + ox + offXInBox, dy + oy + offYInBox, dw, dh);
  };

  useEffect(() => {
    setIsLoaded(false);
    const img = new Image();
    imgRef.current = img;
    img.onload = () => setIsLoaded(true);
    img.onerror = () => setIsLoaded(false);
    img.src = src;
    return () => {
      imgRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!frames.length) return;
    if (frameIndex == null) return;
    const i = ((frameIndex % frames.length) + frames.length) % frames.length;
    drawFrame(frames[i]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, frames, frameIndex, cssW, cssH, dpr, smoothing, anchor, scale, offset]);

  useEffect(() => {
    if (frameIndex != null) return;
    if (!isLoaded) return;
    if (!frames.length) return;

    const frameMs = 1000 / fps;
    let last = null;
    let acc = 0;
    let idx = 0;

    const tick = (t) => {
      if (!playing) {
        drawFrame(frames[0]);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (last == null) last = t;
      const dt = Math.min(100, t - last);
      last = t;

      acc += dt;
      while (acc >= frameMs) {
        acc -= frameMs;
        idx += 1;
        if (loop) idx = idx % frames.length;
        else idx = Math.min(idx, frames.length - 1);
      }

      drawFrame(frames[idx]);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [frameIndex, isLoaded, frames, playing, fps, loop, cssW, cssH, dpr, smoothing, anchor, scale, offset]);

  return <canvas ref={canvasRef} className={className} />;
}