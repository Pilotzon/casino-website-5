import { useMemo, useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(max-width: 600px)").matches || window.innerWidth <= 768;
  } catch {
    return false;
  }
}

export default function useGameDisabled(gameRow) {
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(isMobileViewport());

  useEffect(() => {
    const onResize = () => setIsMobile(isMobileViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const canBypass = user?.role === "owner" || Boolean(user?.can_bypass_disabled);

  const isDisabled = useMemo(() => {
    if (!gameRow) return false;
    if (canBypass) return false;
    return !Boolean(gameRow.is_enabled);
  }, [gameRow, canBypass]);

  const isMobileDisabled = useMemo(() => {
    if (!gameRow) return false;
    if (canBypass) return false;
    if (!isMobile) return false;
    // is_mobile_enabled defaults to 1; treat undefined as enabled
    if (gameRow.is_mobile_enabled === undefined || gameRow.is_mobile_enabled === null) return false;
    return Number(gameRow.is_mobile_enabled) === 0;
  }, [gameRow, canBypass, isMobile]);

  const disabledTitle = useMemo(() => {
    const name = gameRow?.display_name || gameRow?.name || "This game";
    if (isMobileDisabled) return `${name} is not available on mobile`;
    if (isDisabled) return `${name} is temporarily disabled`;
    return "";
  }, [isDisabled, isMobileDisabled, gameRow]);

  const disabledDesc = useMemo(() => {
    if (isMobileDisabled) return "This game is disabled on mobile devices. Please try on desktop or choose another game.";
    if (isDisabled) return "The game stage is hidden while we upgrade the experience. Betting is disabled for now.";
    return "";
  }, [isDisabled, isMobileDisabled]);

  const betErrorMessage = useMemo(() => {
    if (isMobileDisabled) return "Betting is disabled on mobile for this game.";
    if (isDisabled) return "Betting is disabled for unavailable games.";
    return "";
  }, [isDisabled, isMobileDisabled]);

  return { isDisabled, isMobileDisabled, isLocked: isDisabled || isMobileDisabled, canBypass, isMobile, disabledTitle, disabledDesc, betErrorMessage };
}
