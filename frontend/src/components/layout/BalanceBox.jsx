import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { dashboardAPI } from "../../services/api";
import CurrencyIcon from "../common/CurrencyIcon";
import { IconCaretDown, IconCaretRight, IconWallet } from "../common/Icons";
import styles from "./balanceBox.module.css";

/* ============================================================================
 * Navbar balance box
 *
 *   ┌──────────────────────────────┬─────────┐
 *   │   100.00  (●$)  [⌄]          │   [▣]   │
 *   └──────────────────────────────┴─────────┘
 *     amount side (#102230)          wallet (#2874E1) -> /dashboard
 *
 * One flat box (no border, no shadow, slightly rounded) split in two unequal
 * parts. The amount side opens a small panel with TODAY's profit + wagered
 * amount and the 3 latest bets (GET /api/dashboard/today, fetched every time
 * it opens and again whenever the balance moves while it is open).
 * ==========================================================================*/

const fmtAmount = (n) =>
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "+2.50" / "−2.00" / "0.00" and the matching colour class */
function signed(n) {
  const v = Number(n ?? 0);
  const rounded = Math.round(v * 100) / 100;
  if (rounded > 0) return { text: `+${fmtAmount(rounded)}`, tone: "pos" };
  if (rounded < 0) return { text: `\u2212${fmtAmount(Math.abs(rounded))}`, tone: "neg" };
  return { text: fmtAmount(0), tone: "zero" };
}

/** The player's local midnight — "today" follows their timezone, not the server's */
export function localMidnightIso(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** rounds.created_at is UTC "YYYY-MM-DD HH:MM:SS" without a zone — read it as UTC */
export function parseServerTime(s) {
  if (!s) return NaN;
  const str = String(s).trim().replace(" ", "T");
  return Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(str) ? str : `${str}Z`);
}

export function timeAgo(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Amount({ value, className = "", tone }) {
  return (
    <span className={`${styles.amountRow} ${tone ? styles[tone] : ""} ${className}`}>
      <span className={styles.amountText}>{value}</span>
      <CurrencyIcon className={styles.amountCoin} />
    </span>
  );
}

export default function BalanceBox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "idle", data: null, error: null });

  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const requestRef = useRef(0);
  const balance = Number(user?.balance ?? 0);
  const lastBalanceRef = useRef(balance);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    setState((s) => ({ status: s.data ? "refreshing" : "loading", data: s.data, error: null }));
    try {
      const res = await dashboardAPI.getToday({ since: localMidnightIso() });
      if (id !== requestRef.current) return; // a newer request owns the panel
      const data = res?.data?.data;
      if (!data) throw new Error("Empty response");
      setState({ status: "ready", data, error: null });
    } catch (e) {
      if (id !== requestRef.current) return;
      setState((s) => ({
        status: "error",
        data: s.data,
        error: e?.response?.data?.message || "Couldn't load today's stats.",
      }));
    }
  }, []);

  // fresh numbers every time the panel opens
  useEffect(() => {
    if (!open) return;
    lastBalanceRef.current = balance;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load]);

  // while open, a moving balance means a bet just settled — refresh (debounced)
  useEffect(() => {
    if (!open || lastBalanceRef.current === balance) return undefined;
    lastBalanceRef.current = balance;
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [open, balance, load]);

  // close on outside press, on Escape (focus back to the toggle) …
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // … and on navigation
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const goDashboard = () => {
    setOpen(false);
    navigate("/dashboard");
  };

  const { status, data, error } = state;
  const loading = !data && (status === "loading" || status === "idle");
  const profit = signed(data?.profit);
  const recent = Array.isArray(data?.recent) ? data.recent.slice(0, 3) : [];
  const betsToday = Number(data?.bets ?? 0);
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.box}>
        <button
          ref={toggleRef}
          type="button"
          className={`${styles.balanceBtn} ${open ? styles.balanceBtnOpen : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`Balance ${fmtAmount(balance)}. Show today's activity`}
          data-testid="balance-toggle"
        >
          <span className={styles.balanceAmount}>{fmtAmount(balance)}</span>
          <CurrencyIcon className={styles.balanceCoin} />
          <span className={styles.caretBtn} aria-hidden="true">
            <IconCaretDown className={styles.caret} />
          </span>
        </button>

        <button
          type="button"
          className={styles.walletBtn}
          onClick={goDashboard}
          aria-label="Wallet — open your dashboard"
          title="Dashboard"
          data-testid="balance-wallet"
        >
          <IconWallet className={styles.walletIcon} />
        </button>
      </div>

      {open && (
        <div id={panelId} className={styles.panel} role="dialog" aria-label="Today's activity" data-testid="balance-panel">
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Today</span>
            <span className={styles.panelDate}>{todayLabel}</span>
          </div>

          {error && !data ? (
            <div className={styles.errorBox} role="alert">
              <span>{error}</span>
              <button type="button" className={styles.retryBtn} onClick={load}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className={styles.stats}>
                <div className={styles.stat} data-testid="balance-profit">
                  <span className={styles.statLabel}>Profit</span>
                  {loading ? (
                    <span className={styles.skeleton} style={{ width: "72%" }} />
                  ) : (
                    <Amount value={profit.text} tone={profit.tone} className={styles.statValue} />
                  )}
                  {!loading && <span className={styles.statSub}>Payout {fmtAmount(data?.payout)}</span>}
                </div>
                <div className={styles.stat} data-testid="balance-wagered">
                  <span className={styles.statLabel}>Wagered</span>
                  {loading ? (
                    <span className={styles.skeleton} style={{ width: "64%" }} />
                  ) : (
                    <Amount value={fmtAmount(data?.wagered)} className={styles.statValue} />
                  )}
                  {!loading && (
                    <span className={styles.statSub}>
                      {betsToday === 1 ? "1 bet" : `${betsToday.toLocaleString("en-US")} bets`}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.sectionHead}>Recent bets</div>
              {loading ? (
                <ul className={styles.recent} aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className={styles.bet}>
                      <span className={styles.skeleton} style={{ width: "46%" }} />
                      <span className={styles.skeleton} style={{ width: "24%" }} />
                    </li>
                  ))}
                </ul>
              ) : recent.length === 0 ? (
                <div className={styles.empty}>
                  <span>No bets yet — your latest 3 will show up here.</span>
                  <button
                    type="button"
                    className={styles.emptyBtn}
                    onClick={() => {
                      setOpen(false);
                      navigate("/games");
                    }}
                  >
                    Browse games
                  </button>
                </div>
              ) : (
                <ul className={styles.recent} data-testid="balance-recent">
                  {recent.map((r) => {
                    const p = signed(r.profit ?? Number(r.payout_amount) - Number(r.bet_amount));
                    const mult = r.multiplier == null ? null : Number(r.multiplier);
                    return (
                      <li key={r.id ?? r.round_uuid} className={styles.bet}>
                        <div className={styles.betMain}>
                          <span className={styles.betGame}>{r.game_display_name || r.game_name || "Game"}</span>
                          <span className={styles.betMeta}>
                            {timeAgo(parseServerTime(r.created_at))}
                            <span className={styles.dot} aria-hidden="true">·</span>
                            Bet {fmtAmount(r.bet_amount)}
                          </span>
                        </div>
                        <div className={styles.betSide}>
                          <Amount value={p.text} tone={p.tone} className={styles.betProfit} />
                          <span className={styles.betMult}>{Number.isFinite(mult) ? `${mult.toFixed(2)}×` : "—"}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          <button type="button" className={styles.panelLink} onClick={goDashboard}>
            View all activity
            <IconCaretRight className={styles.panelLinkIcon} />
          </button>
        </div>
      )}
    </div>
  );
}
