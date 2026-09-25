import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { gamesAPI } from "../services/api";

/**
 * The player's latest rounds of one game, for the history pills above the
 * board (same shape as Crash's: { roundId, value, won, at }, newest first).
 *
 * Loads from the server when the game opens (so the pills survive a reload,
 * like Crash's) and `push(entry)` prepends a round the moment it resolves.
 * A slow initial load never wipes a round pushed in the meantime.
 */
export default function useGameHistory(gameName, { limit = 20 } = {}) {
  const { isAuthenticated, user } = useAuth();
  const userId = user?.id ?? null;
  const [history, setHistory] = useState([]);

  useEffect(() => {
    setHistory([]);
    if (!isAuthenticated || typeof gamesAPI.getGameHistory !== "function") return undefined;
    let alive = true;
    gamesAPI
      .getGameHistory(gameName, { limit })
      .then((res) => {
        if (!alive) return;
        const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
        setHistory((prev) => mergeNewestFirst(prev, rows, limit));
      })
      .catch(() => {
        /* pills are a nicety — the game works without them */
      });
    return () => {
      alive = false;
    };
  }, [gameName, isAuthenticated, userId, limit]);

  const push = useCallback(
    (entry) => setHistory((prev) => mergeNewestFirst([entry], prev, limit)),
    [limit]
  );

  return { history, push };
}

/** `newer` first, then the `older` rows not already listed; capped. */
function mergeNewestFirst(newer, older, limit) {
  const seen = new Set();
  const out = [];
  for (const row of [...newer, ...older]) {
    const key = row?.roundId;
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
