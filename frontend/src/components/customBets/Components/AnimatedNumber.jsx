import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Smoothly animates numeric text changes (fast, no libs).
 * Props:
 * - value: number
 * - format: (n)=>string
 * - durationMs
 */
export default function AnimatedNumber({ value, format, durationMs = 220 }) {
  const [display, setDisplay] = useState(Number(value) || 0);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const fromRef = useRef(display);
  const toRef = useRef(Number(value) || 0);

  const fmt = useMemo(() => format || ((n) => String(n)), [format]);

  useEffect(() => {
    const from = display;
    const to = Number(value) || 0;

    fromRef.current = from;
    toRef.current = to;
    startRef.current = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - startRef.current) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(cur);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{fmt(display)}</>;
}