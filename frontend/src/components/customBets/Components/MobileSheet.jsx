import styles from "./MobileSheet.module.css";

export default function MobileSheet({ open, title, onClose, children }) {
  return (
    <div className={`${styles.backdrop} ${open ? styles.open : ""}`} onClick={onClose}>
      <div className={`${styles.sheet} ${open ? styles.sheetOpen : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.top}>
          <button className={styles.close} onClick={onClose} type="button" aria-label="Close">
            ‹
          </button>
          <div className={styles.title}>{title}</div>
          <div className={styles.spacer} />
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}