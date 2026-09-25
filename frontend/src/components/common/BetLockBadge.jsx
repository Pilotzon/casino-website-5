import { useState } from "react";
import HazardBadge from "./HazardBadge";
import Modal from "./Modal";
import { IconWarning } from "./Icons";
import useSiteStatus from "../../hooks/useSiteStatus";

/**
 * Red hazard badge pinned on the top-right corner of a game's action button
 * while betting is impossible — the game was disabled by an administrator
 * (globally or for mobile), or the whole site is in maintenance mode.
 *
 * Clicking it opens a dialog with the same anatomy as the "Sign-up Disabled"
 * modal (icon + title + description through the shared <Modal>), so a player
 * always learns WHY the button does nothing instead of being left with a dead
 * button and a tooltip.
 *
 * The badge must be a SIBLING of the button: a disabled <button> swallows every
 * mouse event, so a badge rendered inside it could never be clicked. Render it
 * next to the button inside a `ui-bet-wrap` element (position: relative).
 */
const HAZARD_ICON = <IconWarning />;

const MAINTENANCE_TITLE = "Maintenance";
const MAINTENANCE_DESC =
  "Betting is paused while the site is under maintenance. Everything stays as it is — please try again in a moment.";

export default function BetLockBadge({ locked = false, title, description }) {
  const { maintenance_mode: maintenance } = useSiteStatus();
  const [open, setOpen] = useState(false);

  const isMaintenance = maintenance && !locked;
  const active = locked || maintenance;
  if (!active) return null;

  const heading = isMaintenance ? MAINTENANCE_TITLE : (title || "Betting Disabled");
  const body = isMaintenance
    ? MAINTENANCE_DESC
    : (description || "Betting for this game is turned off right now.");

  return (
    <>
      <HazardBadge corner title={heading} onClick={() => setOpen(true)} />
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={heading}
        icon={HAZARD_ICON}
        description={body}
      />
    </>
  );
}
