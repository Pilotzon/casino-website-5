import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import styles from "./CustomBetsTopBar.module.css";

export default function CustomBetsTopBar() {
  const nav = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();

  const canCreate = Boolean(isAuthenticated);

  const openCreate = () => nav(`/custom-bets?create=1`);

  const handleLogin = () => {
    // Go to main casino home and open login modal using query param.
    window.location.href = "/?login=1";
  };

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <Link className={styles.backBtn} to="/">
            Go Back
          </Link>

          <Link to="/custom-bets" className={styles.logo}>
            <div className={styles.mark} />
            <div className={styles.logoText}>Casino Markets</div>
          </Link>
        </div>

        <div className={styles.searchWrap}>
          <input
            className={styles.search}
            placeholder="Search markets..."
            onKeyDown={(e) => {
              if (e.key === "Enter") nav("/custom-bets/markets");
            }}
          />
        </div>

        <div className={styles.right}>
          <button
            className={styles.topLink}
            onClick={() => {
              window.location.href = "/custom-bets#1";
            }}
            type="button"
          >
            Markets
          </button>

          <button
            className={styles.createBtn}
            type="button"
            disabled={!canCreate}
            onClick={openCreate}
            title={!canCreate ? "Login required" : "Create bet"}
          >
            Create
          </button>

          <div className={styles.bal}>
            <div className={styles.balLabel}>Cash</div>
            <div className={styles.balValue}>${Number(user?.balance ?? 0).toFixed(2)}</div>
          </div>

          {!isAuthenticated ? (
            <button className={styles.authBtn} type="button" onClick={handleLogin}>
              Login
            </button>
          ) : (
            <button className={styles.authBtn} type="button" onClick={handleLogout}>
              Logout
            </button>
          )}

          <div className={styles.avatar} title={isAuthenticated ? user?.username : "Guest"} />
        </div>
      </div>
    </div>
  );
}