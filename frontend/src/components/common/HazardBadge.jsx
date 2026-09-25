import { IconWarning } from "./Icons";

/* Small rounded hazard badge (dark grey tile, yellow triangle). Used on
   locked inputs / disabled-by-admin buttons. `corner` pins it centred on
   the host's top-right corner (the host must be position:relative). */
export default function HazardBadge({ corner = false, onClick, title = "Not allowed", className = "" }) {
  const handle = onClick
    ? (e) => {
        e.preventDefault(); /* never toggles a wrapping <label> / submits a form */
        e.stopPropagation();
        onClick(e);
      }
    : undefined;
  return (
    <span
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`ui-hazard ${onClick ? "ui-hazard-click" : ""} ${corner ? "ui-hazard-corner" : ""} ${className}`}
      onClick={handle}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") handle(e); } : undefined}
      title={title}
      aria-label={title}
    >
      <IconWarning />
    </span>
  );
}
