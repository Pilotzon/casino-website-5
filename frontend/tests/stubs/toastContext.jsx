import { useMemo } from 'react';

/** Test double for `src/context/ToastContext.jsx`. */
export const __toasts = [];

export const useToast = () => useMemo(() => ({
  success: (m) => __toasts.push(['success', String(m)]),
  error: (m) => __toasts.push(['error', String(m)]),
  info: (m) => __toasts.push(['info', String(m)]),
  loading: (m) => __toasts.push(['loading', String(m)]),
  dismiss: () => {},
}), []);

export const ToastProvider = ({ children }) => children;
