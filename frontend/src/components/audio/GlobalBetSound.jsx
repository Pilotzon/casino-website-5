import { useEffect, useRef } from "react";
import betMp3 from "../../assets/Bet.mp3";

export default function GlobalBetSound({ enabled = true, volume = 0.8 }) {
  const baseRef = useRef(null);

  useEffect(() => {
    baseRef.current = new Audio(betMp3);
    baseRef.current.preload = "auto";
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      const el = e.target.closest?.("[data-bet-sound='true']");
      if (!el) return;

      // don't play if disabled
      if (el.disabled) return;
      if (el.getAttribute?.("aria-disabled") === "true") return;

      if (!enabled || volume <= 0) return;

      try {
        const a = baseRef.current?.cloneNode(true);
        if (!a) return;
        a.volume = Math.max(0, Math.min(1, volume));
        const p = a.play();
        if (p?.catch) p.catch(() => {});
      } catch {
        // ignore
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, volume]);

  return null;
}