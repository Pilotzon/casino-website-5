import { useEffect, useRef, useState } from "react";

/**
 * Keeps a conditionally-rendered element mounted for `ms` after `open`
 * flips false, so its CSS exit animation can play.
 * Returns [mounted, closing].
 */
export default function useStayMounted(open, ms = 190) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      timer.current = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, ms);
    }
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return [mounted, closing];
}
