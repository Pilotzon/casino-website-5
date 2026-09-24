import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/api";
import styles from "./BottomNav.module.css";

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pages, setPages] = useState(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await api.get("/pages");
        if (!mounted) return;
        setPages(res.data?.data ?? []);
      } catch {
        if (!mounted) return;
        setPages([]);
      }
    };
    run();
    return () => { mounted = false; };
  }, []);

  const pageMap = useMemo(() => {
    const m = new Map();
    (pages ?? []).forEach((p) => m.set(p.page_key, p));
    return m;
  }, [pages]);

  const canBypassDisabled = user?.role === "owner" || Boolean(user?.can_bypass_disabled);
  const isPageEnabled = (key) => {
    const p = pageMap.get(key);
    if (!p) return true;
    if (p.is_enabled) return true;
    return canBypassDisabled;
  };

  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  const navItems = useMemo(() => {
    const items = [
      {
        key: "home",
        label: "Home",
        path: "/",
        show: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10L12 3l9 7" />
            <path d="M5 9v11a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1V9" />
          </svg>
        ),
      },
      {
        key: "casino",
        label: "Casino",
        path: "/games",
        show: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="18" height="11" rx="2.5" />
            <path d="M7 10.5h2M8 9.5v2" />
            <circle cx="15.5" cy="11.2" r="1" fill="currentColor" stroke="none" />
            <circle cx="17.5" cy="13.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        key: "dashboard",
        label: "Dashboard",
        path: "/dashboard",
        show: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1.5" />
            <rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" />
            <rect x="3" y="16" width="7" height="5" rx="1.5" />
          </svg>
        ),
      },
      {
        key: "custom_bets",
        label: "Custom Bets",
        path: "/custom-bets",
        show: isPageEnabled("custom_bets"),
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8.5L12 5l8 3.5v7L12 19l-8-3.5z" />
            <path d="M4 8.5l8 3.5 8-3.5M12 12v7" />
          </svg>
        ),
      },
      {
        key: "admin",
        label: "Admin",
        path: "/admin",
        show: isAdmin,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 3v6c0 4.8-3.4 8.2-8 9-4.6-.8-8-4.2-8-9V6z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        ),
      },
    ];
    return items.filter((i) => i.show);
  }, [isAdmin, pageMap, canBypassDisabled]);

  return (
    <nav className={styles.bottomNav} aria-label="Primary mobile">
      <div className={styles.inner}>
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.key}
              type="button"
              className={`${styles.tab} ${active ? styles.tabActive : ""}`}
              onClick={() => navigate(item.path)}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.iconWrap}>
                <span className={styles.icon}>{item.icon}</span>
              </span>
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
