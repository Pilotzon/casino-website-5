/* ============================================================================
 * The site's currency mark: a solid green (#25E801) disc with the "$" CUT OUT
 * of it — the symbol is a hole, so whatever sits behind the icon (input,
 * panel, popup …) shows through it.
 *
 * Use it everywhere an amount carries the currency mark, instead of a "$"
 * character. It is 1em square by default (follows the surrounding font size);
 * pass `size` (px number or CSS length) or size it from CSS
 * (`.parent .currency-icon { width; height }`). The colour comes from the
 * `--color-currency` token in global.css (`.currency-icon path { fill }`).
 *
 * Geometry (24×24): a r=12 disc minus a "$" built from a 2.5-unit stroked S
 * with short top/bottom bars — tuned to stay legible down to 12px.
 * ==========================================================================*/

export const CURRENCY_ICON_PATH =
  "M24 12C24 18.63 18.63 24 12 24C5.37 24 0 18.63 0 12C0 5.37 5.37 0 12 0C18.63 0 24 5.37 24 12Z" +
  "M14.23 8.97L16.67 8.42Q16.03 5.55 13.25 5.05L13.25 3.25L10.75 3.25L10.75 5.04Q7.45 5.54 7.45 8.93" +
  "Q7.45 12.47 11.78 13.09Q14.25 13.63 14.25 14.96Q14.25 16.55 12 16.55Q10.04 16.55 9.73 14.95" +
  "L7.27 15.43Q7.86 18.45 10.75 18.95L10.75 20.75L13.25 20.75L13.25 18.97Q16.75 18.47 16.75 14.96" +
  "Q16.75 11.59 12.26 10.64Q12.22 10.63 12.17 10.62Q9.95 10.31 9.95 8.93Q9.95 7.45 12 7.45" +
  "Q13.89 7.45 14.23 8.97Z";

export const CURRENCY_COLOR = "#25E801";

export default function CurrencyIcon({ size, className, style, title, ...rest }) {
  const sized = size != null ? { width: size, height: size } : null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className ? `currency-icon ${className}` : "currency-icon"}
      style={sized || style ? { ...sized, ...style } : undefined}
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      data-icon="CurrencyIcon"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {/* evenodd: the "$" contour is a hole in the disc, not paint on top */}
      <path fill={CURRENCY_COLOR} fillRule="evenodd" d={CURRENCY_ICON_PATH} />
    </svg>
  );
}
