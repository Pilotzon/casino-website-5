import { createContext, useContext, useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import "./toast.css";

const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
};

const DEFAULT_DURATION = 3000;
const LEAVE_MS = 220;

/* ===== SVG ICONS ===== */
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
    <path
      d="M20 6L9 17l-5-5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconCross = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
    <path
      d="M6 6l12 12M18 6L6 18"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

const IconInfo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
    <path
      d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"
      stroke="currentColor"
      strokeWidth="2.2"
    />
    <path d="M12 10.5v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M12 7.4h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

const IconWarning = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
    <path
      d="M12 3.2l9.2 16a2 2 0 0 1-1.74 3H4.54a2 2 0 0 1-1.74-3l9.2-16a2 2 0 0 1 3.48 0Z"
      fill="currentColor"
      opacity="0.95"
    />
    <path d="M12 8v6" stroke="#0b1820" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M12 17.6h.01" stroke="#0b1820" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path
      d="M6 6l12 12M18 6L6 18"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
    />
  </svg>
);

const iconByType = {
  success: <IconCheck />,
  error: <IconCross />,
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

  const info = (message, opts) =>
    showAppToast({ type: "info", title: "Info", message, duration: opts?.duration });

  const warning = (message, opts) =>
    showAppToast({ type: "warning", title: "Warning", message, duration: opts?.duration });

  const loading = (message) => toast.loading(message, { duration: Infinity });

  const dismiss = (toastId) => toast.dismiss(toastId);

  return (
    <ToastContext.Provider value={{ success, error, info, warning, loading, dismiss }}>
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