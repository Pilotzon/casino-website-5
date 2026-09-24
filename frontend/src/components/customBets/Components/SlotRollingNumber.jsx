import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SlotRollingNumber.module.css";

/**
 * Slot/Odometer style rolling for numbers.
 * - value: number
 * - format: (n)=>string  (should return a fixed-ish shape string for best results)
 * - durationMs
 *
 * Implementation:
 * We animate by transitioning each digit column to the new digit using translateY.
 * Non-digit characters are rendered as static glyphs.
 */
export default function SlotRollingNumber({
  value,
  format,
  durationMs = 380,
  className = "",
}) {
  const fmt = useMemo(() => format || ((n) => String(n)), [format]);

  const targetStr = useMemo(() => {
    // Keep it deterministic (avoid NaN / Infinity)
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return String(fmt(n));
  }, [value, fmt]);

  // Keep previous string to stabilize width during transitions
  const prevStrRef = useRef(targetStr);
  const [renderStr, setRenderStr] = useState(targetStr);

  useEffect(() => {
    // Update render string immediately, but keep previous around for comparison
    prevStrRef.current = renderStr;
    setRenderStr(targetStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetStr]);

  // For digits we need a per-position "from" digit to allow smooth roll when length changes
  const columns = useMemo(() => {
    const prev = prevStrRef.current || "";
    const next = renderStr || "";

    const len = Math.max(prev.length, next.length);
    const padLeft = (s) => s.padStart(len, " ");
    const a = padLeft(prev);
    const b = padLeft(next);

    return Array.from({ length: len }).map((_, i) => {
      const fromCh = a[i];
      const toCh = b[i];
      const fromDigit = fromCh >= "0" && fromCh <= "9" ? Number(fromCh) : null;
      const toDigit = toCh >= "0" && toCh <= "9" ? Number(toCh) : null;

      return { fromCh, toCh, fromDigit, toDigit };
    });
  }, [renderStr]);

  return (
    <span
      className={`${styles.wrap} ${className}`}
      style={{ ["--dur"]: `${durationMs}ms` }}
      aria-label={renderStr}
    >
      {columns.map((c, idx) => {
        const isDigit = c.toDigit != null;

        if (!isDigit) {
          // static char (%, $, spaces, commas, dots, etc.)
          return (
            <span key={idx} className={styles.glyph}>
              {c.toCh === " " ? "\u00A0" : c.toCh}
            </span>
          );
        }

        // Digit column: a 0-9 stack, translate to new digit
        return (
          <span key={idx} className={styles.digitCol} aria-hidden="true">
            <span
              className={styles.digitStack}
              style={{ transform: `translateY(${-c.toDigit * 10}%)` }}
            >
              {Array.from({ length: 10 }).map((_, d) => (
                <span key={d} className={styles.digit}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}