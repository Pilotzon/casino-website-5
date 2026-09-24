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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.9L1.8 18.3A2 2 0 0 0 3.5 21.3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    </span>
  );
}
