import { useLayoutEffect, useRef, useState } from "react";

// Newest-first pill rows (Crash/Limbo/Dice/Wheel): when a NEW pill arrives,
// the whole row — the new pill included — slides in from the right as one
// motion. The container starts shifted right by exactly the new pill's
// width (+ gap), so the new pill begins off-view (past the stage's right
// edge, clipped by the scroll wrapper's overflow) and glides into place
// with the row while the older pills shift left in the same motion.
// Keyed on the NEWEST pill's identity — never the row length, because
// histories are capped: the length stops changing while new pills keep
// arriving, and a length key would silently stop sliding past the cap.
// Only additions slide; resets/shrinks snap with no motion.
// Returns { pillsRef, slideKey, slideFrom } for the pills container.
export default function usePillSlide(newestKey) {
  const pillsRef = useRef(null);
  const prevKeyRef = useRef(newestKey);
  const [slide, setSlide] = useState({ key: 0, from: 0 });

  useLayoutEffect(() => {
    const prev = prevKeyRef.current;
    prevKeyRef.current = newestKey;
    if (newestKey == null || newestKey === prev) return;
    // row-reverse: the first DOM child is the newest (rightmost) pill
    const first = pillsRef.current?.firstElementChild;
    const gap = 6; // matches ui-history-pills gap
    const w = first ? Math.ceil(first.getBoundingClientRect().width) + gap : 68;
    setSlide((s) => ({ key: s.key + 1, from: w }));
  }, [newestKey]);

  return { pillsRef, slideKey: slide.key, slideFrom: slide.from };
}
