import { createContext, useContext, useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconCheckCircle,
  IconXCircle,
  IconInfo as IconInfoFilled,
  IconWarning as IconWarningFilled,
  IconTrendDownCircle,
  IconX as IconClose,
} from "../components/common/Icons";
import "./toast.css";

const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
};

const DEFAULT_DURATION = 3000;
const LEAVE_MS = 220;

/* ===== ICONS — the shared filled set (common/Icons.jsx) =====
   Status icons are solid discs/triangles with the glyph knocked out. */
const ICON_SIZE = 26;
const IconCheck = () => <IconCheckCircle size={ICON_SIZE} />;
const IconCross = () => <IconXCircle size={ICON_SIZE} />;
const IconInfo = () => <IconInfoFilled size={ICON_SIZE} />;
const IconWarning = () => <IconWarningFilled size={ICON_SIZE} />;

/* Loss: a falling chart line (in a disc, like the others) — reads as "the
   round went against you", which is NOT an error (nothing failed). */
const IconTrendDown = () => <IconTrendDownCircle size={ICON_SIZE} />;

const IconX = () => <IconClose size={20} />;

const iconByType = {
  success: <IconCheck />,
  error: <IconCross />,
  loss: <IconTrendDown />,
  info: <IconInfo />,
  warning: <IconWarning />,
};

function ToastCard({ t, type, title, message, duration }) {
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  const requestClose = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    window.setTimeout(() => toast.dismiss(t.id), LEAVE_MS);
  };

  // If react-hot-toast marks it not visible (e.g. dismissed), play leave animation
  useEffect(() => {
    if (!t.visible) requestClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.visible]);

  return (
    <div className={`appToast appToast--${type} ${leaving ? "appToast--leave" : "appToast--enter"}`}>
      <div className="appToast__accent">
        <div className="appToast__icon">{iconByType[type]}</div>
      </div>

      <div className="appToast__body">
        <p className="appToast__title">{title}</p>
        <p className="appToast__msg">{message}</p>
      </div>

      <button className="appToast__close" onClick={requestClose} aria-label="Close">
        <IconX />
      </button>

      <div className="appToast__progressWrap">
        <div
          className="appToast__progress"
          style={{
            animationDuration: `${duration}ms`,
            animationPlayState: t.visible && !leaving ? "running" : "paused",
          }}
          onAnimationEnd={requestClose}
        />
      </div>
    </div>
  );
}

function showAppToast({ type, title, message, duration = DEFAULT_DURATION }) {
  return toast.custom((t) => (
    <ToastCard t={t} type={type} title={title} message={message} duration={duration} />
  ), { duration });
}

export const ToastProvider = ({ children }) => {
  const success = (message, opts) =>
    showAppToast({ type: "success", title: "Success", message, duration: opts?.duration });

  const error = (message, opts) =>
    showAppToast({ type: "error", title: "Error", message, duration: opts?.duration });

  /* A LOSS is a game outcome, not a failure: "You lost 20.00 $" must not be
     titled "Error". Callers pass an optional explicit title. */
  const loss = (message, opts) =>
    showAppToast({ type: "loss", title: opts?.title || "Loss", message, duration: opts?.duration });

  const info = (message, opts) =>
    showAppToast({ type: "info", title: "Info", message, duration: opts?.duration });

  const warning = (message, opts) =>
    showAppToast({ type: "warning", title: "Warning", message, duration: opts?.duration });

  const loading = (message) => toast.loading(message, { duration: Infinity });

  const dismiss = (toastId) => toast.dismiss(toastId);

  return (
    <ToastContext.Provider value={{ success, error, loss, info, warning, loading, dismiss }}>
      <Toaster
        position="top-right"
        gutter={10}
        containerStyle={{
          top: 72,
          right: 12,
          left: 12, // helps mobile so it doesn't overflow
        }}
      />
      {children}
    </ToastContext.Provider>
  );
};