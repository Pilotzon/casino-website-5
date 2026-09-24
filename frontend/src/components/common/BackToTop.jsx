import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./BackToTop.module.css";

/**
 * "Scroll up" pill, bottom-right of every page (mounted app-wide in App.jsx).
 *
 * It stays parked below the fold until the user scrolls past SHOW_AFTER px,
 * then slides up; clicking it scrolls the page back to the top. On a PC with a
 * mouse it also shows the small white tooltip used by the icon buttons in the
 * toolbar under the game box.
 */
const SHOW_AFTER = 300;

function BackToTop() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  const apply = useCallback((shouldShow) => {
    if (shouldShow === visibleRef.current) return;
    visibleRef.current = shouldShow;
    if (shouldShow) {
      setMounted(true); // render first, then transition in
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      setMounted(false);
    }
  }, []);

  useEffect(() => {
    const onScroll = () => apply(window.scrollY > SHOW_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [apply]);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  if (!mounted) return null;

  return (
    <button
      type="button"
      className={`${styles.backToTop} ${visible ? styles.visible : styles.hidden}`}
      onClick={scrollTop}
      aria-label="Scroll up"
      title="Scroll up"
      data-tip="Scroll up"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}

export default BackToTop;
