import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./AnimatedDepositToast.module.css";

export default function AnimatedDepositToast({
  open,
  toastKey,
  text = "Learn more",
  durationMs = 2200,
  onClose,
  inline = false,
}) {
  const outerRef = useRef(null);
  const measureRef = useRef(null);
  const [visible, setVisible] = useState(false);

  // ✅ Track if animation has completed for this key
  const animationStateRef = useRef({ key: null, completed: false });

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const ids = useMemo(() => {
    const sanitized = String(toastKey ?? "nokey").replace(/[^a-zA-Z0-9_-]/g, "_");
    const r = `${sanitized}-${Math.random().toString(16).slice(2)}`;
    return {
      bgWrap: `adt-bg-wrap-${r}`,
      bgInner: `adt-bg-inner-${r}`,
      btn: `adt-btn-${r}`,
      txt: `adt-txt-${r}`,
      plus: `adt-plus-${r}`,
    };
  }, [toastKey]);

  const DURATION = 300;
  const EASING = "cubic-bezier(0.42, 0, 0.58, 1)";

  function animateProp(el, prop, from, to, duration = DURATION, easing = EASING) {
    return new Promise((resolve) => {
      if (!el) return resolve();
      const kf = [{ [prop]: from }, { [prop]: to }];
      const a = el.animate(kf, { duration, easing, fill: "forwards" });
      a.onfinish = () => resolve();
    });
  }

  function getMeasureWidth() {
    const el = measureRef.current;
    if (!el) return 0;
    return el.getBoundingClientRect().width;
  }

  function makeBgWrap() {
    const wrap = document.createElement("div");
    wrap.className = styles.bgWrap;
    wrap.id = ids.bgWrap;

    const inner = document.createElement("div");
    inner.className = styles.bgInner;
    inner.id = ids.bgInner;
    inner.style.transform = "scale(0)";

    wrap.appendChild(inner);
    return wrap;
  }

  function makeBtn() {
    const btn = document.createElement("div");
    btn.className = styles.btnContainer;
    btn.id = ids.btn;
    btn.style.width = "56px";
    btn.style.transform = "scale(0)";
    return btn;
  }

  function makeBtnText() {
    const t = document.createElement("span");
    t.className = styles.btnText;
    t.textContent = text;
    t.style.opacity = "0";
    t.id = ids.txt;
    return t;
  }

  function makePlusIcon() {
    const p = document.createElement("div");
    p.className = styles.plusIcon;
    p.id = ids.plus;
    p.style.transform = "scale(0)";
    const s = document.createElement("span");
    s.textContent = "+";
    p.appendChild(s);
    return p;
  }

  async function forward() {
    const outer = outerRef.current;
    if (!outer) return;

    outer.innerHTML = "";

    const bgWrap = makeBgWrap();
    const bgInner = bgWrap.firstChild;
    outer.prepend(bgWrap);

    const btn = makeBtn();
    outer.appendChild(btn);

    outer.style.transform = "translateY(-6px)";
    await animateProp(outer, "transform", "translateY(-6px)", "translateY(0px)", 220, "cubic-bezier(0.2,0,0,1)");

    await animateProp(bgInner, "transform", "scale(0)", "scale(1.5)");

    const pBtnIn = animateProp(btn, "transform", "scale(0)", "scale(1)");
    await animateProp(bgInner, "transform", "scale(1.5)", "scale(0)");
    bgWrap.remove();
    await pBtnIn;

    const plus = makePlusIcon();
    btn.appendChild(plus);
    await animateProp(plus, "transform", "scale(0)", "scale(1)");

    const textWidth = getMeasureWidth();
    const w1 = Math.max(56, Math.ceil(textWidth + 10));
    const w2 = Math.max(56, Math.ceil(textWidth));

    await animateProp(btn, "width", "56px", `${w1}px`);
    const txt = makeBtnText();
    btn.prepend(txt);

    const pFade = animateProp(txt, "opacity", "0", "1");
    const pShrink = animateProp(btn, "width", `${w1}px`, `${w2}px`);
    await Promise.all([pFade, pShrink]);
  }

  async function reverse() {
    const outer = outerRef.current;
    const btn = document.getElementById(ids.btn);
    const txt = document.getElementById(ids.txt);
    const plus = document.getElementById(ids.plus);

    if (txt) {
      await animateProp(txt, "opacity", "1", "0", 200, "cubic-bezier(0.2,0,0,1)");
      txt.remove();
    }

    if (plus) {
      await animateProp(plus, "transform", "scale(1)", "scale(0)", 220, "cubic-bezier(0.2,0,0,1)");
      plus.remove();
    }

    if (btn) {
      const curW = btn.getBoundingClientRect().width;
      await animateProp(btn, "width", `${curW}px`, "56px", 220);
      await animateProp(btn, "transform", "scale(1)", "scale(0)", 220, "cubic-bezier(0.2,0,0,1)");
      btn.remove();
    }

    if (outer) {
      await animateProp(outer, "transform", "translateY(0px)", "translateY(-6px)", 180, "cubic-bezier(0.2,0,0,1)");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!open) return;
      if (toastKey == null) return;

      // ✅ Check if we've already completed animation for this exact key
      if (animationStateRef.current.key === toastKey && animationStateRef.current.completed) {
        console.log('⏸️ Animation already completed for key:', toastKey);
        return;
      }

      // ✅ Mark this key as being processed
      animationStateRef.current = { key: toastKey, completed: false };

      console.log('▶️ Starting animation for:', toastKey);

      setVisible(true);

      await new Promise((resolve) => {
        const check = () => {
          if (outerRef.current) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });

      if (cancelled) return;

      try {
        await forward();
        if (cancelled) return;

        await new Promise((r) => setTimeout(r, durationMs));
        if (cancelled) return;

        await reverse();
      } finally {
        if (cancelled) return;

        // ✅ Mark animation as completed
        animationStateRef.current.completed = true;

        setVisible(false);
        onCloseRef.current?.();
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [open, toastKey, durationMs]);

  if (!visible) return null;

  const inner = (
    <div className={inline ? styles.inlineHost : styles.host} role="status" aria-live="polite">
      <div className={styles.toastCard}>
        <div className={styles.outerWrapper} ref={outerRef} />
        <span className={styles.measureText} ref={measureRef}>
          {text}
        </span>
      </div>
    </div>
  );

  if (inline) return inner;

  return createPortal(inner, document.body);
}