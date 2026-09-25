import { useLayoutEffect, useRef, useState } from "react";

// Newest-first pill rows (Crash/Limbo/Dice/Wheel): when a pill is added,
// the whole row — the new pill included — slides in from the right as one
// motion. The container starts shifted right by exactly the new pill's
// width (+ gap), so the new pill begins off-view (clipped by the scroll
// wrapper's overflow) and glides into place with the row.
// Only additions slide; resets/shrinks snap with no motion.
// Returns { pillsRef, slideKey, slideFrom } for the pills container.
export default function usePillSlide(count) {
  const pillsRef = useRef(null);
  const prevCountRef = useRef(count);
  const [slide, setSlide] = useState({ key: 0, from: 0 });

  useLayoutEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (count <= prev) return;
    // row-reverse: the first DOM child is the newest (rightmost) pill
    const first = pillsRef.current?.firstElementChild;
    const gap = 6; // matches ui-history-pills gap
    const w = first ? Math.ceil(first.getBoundingClientRect().width) + gap : 68;
    setSlide((s) => ({ key: s.key + 1, from: w }));
  }, [count]);

  return { pillsRef, slideKey: slide.key, slideFrom: slide.from };
}
