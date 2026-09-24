import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import AnimatedDepositToast from "./AnimatedDepositToast";
import styles from "./DepositToastStack.module.css";

export default function DepositToastStack({ toasts = [], onRemove }) {
    const host = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);

    const remove = useCallback(
        (id) => {
            onRemove?.(id);
        },
        [onRemove]
    );

    const ordered = useMemo(() => {
        const arr = Array.isArray(toasts) ? toasts.slice() : [];
        // ✅ Reverse sort so newest is at bottom (index 0 = bottom)
        arr.sort((a, b) => Number(b.id) - Number(a.id));
        return arr;
    }, [toasts]);

    if (!host || ordered.length === 0) return null;

    return createPortal(
        <div className={styles.stackHost} role="region" aria-label="Notifications">
            {ordered.map((t, idx) => (
                <div
                    key={t.id}
                    className={styles.stackItem}
                    style={{ bottom: `${idx * 72}px` }} /* ✅ Stack upward from bottom */
                >
                    <AnimatedDepositToast
                        open={true}
                        toastKey={t.id}
                        text={t.text}
                        durationMs={t.durationMs ?? 2200}
                        onClose={() => remove(t.id)}
                        inline={true}
                    />
                </div>
            ))}
        </div>,
        host
    );
}