import { useState } from "react";
import { useAuth } from '../../context/AuthContext';
import Navigation from './Navigation';
import SideNav from './SideNav';
import BottomNav from './BottomNav';
import Footer from './Footer';
import styles from './Layout.module.css';
import GlobalBetSound from "../audio/GlobalBetSound";

const SIDENAV_COLLAPSED_KEY = "sidenav:collapsed";

function Layout({ children }) {
  const { loading } = useAuth();

  // PC side-rail collapse state (persisted)
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDENAV_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleNav = () => {
    setNavCollapsed((v) => {
      try {
        localStorage.setItem(SIDENAV_COLLAPSED_KEY, String(!v));
      } catch {
        // ignore
      }
      return !v;
    });
  };

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loader}>
          <div className={styles.loaderSpinner}></div>
          <p>Loading Casino Platform...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.layout} ${navCollapsed ? styles.navCollapsed : ""}`}>
      {/* .ui-zoom-target: everything behind a modal — on mobile it zooms
          out a little while a sheet is open (see global.css) */}
      <Navigation />
      <SideNav collapsed={navCollapsed} onToggle={toggleNav} />
      <BottomNav />
      <GlobalBetSound enabled={true} volume={0.8} />
      <div className={`${styles.page} ui-zoom-target`}>
        <main className={styles.main}>
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}

export default Layout;
