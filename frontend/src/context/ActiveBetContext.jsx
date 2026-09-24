import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Tracks whether ANY game currently has a bet that would be lost by leaving
 * the page. Games report themselves with `useActiveBetFlag(key, active)`
 * (see hooks/useActiveBetFlag.js) and the RefreshGuard reads this context to
 * warn before a refresh.
 */
const ActiveBetContext = createContext(null);

export const useActiveBets = () => {
  const ctx = useContext(ActiveBetContext);
  if (!ctx) throw new Error("useActiveBets must be used within ActiveBetProvider");
  return ctx;
};

export const ActiveBetProvider = ({ children }) => {
  const [keys, setKeys] = useState(() => []);

  const setActiveBet = useCallback((key, active) => {
    setKeys((prev) => {
      const has = prev.includes(key);
      if (active && !has) return [...prev, key];
      if (!active && has) return prev.filter((k) => k !== key);
      return prev;
    });
  }, []);

  const value = useMemo(
    () => ({ activeKeys: keys, hasActiveBet: keys.length > 0, setActiveBet }),
    [keys, setActiveBet]
  );

  return <ActiveBetContext.Provider value={value}>{children}</ActiveBetContext.Provider>;
};
