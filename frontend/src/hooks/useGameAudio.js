import { useCallback, useEffect, useMemo, useRef } from "react";

export default function useGameAudio(sources = {}, options = {}) {
  const baseRef = useRef({}); // { key: HTMLAudioElement }

  const enabled = options?.enabled ?? true;
  const masterVolume = typeof options?.volume === "number" ? options.volume : 1;

  useEffect(() => {
    const entries = Object.entries(sources);
    const map = {};

    for (const [key, src] of entries) {
      if (!src) continue;
      const a = new Audio(src);
      a.preload = "auto";
      map[key] = a;
    }

    baseRef.current = map;

    return () => {
      for (const a of Object.values(map)) {
        try {
          a.pause();
          a.src = "";
        } catch {
          // ignore
        }
      }
    };
  }, [sources]);

  const play = useCallback(
    (key, opts = {}) => {
      if (!enabled) return;

      const base = baseRef.current?.[key];
      if (!base) return;

      const localVol = typeof opts.volume === "number" ? opts.volume : 1;
      const vol = Math.max(0, Math.min(1, masterVolume * localVol));
      if (vol <= 0) return;

      const rate = typeof opts.rate === "number" ? opts.rate : 1;

      try {
        const node = base.cloneNode(true);
        node.volume = vol;
        node.playbackRate = rate;

        const p = node.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        // ignore
      }
    },
    [enabled, masterVolume]
  );

  return useMemo(() => ({ play }), [play]);
}