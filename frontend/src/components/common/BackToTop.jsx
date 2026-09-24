import { useEffect, useState } from "react";
import styles from "./BackToTop.module.css";

function BackToTop() {
  const [visible, setVisible] = useState(false);
  const [render, setRender] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const shouldShow = window.scrollY > 300;
      if (shouldShow && !visible) {
        setRender(true);
        requestAnimationFrame(() => setVisible(true));
      } else if (!shouldShow && visible) {
        setVisible(false);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [visible]);

  const handleTransitionEnd = () => {
    if (!visible) setRender(false);
  };

  const scrollTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!render) return null;

  return (
    <button
      type="button"
      className={`${styles.backToTop} ${visible ? styles.visible : styles.hidden}`}
      onClick={scrollTop}
      aria-label="Back to top"
      data-tip="Back to top"
      onTransitionEnd={handleTransitionEnd}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 18V6M12 6l-6 6M12 6l6 6" />
      </svg>
      <span className={styles.tooltip}>Back to top</span>
    </button>
  );
}

export default BackToTop;
