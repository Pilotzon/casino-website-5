import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/api";
import styles from './footer.module.css';

const PAGES = [
  { key: "home", path: "/", label: "Home" },
  { key: "games", path: "/games", label: "Games" },
  { key: "custom_bets", path: "/custom-bets", label: "Custom Bets" },
  { key: "dashboard", path: "/dashboard", label: "Dashboard" },
];

function Footer() {
  const { user } = useAuth();
  const canBypassDisabled = user?.role === "owner" || Boolean(user?.can_bypass_disabled);
  const [pages, setPages] = useState(null);

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

  // available pages only (never the admin panel)
  const links = useMemo(() => {
    const map = new Map((pages ?? []).map((p) => [p.page_key, p]));
    return PAGES.filter((p) => {
      const row = map.get(p.key);
      return !row || row.is_enabled || canBypassDisabled;
    });
  }, [pages, canBypassDisabled]);

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <nav className={styles.pages} aria-label="Footer pages">
          {links.map((p) => (
            <Link key={p.key} to={p.path} className={styles.pageLink}>
              {p.label}
            </Link>
          ))}
        </nav>

        <div className={styles.section}>
          <p className={styles.warning}>
            Virtual Credits Only - No Real Money
          </p>
          <p className={styles.disclaimer}>
            This platform is for entertainment purposes only. All credits are virtual and have no real-world value.
          </p>
        </div>

        <div className={styles.info}>
          <p>Casino Platform &copy; {new Date().getFullYear()}</p>
          <p className={styles.version}>v1.5.2</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;