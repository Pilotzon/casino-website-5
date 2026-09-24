import { useEffect, useState } from "react";
import Modal from "./Modal";
import { useActiveBets } from "../../context/ActiveBetContext";
import styles from "./RefreshGuard.module.css";

/**
 * Warns the player before a page refresh while a bet is live.
 *
 *  • F5 / Ctrl+R / Cmd+R are intercepted and answered with the in-app prompt
 *    ("Refreshing the page will not save") so the message is readable.
 *  • The browser's own reload button / closing the tab cannot show custom
 *    text, so a `beforeunload` handler is registered as a fallback — the
 *    browser then asks for confirmation with its own generic wording.
 *
 * Both only exist while a game reports an active bet, so normal navigation
 * and normal refreshes are completely unaffected.
 */
export default function RefreshGuard() {
  const { hasActiveBet } = useActiveBets();
  const [promptOpen, setPromptOpen] = useState(false);

  // close the prompt if the bet resolves on its own (cash-out / crash)
  useEffect(() => {
    if (!hasActiveBet && promptOpen) setPromptOpen(false);
  }, [hasActiveBet, promptOpen]);

  // native fallback (browser reload button, Cmd+Q, tab close …)
  useEffect(() => {
    if (!hasActiveBet) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "Refreshing the page will not save";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasActiveBet]);

  // keyboard reloads → custom prompt
  useEffect(() => {
    if (!hasActiveBet) return undefined;
    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();
      const isReloadKey = key === "f5" || ((e.ctrlKey || e.metaKey) && key === "r");
      if (!isReloadKey) return;
      e.preventDefault();
      e.stopPropagation();
      setPromptOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hasActiveBet]);

  const reload = () => {
    setPromptOpen(false);
    window.location.reload();
  };

  return (
    <Modal
      isOpen={promptOpen}
      onClose={() => setPromptOpen(false)}
      title="Refreshing the page will not save"
      size="md"
      bodyClassName={styles.body}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
          <path d="M20.5 4v5h-5" />
        </svg>
      }
      description="You are still in a round. Refreshing will not save your progress and can leave you without a result."
      footer={<span className={styles.footer}>Press Esc or choose an option below.</span>}
    >
      <div className={styles.actions}>
        <button type="button" className={styles.stay} onClick={() => setPromptOpen(false)}>
          Stay in the round
        </button>
        <button type="button" className={styles.leave} onClick={reload}>
          Refresh anyway
        </button>
      </div>
    </Modal>
  );
}
