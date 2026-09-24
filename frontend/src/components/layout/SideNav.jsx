import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/api";
import styles from "./sidenav.module.css";

/* Inline stroke icons (currentColor) — one per nav section */
const Icons = {
  games: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="7" width="19" height="11" rx="4" />
      <path d="M7 10.5v4M5 12.5h4" />
      <circle cx="16" cy="11.2" r="0.6" fill="currentColor" />
      <circle cx="18.4" cy="13.8" r="0.6" fill="currentColor" />
    </svg>
  ),

  bets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8.5L12 5l8 3.5v7L12 19l-8-3.5z" />
      <path d="M4 8.5l8 3.5 8-3.5M12 12v7" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z" />
      <path d="M9 12.2l2.1 2.1L15.4 10" />
    </svg>
  ),
};

const NAV_LINKS = [
  { key: "games", path: "/games", label: "Games", icon: Icons.games },
  { key: "custom_bets", path: "/custom-bets", label: "Custom Bets", icon: Icons.bets },
  { key: "dashboard", path: "/dashboard", label: "Dashboard", icon: Icons.dashboard },
];

/* Temporary shared icon for the per-game links (proper art comes later) */
const GameIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="9" cy="15" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="15" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
  </svg>
);

const GAME_LINKS = [
  "flip", "dice", "limbo", "plinko", "crash", "mines", "roulette",
  "blackjack", "keno", "tower", "russian_roulette", "wheel", "snakes", "rps",
].map((name) => ({
  path: `/games/${name}`,
  label: name === "rps" ? "Rock-Paper-Scissors" : name === "russian_roulette" ? "Russian Roulette" : name.charAt(0).toUpperCase() + name.slice(1),
  icon: GameIcon,
}));

function SideNav({ collapsed, onToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canBypassDisabled = user?.role === "owner" || Boolean(user?.can_bypass_disabled);
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const pageLinks = useMemo(
    () => (isAdmin ? [...NAV_LINKS, { key: "admin", path: "/admin", label: "Admin", icon: Icons.admin }] : NAV_LINKS),
    [isAdmin]
  );

  const [pages, setPages] = useState(null);
  const [games, setGames] = useState(null);

  // disabled games are hidden from the rail entirely (confidentiality);
  // owners / bypass users still see them
  useEffect(() => {
    let mounted = true;
    api
      .get("/games")
      .then((res) => {
        if (mounted) setGames(res.data?.data ?? []);
      })
      .catch(() => {
        if (mounted) setGames(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const gameLinks = useMemo(() => {
    return GAME_LINKS;
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .get("/pages")
      .then((res) => {
        if (mounted) setPages(res.data?.data ?? []);
      })
      .catch(() => {
        if (mounted) setPages(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const pageMap = useMemo(() => {
    const map = new Map();
    (pages ?? []).forEach((p) => map.set(p.page_key, p));
    return map;
  }, [pages]);

  const isActivePath = (path) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const isPageEnabled = (key) => {
    const p = pageMap.get(key);
    if (!p) return true;
    if (p.is_enabled) return true;
    return canBypassDisabled;
  };

  const go = (path, allowed) => {
    if (!allowed) return;
    if (location.pathname !== path) navigate(path);
  };

  return (
    <aside
      className={`${styles.sideNav} ${collapsed ? styles.collapsed : ""}`}
      aria-label="Site navigation"
    >
      <button
        type="button"
        className={styles.hamburgerBtn}
        onClick={onToggle}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        </svg>
      </button>

      <div className={styles.scroller}>
      <nav className={styles.links}>
        <div className={styles.sectionLabel}>Pages</div>
        {pageLinks.map((link) => {
          const allowed = isPageEnabled(link.key);
          const active = isActivePath(link.path);
          return (
            <button
              key={link.path}
              type="button"
              className={`${styles.link} ${active ? styles.linkActive : ""} ${allowed ? "" : styles.linkDisabled}`}
              onClick={() => go(link.path, allowed)}
              disabled={!allowed}
              title={collapsed ? link.label : undefined}
            >
              <span className={styles.linkIcon}>{link.icon}</span>
              <span className={styles.linkLabel}>{link.label}</span>
            </button>
          );
        })}

        <div className={styles.divider} />
        <div className={styles.sectionLabel}>Games</div>
        {gameLinks.map((link) => {
          const active = isActivePath(link.path);
          return (
            <button
              key={link.path}
              type="button"
              className={`${styles.link} ${active ? styles.linkActive : ""}`}
              onClick={() => go(link.path, true)}
              title={collapsed ? link.label : undefined}
            >
              <span className={styles.linkIcon}>{link.icon}</span>
              <span className={styles.linkLabel}>{link.label}</span>
            </button>
          );
        })}
      </nav>
      </div>
    </aside>
  );
}

export default SideNav;
