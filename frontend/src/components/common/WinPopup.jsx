import CurrencyIcon from "./CurrencyIcon";

/* ============================================================================
 * The win popup every game shows over its board (dead-centre overlay):
 *
 *        ┌───────────────┐
 *        │     2.00×     │   ← multiplier (green)
 *        │  ───────────  │   ← #415B69 divider
 *        │   12.34 (●$)  │   ← amount won + the currency mark
 *        └───────────────┘
 *
 * tone: "win" (green border, default) · "push" (orange) · "lose" (red,
 * amount muted — Blackjack's result popup uses all three).
 * `className` is for a game's own placement tweaks only.
 * ==========================================================================*/
export function formatPopupMultiplier(m) {
  const n = Number(m);
  return `${Number.isFinite(n) && n > 0 ? n.toFixed(2) : "0.00"}×`;
}

export default function WinPopup({ multiplier, amount, tone = "win", amountPrefix = "", className = "", ...rest }) {
  const toneClass = tone === "win" ? "" : ` ui-win-popup--${tone}`;
  return (
    <div
      className={`ui-win-popup${toneClass}${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      data-win-popup={tone}
      {...rest}
    >
      <div className="ui-win-popup-multiplier">{formatPopupMultiplier(multiplier)}</div>
      <div className="ui-win-popup-divider" aria-hidden="true" />
      <div className="ui-win-popup-amount">
        <span>
          {amountPrefix}
          {Number(amount || 0).toFixed(2)}
        </span>
        <CurrencyIcon />
      </div>
    </div>
  );
}
