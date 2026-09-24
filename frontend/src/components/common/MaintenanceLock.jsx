import { useEffect } from "react";
import useSiteStatus from "../../hooks/useSiteStatus";

/* Flags <html data-maintenance="on"> while maintenance mode is enabled;
   global.css then disables every bet button and draws the hazard badge
   on its top-right corner (no per-game wiring needed). */
export default function MaintenanceLock() {
  const { maintenance_mode } = useSiteStatus();
  useEffect(() => {
    document.documentElement.dataset.maintenance = maintenance_mode ? "on" : "off";
  }, [maintenance_mode]);
  return null;
}
