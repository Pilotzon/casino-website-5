import { useEffect, useRef } from "react";
import { IconArticle } from "./Icons";
import styles from "./historyPills.module.css";

/* ============================================================================
 * History pills — the ONE row of result pills shown above the board in Crash,
 * Wheel, Dice and Limbo (so every game behaves exactly the same way).
 *
 *   • newest round at the TOP RIGHT, older rounds continue to the left;
 *   • green pill = the player won that round, gray = lost;
 *   • desktop: old rounds fade out under the left edge;
 *     phones: the row scrolls sideways and the newest stays pinned right.
 *
 * items: [{ key, label, won }] — newest FIRST (server order).
 * ==========================================================================*/
export default function HistoryPills({ items = [], className = "", youLabel = "‹ You", iconLabel = "My bets" }) {
  const scrollRef = useRef(null);
  const newestKey = items[0]?.key;

  // A new round must be visible even if the player had scrolled back through
  // older ones: jump the scroller (only the scroller — never the page) back to
  // its start, which is the right edge in this right-to-left row.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollLeft !== 0) el.scrollLeft = 0;
  }, [newestKey]);

  return (
    <div className={`${styles.historyRow} ${className}`} data-history-pills="">
      <div className={styles.historyScroll} ref={scrollRef}>
        <div className={styles.historyPills}>
          {items.map((h) => (
            <span key={h.key} className={`${styles.histPill} ${h.won ? styles.histGreen : styles.histGray}`}>
              {h.label}
            </span>
          ))}
        </div>
      </div>
      <button className={styles.historyIcon} type="button" aria-label={iconLabel} title={iconLabel}>
        <IconArticle size={18} />
      </button>
      <span className={styles.historyYou}>{youLabel}</span>
    </div>
  );
}
