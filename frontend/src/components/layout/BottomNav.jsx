import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/api";
import { IconHome, IconGamepad, IconDashboard, IconCube, IconShieldCheck } from "../common/Icons";
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
        icon: <IconHome />,
      },
      {
        key: "casino",
        label: "Casino",
        path: "/games",
        show: true,
        icon: <IconGamepad />,
      },
      {
        key: "dashboard",
        label: "Dashboard",
        path: "/dashboard",
        show: true,
        icon: <IconDashboard />,
      },
      {
        key: "custom_bets",
        label: "Custom Bets",
        path: "/custom-bets",
        show: isPageEnabled("custom_bets"),
        icon: <IconCube />,
      },
      {
        key: "admin",
        label: "Admin",
        path: "/admin",
        show: isAdmin,
        icon: <IconShieldCheck />,
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
