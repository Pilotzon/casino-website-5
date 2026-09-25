import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useStayMounted from "./useStayMounted";
import { IconX } from "./Icons";

/**
 * THE modal. Every dialog on the site (login / register, fairness, the
 * in-game info sheets) renders through this so they all share one anatomy:
 *
 *   [icon] Title ............................................ [X]
 *   description (bluish, regular) — or `options` (Manual/Auto-style
 *   selector) — or, for forms, inputs + labels
 *   children
 *   centered, bold, bluish bottom text (footer)
 *
 * Desktop: centred card with a drop shadow. Mobile: bottom sheet that
 * slides up, rounded corners on top only, drag handle, and the page
 * behind zooms out a little + darkens. Open AND close are animated;
 * clicking anywhere outside the card (or Escape) closes it.
 */
let openCount = 0;

function Modal({
  isOpen,
  onClose,
  title,
  icon,
  description,
  options, // optional: an already-rendered option selector under the title
  footer,
  children,
  size = "sm", // sm | md | lg
  className = "",
  bodyClassName = "",
}) {
  const [mounted, closing] = useStayMounted(isOpen, 220);
  const cardRef = useRef(null);
  const drag = useRef({ active: false, startY: 0, dy: 0 });

  // --- bottom-sheet drag handle (mobile): pull down to dismiss ---
  const onHandleDown = (e) => {
    drag.current = { active: true, startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const card = cardRef.current;
    if (card) card.style.transition = "none";
  };
  const onHandleMove = (e) => {
    if (!drag.current.active) return;
    const dy = Math.max(0, e.clientY - drag.current.startY);
    drag.current.dy = dy;
    const card = cardRef.current;
    if (card) card.style.transform = `translateY(${dy}px)`;
  };
  const onHandleUp = () => {
    if (!drag.current.active) return;
    const { dy } = drag.current;
    drag.current.active = false;
    const card = cardRef.current;
    if (!card) return;
    const threshold = Math.min(120, card.offsetHeight * 0.3);
    if (dy > threshold) {
      // let the exit animation take over from the current position
      card.style.transition = "";
      onClose?.();
    } else {
      card.style.transition = "transform 200ms cubic-bezier(0.22, 0.9, 0.3, 1)";
      card.style.transform = "";
    }
  };

  // lock page scroll + flag the body (drives the mobile background zoom)
  useEffect(() => {
    if (!isOpen) return undefined;
    openCount += 1;
    const zoom = document.querySelector(".ui-zoom-target");
    if (zoom) {
      // zoom around the part of the page currently on screen
      const rect = zoom.getBoundingClientRect();
      const originY = Math.max(0, -rect.top + window.innerHeight / 2);
      zoom.style.setProperty("--ui-zoom-origin-y", `${originY}px`);
    }
    document.body.classList.add("ui-modal-open");
    // iOS-proof scroll lock: freeze the body at the current scroll offset
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    if (openCount === 1) {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
    }
    return () => {
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) {
        document.body.classList.remove("ui-modal-open");
        document.body.style.overflow = prev.overflow;
        document.body.style.position = prev.position;
        document.body.style.top = prev.top;
        document.body.style.width = prev.width;
        window.scrollTo(0, scrollY);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  const sizeClass = size === "lg" ? "ui-modal-card-lg" : size === "md" ? "ui-modal-card-md" : "";

  return createPortal(
    <div
      className={`ui-modal-overlay ${closing ? "ui-modal-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      onPointerDown={(e) => {
        // anywhere besides the card closes the modal
        if (cardRef.current && !cardRef.current.contains(e.target)) onClose?.();
      }}
      onTouchMove={(e) => {
        // nothing behind the sheet may scroll; the body itself is scrollable
        if (!e.target.closest?.(".ui-modal-body")) e.preventDefault();
      }}
    >
      <div ref={cardRef} className={`ui-modal-card ${sizeClass} ${className}`}>
        <div
          className="ui-modal-handle"
          role="button"
          aria-label="Drag down to close"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        />
        <div className="ui-modal-topbar">
          <div className="ui-modal-head">
            {icon && <span className="ui-modal-head-icon">{icon}</span>}
            <h2 className="ui-modal-heading">{title}</h2>
          </div>
          <button type="button" className="ui-modal-close" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        {description && <p className="ui-modal-desc">{description}</p>}
        {options && <div className="ui-modal-options">{options}</div>}

        <div className={`ui-modal-body ${bodyClassName}`}>{children}</div>

        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
