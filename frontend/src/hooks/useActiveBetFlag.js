import { useEffect } from "react";
import { useActiveBets } from "../context/ActiveBetContext";

/**
 * Tell the app that `key` (a game) currently holds a live bet, so refreshing
 * the page warns the player first. Safe to call with a changing `active`
 * value — the flag is added and removed automatically, and it is always
 * cleared when the component unmounts (e.g. navigating to another game).
 *
 *   useActiveBetFlag("crash", phase === "running");
 */
export default function useActiveBetFlag(key, active) {
  const { setActiveBet } = useActiveBets();

  useEffect(() => {
    setActiveBet(key, !!active);
    return () => setActiveBet(key, false);
  }, [key, active, setActiveBet]);
}
