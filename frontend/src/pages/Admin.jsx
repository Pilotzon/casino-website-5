import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { adminAPI } from "../services/api";
import styles from "./admin.module.css";
import Modal from "../components/common/Modal";
import HazardBadge from "../components/common/HazardBadge";
import Stepper from "../components/common/Stepper";

function isFutureDate(value) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

/* Collapsible user sub-section — one open at a time (accordion) */
function Sub({ id, title, hint, openId, onToggle, children, danger }) {
  const open = openId === id;
  return (
    <div className={`${styles.sub} ${open ? styles.subOpen : ""} ${danger ? styles.dangerZone : ""}`}>
      <button type="button" className={styles.subHead} onClick={() => onToggle(id)} aria-expanded={open}>
        <span className={styles.subTitle}>{title}</span>
        <span className={styles.subHint}>{hint}</span>
        <svg className={styles.subChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {/* animated height: grid-template-rows 0fr -> 1fr */}
      <div className={styles.subCollapse} aria-hidden={!open}>
        <div className={styles.subCollapseInner}>
          <div className={styles.subBody}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/* Sub-sub-section (inside Access): a chevron on the LEFT, one open at a time */
function SubSub({ id, title, openId, onToggle, children }) {
  const open = openId === id;
  return (
    <div className={`${styles.subsub} ${open ? styles.subsubOpen : ""}`}>
      <button type="button" className={styles.subsubHead} onClick={() => onToggle(id)} aria-expanded={open}>
        <svg className={styles.subsubChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className={styles.subsubTitle}>{title}</span>
      </button>
      <div className={styles.subCollapse} aria-hidden={!open}>
        <div className={styles.subCollapseInner}>
          <div className={styles.subsubBody}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function Admin() {
  const { user, isAuthenticated, refreshUser } = useAuth();
  const toast = useToast();

  const role = user?.role;
  const isOwner = role === "owner";
  const isAdmin = role === "admin" || role === "owner";

  const adminCanManageGames = isOwner || Boolean(user?.can_manage_games);
  const adminCanManagePages = isOwner || Boolean(user?.can_manage_pages);

  const didLoadRef = useRef(false);
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState({
    signup_enabled: true,
    maintenance_mode: false,
    max_bet_amount: "1000",
    min_bet_amount: "0.00000001",
  });

  const [games, setGames] = useState([]);
  const [pages, setPages] = useState([]);

  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);

  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);

  const [statusLoading, setStatusLoading] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);

  const [timeoutHours, setTimeoutHours] = useState("");
  const [timeoutLoading, setTimeoutLoading] = useState(false);
  const [clearTimeoutLoading, setClearTimeoutLoading] = useState(false);

  const [banHours, setBanHours] = useState("");
  const [banLoading, setBanLoading] = useState(false);
  const [clearBanLoading, setClearBanLoading] = useState(false);

  const [bypassLoading, setBypassLoading] = useState(false);
  const [permsLoading, setPermsLoading] = useState(false);

  const [accessPermsLoading, setAccessPermsLoading] = useState(false);

  // ✅ NEW custom bets perms loading
  const [customBetsPermsLoading, setCustomBetsPermsLoading] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showNotAllowedModal, setShowNotAllowedModal] = useState(false);
  const [pendingRole, setPendingRole] = useState(null);
  // one collapsible user sub-section open at a time
  const [openSub, setOpenSub] = useState("account");
  const toggleSub = (id) => setOpenSub((cur) => (cur === id ? null : id));
  const [openSubSub, setOpenSubSub] = useState("custom_bets");
  const toggleSubSub = (id) => setOpenSubSub((cur) => (cur === id ? null : id));
  // user list filter / sort
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [userStateFilter, setUserStateFilter] = useState("all");
  const [userSort, setUserSort] = useState("username_asc");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const future = (d) => d && new Date(d).getTime() > Date.now();
    let list = users.filter((u) => {
      if (q && !(u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || String(u.id).includes(q))) return false;
      if (userRoleFilter !== "all" && u.role !== userRoleFilter) return false;
      switch (userStateFilter) {
        case "active": return Boolean(u.is_active) && !future(u.banned_until);
        case "inactive": return !u.is_active;
        case "banned": return future(u.banned_until);
        case "timed_out": return future(u.timed_out_until);
        case "controller": return u.role === "owner" || Boolean(u.can_bypass_disabled);
        default: return true;
      }
    });
    const cmp = {
      username_asc: (a, b) => String(a.username).localeCompare(String(b.username)),
      username_desc: (a, b) => String(b.username).localeCompare(String(a.username)),
      balance_desc: (a, b) => Number(b.balance) - Number(a.balance),
      balance_asc: (a, b) => Number(a.balance) - Number(b.balance),
      id_asc: (a, b) => a.id - b.id,
      id_desc: (a, b) => b.id - a.id,
      newest: (a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0),
      oldest: (a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0),
    }[userSort];
    if (cmp) list = [...list].sort(cmp);
    return list;
  }, [users, userSearch, userRoleFilter, userStateFilter, userSort]);

  const requireOwner = () => {
    if (!isOwner) {
      toast.error("Owner access required");
      return false;
    }
    return true;
  };

  const refreshUsers = async (keepSelected = true) => {
    const usersRes = await adminAPI.getAllUsers({ limit: 300, offset: 0 });
    const payload = usersRes.data?.data;
    const list = payload?.users ?? [];
    setUsers(list);

    if (keepSelected && selectedUser) {
      const updated = list.find((u) => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
    }
  };

  const refreshOwnerData = async () => {
    if (!isOwner) return;

    const [settingsRes, gamesRes, pagesRes] = await Promise.all([
      adminAPI.getSettings(),
      adminAPI.getGames(),
      adminAPI.getPages(),
    ]);

    const s = settingsRes.data?.data;
    if (s) {
      setSettings({
        signup_enabled: String(s.signup_enabled) === "true",
        maintenance_mode: String(s.maintenance_mode) === "true",
        max_bet_amount: String(s.max_bet_amount ?? "1000"),
        min_bet_amount: String(s.min_bet_amount ?? "0.00000001"),
      });
    }

    setGames(gamesRes.data?.data ?? []);
    setPages(pagesRes.data?.data ?? []);
  };

  const refreshAdminListsIfAllowed = async () => {
    const tasks = [];
    tasks.push(adminCanManageGames ? adminAPI.getGames() : Promise.resolve(null));
    tasks.push(adminCanManagePages ? adminAPI.getPages() : Promise.resolve(null));

    const [gamesRes, pagesRes] = await Promise.all(tasks);

    if (gamesRes) setGames(gamesRes.data?.data ?? []);
    if (pagesRes) setPages(pagesRes.data?.data ?? []);
  };

  useEffect(() => {
    const run = async () => {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }

      if (!role) {
        setLoading(true);
        return;
      }

      if (!isAdmin) {
        toast.error("Access Denied");
        setLoading(false);
        return;
      }

      if (didLoadRef.current) return;
      didLoadRef.current = true;

      setLoading(true);

      try {
        await refreshUsers(true);
        if (isOwner) await refreshOwnerData();
        else await refreshAdminListsIfAllowed();
      } catch (e) {
        const status = e.response?.status;
        const msg = e.response?.data?.message || e.message || "Failed to load admin data";

        if (status === 403) toast.error("Access Denied");
        else if (status === 401) toast.error("Please login");
        else toast.error(msg);

        console.error("Admin load error:", e);
        didLoadRef.current = false;
      } finally {
        setLoading(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, role]);

  const handleToggleSetting = async (key) => {
    if (!requireOwner()) return;

    const next = !settings[key];
    const prev = settings;
    setSettings((s) => ({ ...s, [key]: next }));

    try {
      await adminAPI.updateSetting({ key, value: String(next) });
      toast.success("Setting updated");
    } catch (e) {
      setSettings(prev);
      toast.error(e.response?.data?.message || "Failed to update setting");
    }
  };

  const handleToggleGame = async (gameId, isEnabledInt) => {
    if (!isOwner && !adminCanManageGames) {
      toast.error("Not allowed to manage games");
      return;
    }

    const wasEnabled = Boolean(isEnabledInt);
    setGames((prev) =>
      prev.map((g) => (g.id === gameId ? { ...g, is_enabled: wasEnabled ? 0 : 1 } : g))
    );

    try {
      await adminAPI.setGameStatus(gameId, { isEnabled: !wasEnabled });
      toast.success("Game updated");

      const gamesRes = await adminAPI.getGames();
      setGames(gamesRes.data?.data ?? []);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update game");
    }
  };

  const handleToggleGameMobile = async (gameId, isMobileEnabledInt) => {
    if (!isOwner && !adminCanManageGames) {
      toast.error("Not allowed to manage games");
      return;
    }

    const wasEnabled = isMobileEnabledInt !== undefined ? Boolean(isMobileEnabledInt) : true;
    setGames((prev) =>
      prev.map((g) => (g.id === gameId ? { ...g, is_mobile_enabled: wasEnabled ? 0 : 1 } : g))
    );

    try {
      await adminAPI.setGameMobileStatus(gameId, { isMobileEnabled: !wasEnabled });
      toast.success("Game mobile updated");

      const gamesRes = await adminAPI.getGames();
      setGames(gamesRes.data?.data ?? []);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update game mobile");
    }
  };

  const handleTogglePage = async (pageKey, isEnabledInt) => {
    if (!isOwner && !adminCanManagePages) {
      toast.error("Not allowed to manage pages");
      return;
    }
    if (!isOwner && pageKey === "admin") {
      toast.error("Admin cannot modify Admin Panel page");
      return;
    }

    const wasEnabled = Boolean(isEnabledInt);
    setPages((prev) =>
      prev.map((p) => (p.page_key === pageKey ? { ...p, is_enabled: wasEnabled ? 0 : 1 } : p))
    );

    try {
      await adminAPI.setPageStatus(pageKey, { isEnabled: !wasEnabled });
      toast.success("Page updated");

      const pagesRes = await adminAPI.getPages();
      setPages(pagesRes.data?.data ?? []);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update page");
    }
  };

  const handleSelectUser = (u) => {
    setPendingRole(null);
    setSelectedUser(u);
    setAdjustAmount("");
    setAdjustReason("");
    setTimeoutHours("");
    setBanHours("");
    setShowDeleteModal(false);
  };

  const selectedIsOwner = selectedUser?.role === "owner";
  const selectedIsSelf = selectedUser?.id === user?.id;
  const selectedIsAdmin = selectedUser?.role === "admin";

  const canModifySelected = !!selectedUser && (selectedUser.role !== "owner" || isOwner);
  const canDangerModifySelected = !!selectedUser && !selectedIsOwner && !selectedIsSelf;

  const bannedNow = isFutureDate(selectedUser?.banned_until);
  const timedOutNow = isFutureDate(selectedUser?.timed_out_until);

  const adminCanBanThisTarget =
    isOwner ||
    (role === "admin" &&
      Boolean(user?.can_ban_users) &&
      (!selectedIsAdmin || Boolean(user?.can_ban_admins)));

  const handleAdjustBalance = async () => {
    if (!selectedUser) return toast.error("Select a user first");
    if (!canModifySelected) return toast.error("You cannot modify this user");
    if (!adjustReason.trim()) return toast.error("Reason is required");

    if (role === "admin") {
      const isSelf = selectedUser.id === user.id;
      if (isSelf && !user?.can_adjust_own_balance) {
        return toast.error("Not allowed to adjust your own balance");
      }
      if (!isSelf && !user?.can_adjust_others_balance) {
        return toast.error("Not allowed to adjust others' balances");
      }
    }

    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      return toast.error("Enter a valid amount (non-zero)");
    }

    setAdjustLoading(true);
    try {
      await adminAPI.adjustBalance(selectedUser.id, { amount, reason: adjustReason.trim() });
      toast.success("Balance adjusted");
      await refreshUsers(true);
      setAdjustAmount("");
      setAdjustReason("");
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to adjust balance");
    } finally {
      setAdjustLoading(false);
    }
  };

  const handleToggleActive = async () => {
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner cannot be deactivated");
    if (selectedIsSelf) return toast.error("You cannot deactivate yourself");

    setStatusLoading(true);
    try {
      const next = !Boolean(selectedUser.is_active);
      await adminAPI.setUserStatus(selectedUser.id, { isActive: next });
      toast.success(`User ${next ? "activated" : "deactivated"}`);
      await refreshUsers(true);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update user status");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleChangeRole = async (newRole) => {
    if (!selectedUser) return;
    if (selectedIsOwner) return toast.error("Owner role cannot be changed");
    if (selectedIsSelf) return toast.error("You cannot change your own role");

    if (!["user", "admin"].includes(newRole)) {
      return toast.error('Role must be "user" or "admin"');
    }

    setRoleLoading(true);
    try {
      await adminAPI.changeUserRole(selectedUser.id, { role: newRole });
      toast.success("Role updated");
      await refreshUsers(true);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to change role");
    } finally {
      setRoleLoading(false);
    }
  };

  const handleTimeoutUser = async () => {
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner cannot be timed out");
    if (selectedIsSelf) return toast.error("You cannot timeout yourself");

    const h = Number(timeoutHours);
    if (!Number.isFinite(h) || h <= 0) return toast.error("Enter valid hours > 0");

    setTimeoutLoading(true);
    try {
      await adminAPI.timeoutUser(selectedUser.id, { hours: h });
      toast.success("Timeout applied");
      await refreshUsers(true);
      setTimeoutHours("");
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to timeout user");
    } finally {
      setTimeoutLoading(false);
    }
  };

  const handleClearTimeout = async () => {
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner cannot be modified");
    if (!timedOutNow) return;

    setClearTimeoutLoading(true);
    try {
      await adminAPI.clearTimeout(selectedUser.id);
      toast.success("Timeout removed");
      await refreshUsers(true);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to clear timeout");
    } finally {
      setClearTimeoutLoading(false);
    }
  };

  const handleBanUser = async () => {
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner cannot be banned");
    if (selectedIsSelf) return toast.error("You cannot ban yourself");

    if (!adminCanBanThisTarget) return toast.error("Not allowed to ban this user");

    const h = Number(banHours);
    if (!Number.isFinite(h) || h <= 0) return toast.error("Enter valid hours > 0");

    setBanLoading(true);
    try {
      await adminAPI.banUser(selectedUser.id, { hours: h });
      toast.success("User banned");
      await refreshUsers(true);
      setBanHours("");
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to ban user");
    } finally {
      setBanLoading(false);
    }
  };

  const handleClearBan = async () => {
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner cannot be modified");
    if (!bannedNow) return;

    if (!adminCanBanThisTarget) return toast.error("Not allowed to unban this user");

    setClearBanLoading(true);
    try {
      await adminAPI.clearBan(selectedUser.id);
      toast.success("Ban removed");
      await refreshUsers(true);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to clear ban");
    } finally {
      setClearBanLoading(false);
    }
  };

  const handleToggleBypassDisabled = async () => {
    if (!requireOwner()) return;
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner bypass cannot be changed");

    const next = !Boolean(selectedUser.can_bypass_disabled);

    setBypassLoading(true);
    try {
      await adminAPI.setBypassDisabled(selectedUser.id, { canBypass: next });
      toast.success("Permission updated");
      await refreshUsers(true);
      await refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update permission");
    } finally {
      setBypassLoading(false);
    }
  };

  const handleSetAdminPerm = async (patch) => {
    if (!requireOwner()) return;
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner permissions cannot be changed");

    const nextPayload = {
      canManageGames: !!selectedUser.can_manage_games,
      canManagePages: !!selectedUser.can_manage_pages,
      canAdjustOthersBalance: !!selectedUser.can_adjust_others_balance,
      canAdjustOwnBalance: !!selectedUser.can_adjust_own_balance,
      ...patch,
    };

    setPermsLoading(true);
    try {
      await adminAPI.setAdminPermissions(selectedUser.id, nextPayload);
      toast.success("Admin permissions updated");
      await refreshUsers(true);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update permissions");
    } finally {
      setPermsLoading(false);
    }
  };

  const handleSetAdminAccessPerm = async (patch) => {
    if (!requireOwner()) return;
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner permissions cannot be changed");

    const nextPayload = {
      canChangeRoles: !!selectedUser.can_change_roles,
      canChangeAdminRoles: !!selectedUser.can_change_admin_roles,
      canTimeoutUsers: !!selectedUser.can_timeout_users,
      canTimeoutAdmins: !!selectedUser.can_timeout_admins,
      canBanUsers: !!selectedUser.can_ban_users,
      canBanAdmins: !!selectedUser.can_ban_admins,
      canDeactivateUsers: !!selectedUser.can_deactivate_users,
      canDeactivateAdmins: !!selectedUser.can_deactivate_admins,
      ...patch,
    };

    setAccessPermsLoading(true);
    try {
      await adminAPI.setAdminAccessPermissions(selectedUser.id, nextPayload);
      toast.success("Admin action permissions updated");
      await refreshUsers(true);
      await refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update admin action permissions");
    } finally {
      setAccessPermsLoading(false);
    }
  };

  // ✅ NEW: owner sets custom bet permissions for selected admin
  const handleSetCustomBetsPerms = async (patch) => {
    if (!requireOwner()) return;
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner permissions cannot be changed");
    if (!selectedIsAdmin) return toast.error("Target must be admin");

    const nextPayload = {
      canCloseCustomBets: !!selectedUser.can_close_custom_bets,
      canRemoveCustomBets: !!selectedUser.can_remove_custom_bets,
      ...patch,
    };

    setCustomBetsPermsLoading(true);
    try {
      await adminAPI.setAdminCustomBetsPermissions(selectedUser.id, nextPayload);
      toast.success("Custom bets permissions updated");
      await refreshUsers(true);
      await refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to update custom bets permissions");
    } finally {
      setCustomBetsPermsLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!requireOwner()) return;
    if (!selectedUser) return toast.error("Select a user first");
    if (selectedIsOwner) return toast.error("Owner cannot be deleted");
    if (selectedIsSelf) return toast.error("You cannot delete yourself");

    setDeleteLoading(true);
    try {
      await adminAPI.deleteUser(selectedUser.id);
      toast.success("User deleted");
      await refreshUsers(false);
      setSelectedUser(null);
      setShowDeleteModal(false);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to delete user");
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.heroCard}>
            <h1 className={styles.title}>Admin</h1>
            <p className={styles.muted}>Please login.</p>
          </div>
        </div>
      </div>
    );
  }

  if (role && !isAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.heroCard}>
            <h1 className={styles.title}>Access Denied</h1>
            <p className={styles.muted}>Admin access required.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.heroCard}>
            <h1 className={styles.title}>Admin</h1>
            <p className={styles.muted}>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  const showGamesSection = isOwner || adminCanManageGames;
  const showPagesSection = isOwner || adminCanManagePages;

  const canEditAdminActionPerms = isOwner && !selectedIsOwner;
  const showAdminActionPerms = !!selectedUser && selectedIsAdmin;

  // ✅ custom bet perms section only for selected admin, owner can edit
  const canEditCustomBetsPerms = isOwner && !!selectedUser && selectedIsAdmin && !selectedIsOwner;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topBar}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.title}>Admin Panel</h1>
              <div className={styles.subtitle}>
                {isOwner ? "Owner controls enabled" : "Admin controls"}
              </div>
            </div>
            <div className={styles.rolePill}>{isOwner ? "Owner" : "Admin"}</div>
          </div>

          <div className={styles.topRight}>
            {isOwner && (
              <button className={styles.secondaryBtn} onClick={() => refreshOwnerData()}>
                Refresh Owner Data
              </button>
            )}
          </div>
        </div>

        <div className={styles.grid}>
          {isOwner && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>System</h2>
                <span className={styles.sectionHint}>Owner only</span>
              </div>

              <div className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Signup Enabled</div>
                  <div className={styles.rowDesc}>Allow new accounts to register.</div>
                </div>
                <button
                  className={`${styles.toggle} ${settings.signup_enabled ? styles.on : styles.off}`}
                  onClick={() => handleToggleSetting("signup_enabled")}
                  disabled={!isOwner}
                >
                  {settings.signup_enabled ? "ON" : "OFF"}
                </button>
              </div>

              <div className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Maintenance Mode</div>
                  <div className={styles.rowDesc}>Betting endpoints should be blocked server-side.</div>
                </div>
                <button
                  className={`${styles.toggle} ${settings.maintenance_mode ? styles.on : styles.off}`}
                  onClick={() => handleToggleSetting("maintenance_mode")}
                  disabled={!isOwner}
                >
                  {settings.maintenance_mode ? "ON" : "OFF"}
                </button>
              </div>

              <div className={styles.settingsDivider} />
              <div className={styles.split}>
                <div className={styles.field}>
                  <label>Min Bet</label>
                  <div className={styles.inputWithStepper}>
                    <input value={settings.min_bet_amount} readOnly />
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Max Bet</label>
                  <div className={styles.inputWithStepper}>
                    <input value={settings.max_bet_amount} readOnly />
                  </div>
                </div>
              </div>
            </section>
          )}

          {showGamesSection && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>Games</h2>
                <span className={styles.sectionHint}>
                  {isOwner ? "Owner only list" : "Manage games"}
                </span>
              </div>

              <div className={styles.table}>
                <div className={styles.tableHead}>
                  <div>Name</div>
                  <div>Status</div>
                  <div>Mobile</div>
                  <div />
                </div>

                {games.map((g) => (
                  <div key={g.id} className={styles.tableRow}>
                    <div>
                      <div className={styles.gameName}>{g.display_name}</div>
                      <div className={styles.mutedSmall}>{g.name}</div>
                    </div>
                    <div className={g.is_enabled ? styles.enabled : styles.disabled}>
                      {g.is_enabled ? "Enabled" : "Disabled"}
                    </div>
                    <div className={g.is_mobile_enabled !== 0 ? styles.enabled : styles.disabled}>
                      {g.is_mobile_enabled !== 0 ? "Mobile On" : "Mobile Off"}
                    </div>
                    <div className={styles.tableActions}>

                      {/* Switch the game on/off (power icon, label hidden on phones) */}
                      <button
                        className={styles.smallBtn}
                        onClick={() => handleToggleGame(g.id, g.is_enabled)}
                        aria-label={g.is_enabled ? "Disable game" : "Enable game"}
                        title={g.is_enabled ? "Disable game" : "Enable game"}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                          <path d="M12 3.5v8" />
                          <path d="M7.1 6.6a7.5 7.5 0 1 0 9.8 0" />
                        </svg>
                        <span className={styles.btnText}>{g.is_enabled ? "Disable" : "Enable"}</span>
                      </button>

                      {/* Mobile availability (phone / phone-off icon) */}
                      <button
                        className={styles.smallBtn}
                        onClick={() => handleToggleGameMobile(g.id, g.is_mobile_enabled)}
                        aria-label={g.is_mobile_enabled !== 0 ? "Disable mobile" : "Enable mobile"}
                        title={g.is_mobile_enabled !== 0 ? "Disable mobile" : "Enable mobile"}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                          <rect x="6" y="2" width="12" height="20" rx="2" ry="2" />
                          <line x1="12" y1="18" x2="12.01" y2="18" />
                          {g.is_mobile_enabled !== 0 && <line x1="4" y1="4" x2="20" y2="20" />}
                        </svg>
                        <span className={styles.btnText}>
                          {g.is_mobile_enabled !== 0 ? "Disable Mobile" : "Enable Mobile"}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {showPagesSection && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>Pages</h2>
                <span className={styles.sectionHint}>Enable/disable pages</span>
              </div>

              <div className={styles.table}>
                <div className={styles.tableHead}>
                  <div>Page</div>
                  <div>Status</div>
                  <div />
                </div>

                {pages.map((p) => {
                  const adminLocked = !isOwner && p.page_key === "admin";
                  return (
                    <div key={p.page_key} className={styles.tableRow}>
                      <div>
                        <div className={styles.gameName}>{p.display_name}</div>
                        <div className={styles.mutedSmall}>{p.page_key}</div>
                      </div>
                      <div className={p.is_enabled ? styles.enabled : styles.disabled}>
                        {p.is_enabled ? "Enabled" : "Disabled"}
                      </div>
                      <div className={styles.tableActions}>
                        <button
                          className={styles.smallBtn}
                          onClick={() => handleTogglePage(p.page_key, p.is_enabled)}
                          disabled={adminLocked}
                          aria-label={p.is_enabled ? "Disable page" : "Enable page"}
                          title={adminLocked ? "Admins cannot modify Admin Panel page" : (p.is_enabled ? "Disable page" : "Enable page")}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                            <path d="M12 3.5v8" />
                            <path d="M7.1 6.6a7.5 7.5 0 1 0 9.8 0" />
                          </svg>
                          <span className={styles.btnText}>{p.is_enabled ? "Disable" : "Enable"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className={styles.sectionWide}>
            <div className={styles.sectionHeader}>
              <h2>Users</h2>
              <span className={styles.sectionHint}>Manage users</span>
            </div>

            <div className={styles.userTools}>
              <div className={styles.field}>
                <label>Search</label>
                <input
                  placeholder="username / email / id"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>

              <div className={styles.userToolsRight}>
                <div className={styles.field}>
                  <label>Role</label>
                  <select value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value)}>
                    <option value="all">All roles</option>
                    <option value="user">Users</option>
                    <option value="admin">Admins</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label>State</label>
                  <select value={userStateFilter} onChange={(e) => setUserStateFilter(e.target.value)}>
                    <option value="all">Any state</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="banned">Banned</option>
                    <option value="timed_out">Timed out</option>
                    <option value="controller">Casino Controllers</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label>Sort</label>
                  <select value={userSort} onChange={(e) => setUserSort(e.target.value)}>
                    <option value="username_asc">Username A–Z</option>
                    <option value="username_desc">Username Z–A</option>
                    <option value="balance_desc">Balance high → low</option>
                    <option value="balance_asc">Balance low → high</option>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="id_asc">ID ascending</option>
                    <option value="id_desc">ID descending</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label>&nbsp;</label>
                  <button className={styles.secondaryBtn} onClick={() => refreshUsers(true)}>
                    Refresh
                  </button>
                </div>
              </div>
            </div>
            <div className={styles.resultCount}>{filteredUsers.length} of {users.length} users</div>

            <div className={styles.userGrid}>
              <div className={styles.userList}>
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    className={`${styles.userRow} ${selectedUser?.id === u.id ? styles.userRowActive : ""} ${u.role === "owner" ? styles.ownerRow : ""
                      }`}
                    onClick={() => handleSelectUser(u)}
                  >
                    <div className={styles.userMain}>
                      <div className={styles.userTop}>
                        <span className={styles.userName}>{u.username}</span>
                        <span className={styles.userRole}>{u.role}</span>

                        {(u.can_bypass_disabled || u.role === "owner") && (
                          <span className={styles.inlineTag}>Casino Controller</span>
                        )}
                      </div>

                      <div className={styles.mutedSmall}>{u.email}</div>
                    </div>
                    <div className={styles.userBal}>
                      {Number(u.balance).toFixed(2)} <span className={styles.btc}>$</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className={styles.userDetail}>
                {!selectedUser && <div className={styles.muted}>Select a user to manage</div>}
                {/* the details expand down with an animation once a user is picked */}
                <div className={`${styles.detailGrow} ${selectedUser ? styles.detailGrowOpen : ""}`}>
                  <div className={styles.subCollapseInner}>
                    {selectedUser && (
                      <>
                        <div className={styles.detailHeader}>
                          <div>
                            <div className={styles.detailName}>{selectedUser.username}</div>
                            <div className={styles.mutedSmall}>
                              #{selectedUser.id} • {selectedUser.email}
                            </div>
                          </div>
                          <div className={styles.detailRole}>{selectedUser.role}</div>
                        </div>

                        <div className={styles.badges}>
                          <span
                            className={`${styles.badge} ${selectedUser.is_active ? styles.badgeOk : styles.badgeDanger
                              }`}
                          >
                            {selectedUser.is_active ? "Active" : "Inactive"}
                          </span>

                          <span
                            className={`${styles.badge} ${bannedNow ? styles.badgeDanger : styles.badgeOk}`}
                          >
                            {bannedNow
                              ? `Banned until ${fmtDateTime(selectedUser.banned_until)}`
                              : "Not banned"}
                          </span>

                          <span
                            className={`${styles.badge} ${timedOutNow ? styles.badgeWarn : styles.badgeOk}`}
                          >
                            {timedOutNow
                              ? `Timed out until ${fmtDateTime(selectedUser.timed_out_until)}`
                              : "Not timed out"}
                          </span>

                          <span
                            className={`${styles.badge} ${selectedUser.role === "owner" || selectedUser.can_bypass_disabled
                              ? styles.badgeOk
                              : ""
                              }`}
                          >
                            {selectedUser.role === "owner" || selectedUser.can_bypass_disabled
                              ? "Unavailable Content Access"
                              : "No Unavailable Content Access"}
                          </span>

                          {selectedIsSelf && (
                            <span className={`${styles.badge} ${styles.badgeWarn}`}>This is you</span>
                          )}
                        </div>

                        <div className={styles.detailBalance}>
                          Balance: {Number(selectedUser.balance).toFixed(2)}{" "}
                          <span className={styles.btc}>$</span>
                        </div>

                        <Sub id="account" title="Account" hint="Role & activation" openId={openSub} onToggle={toggleSub}>

                          <div className={styles.twoCol}>
                            <div className={styles.col}>
                              <div className={styles.field}>
                                <label>Status</label>
                                <input value={selectedUser.is_active ? "Active" : "Inactive"} readOnly />
                              </div>
                              <button
                                className={styles.secondaryBtn}
                                onClick={handleToggleActive}
                                disabled={statusLoading || selectedIsOwner || selectedIsSelf}
                              >
                                {statusLoading
                                  ? "Saving..."
                                  : selectedUser.is_active
                                    ? "Deactivate"
                                    : "Activate"}
                              </button>
                            </div>

                            <div className={styles.col}>
                              <div className={styles.field}>
                                <label>Role</label>
                                <select
                                  className={styles.roleSelect}
                                  value={pendingRole ?? selectedUser.role}
                                  onChange={(e) => setPendingRole(e.target.value)}
                                  disabled={roleLoading || selectedIsOwner || selectedIsSelf}
                                >
                                  <option value="user">User</option>
                                  <option value="admin">Admin</option>
                                </select>
                              </div>
                              <button
                                className={styles.primaryBtn}
                                onClick={() => handleChangeRole(pendingRole ?? selectedUser.role)}
                                disabled={
                                  roleLoading ||
                                  selectedIsOwner ||
                                  selectedIsSelf ||
                                  !pendingRole ||
                                  pendingRole === selectedUser.role
                                }
                              >
                                {roleLoading ? "Saving..." : "Save Changes"}
                              </button>
                            </div>
                          </div>
                        </Sub>
                        <Sub id="balance" title="Balance" hint="Adjust user funds" openId={openSub} onToggle={toggleSub}>

                          <div className={styles.twoCol}>
                            <div className={styles.field}>
                              <label>Adjust Amount (negative subtracts)</label>
                              <div className={styles.inputWithStepper}>
                                <input
                                  value={adjustAmount}
                                  onChange={(e) => setAdjustAmount(e.target.value)}
                                  placeholder="e.g. -100"
                                  disabled={!canModifySelected}
                                />
                                <Stepper value={adjustAmount || "0"} onChange={setAdjustAmount} step={10} min={-1000000} max={1000000} decimals={2} disabled={!canModifySelected} />
                              </div>
                            </div>

                            <div className={styles.field}>
                              <label>Reason (required)</label>
                              <input
                                value={adjustReason}
                                onChange={(e) => setAdjustReason(e.target.value)}
                                placeholder="..."
                                disabled={!canModifySelected}
                              />
                            </div>

                          </div>
                          <button
                            className={styles.primaryBtn}
                            onClick={handleAdjustBalance}
                            disabled={!canModifySelected || adjustLoading}
                          >
                            {adjustLoading ? "Saving..." : "Adjust Balance"}
                          </button>
                        </Sub>
                        <Sub id="moderation" title="Moderation" hint="Timeouts & bans" openId={openSub} onToggle={toggleSub}>

                          <div className={styles.twoCol}>
                            <div className={styles.col}>
                              <div className={styles.field}>
                                <label>Timeout (hours)</label>
                                <div className={styles.inputWithStepper}>
                                  <input
                                    value={timeoutHours}
                                    onChange={(e) => setTimeoutHours(e.target.value)}
                                    placeholder="e.g. 1"
                                    disabled={timeoutLoading || selectedIsOwner || selectedIsSelf}
                                  />
                                  <Stepper value={timeoutHours || "0"} onChange={setTimeoutHours} step={1} min={1} max={720} decimals={0} disabled={timeoutLoading || selectedIsOwner || selectedIsSelf || !canModifySelected} />
                                </div>
                                {timedOutNow && (
                                  <div className={styles.inlineNote}>
                                    Current: {fmtDateTime(selectedUser.timed_out_until)}
                                  </div>
                                )}
                              </div>
                              <button
                                className={styles.secondaryBtn}
                                onClick={handleTimeoutUser}
                                disabled={timeoutLoading || selectedIsOwner || selectedIsSelf}
                              >
                                {timeoutLoading ? "Applying..." : "Apply Timeout"}
                              </button>
                              {timedOutNow && (
                                <button
                                  className={styles.secondaryBtn}
                                  onClick={handleClearTimeout}
                                  disabled={clearTimeoutLoading || selectedIsOwner}
                                >
                                  {clearTimeoutLoading ? "Removing..." : "Remove Timeout"}
                                </button>
                              )}
                            </div>

                            <div className={styles.col}>
                              <div className={styles.field}>
                                <label className={styles.labelRow}>
                                  Ban (hours)
                                  {!adminCanBanThisTarget && !selectedIsOwner && !selectedIsSelf && (
                                    <HazardBadge title="Not allowed" onClick={() => setShowNotAllowedModal(true)} />
                                  )}
                                </label>
                                <div className={styles.inputWithStepper}>
                                  <input
                                    value={banHours}
                                    onChange={(e) => setBanHours(e.target.value)}
                                    placeholder="e.g. 24"
                                    disabled={
                                      banLoading ||
                                      selectedIsOwner ||
                                      selectedIsSelf ||
                                      !adminCanBanThisTarget
                                    }
                                  />
                                  <Stepper value={banHours || "0"} onChange={setBanHours} step={1} min={1} max={8760} decimals={0} disabled={banLoading || selectedIsOwner || selectedIsSelf || !adminCanBanThisTarget} />
                                </div>
                                {bannedNow && (
                                  <div className={styles.inlineNote}>
                                    Current: {fmtDateTime(selectedUser.banned_until)}
                                  </div>
                                )}
                              </div>
                              {(isOwner || (role === "admin" && adminCanBanThisTarget)) && (
                                <button
                                  className={styles.dangerBtn}
                                  onClick={handleBanUser}
                                  disabled={banLoading || selectedIsOwner || selectedIsSelf || !adminCanBanThisTarget}
                                >
                                  {banLoading ? "Banning..." : "Ban User"}
                                </button>
                              )}
                              {bannedNow && (isOwner || (role === "admin" && adminCanBanThisTarget)) && (
                                <button
                                  className={styles.secondaryBtn}
                                  onClick={handleClearBan}
                                  disabled={clearBanLoading || selectedIsOwner || !adminCanBanThisTarget}
                                >
                                  {clearBanLoading ? "Removing..." : "Remove Ban"}
                                </button>
                              )}
                            </div>
                          </div>
                        </Sub>
                        {isOwner && (
                          <Sub id="perms" title="Admin Permissions" hint="Owner only" openId={openSub} onToggle={toggleSub}>

                            <div className={styles.rowMini}>
                              <div>
                                <div className={styles.rowTitle}>Can manage games availability</div>
                                <div className={styles.rowDesc}>
                                  Allow this user (if admin) to enable/disable games.
                                </div>
                              </div>
                              <button
                                className={`${styles.toggle} ${selectedUser.can_manage_games ? styles.on : styles.off
                                  }`}
                                onClick={() =>
                                  handleSetAdminPerm({ canManageGames: !selectedUser.can_manage_games })
                                }
                                disabled={permsLoading || selectedIsOwner}
                              >
                                {selectedUser.can_manage_games ? "ON" : "OFF"}
                              </button>
                            </div>

                            <div className={styles.rowMini}>
                              <div>
                                <div className={styles.rowTitle}>Can manage pages availability</div>
                                <div className={styles.rowDesc}>
                                  Allow enabling/disabling pages (cannot change Admin Panel page).
                                </div>
                              </div>
                              <button
                                className={`${styles.toggle} ${selectedUser.can_manage_pages ? styles.on : styles.off
                                  }`}
                                onClick={() =>
                                  handleSetAdminPerm({ canManagePages: !selectedUser.can_manage_pages })
                                }
                                disabled={permsLoading || selectedIsOwner}
                              >
                                {selectedUser.can_manage_pages ? "ON" : "OFF"}
                              </button>
                            </div>

                            <div className={styles.rowMini}>
                              <div>
                                <div className={styles.rowTitle}>Can adjust others' balances</div>
                                <div className={styles.rowDesc}>Allow adjusting balances of other users.</div>
                              </div>
                              <button
                                className={`${styles.toggle} ${selectedUser.can_adjust_others_balance ? styles.on : styles.off
                                  }`}
                                onClick={() =>
                                  handleSetAdminPerm({
                                    canAdjustOthersBalance: !selectedUser.can_adjust_others_balance,
                                  })
                                }
                                disabled={permsLoading || selectedIsOwner}
                              >
                                {selectedUser.can_adjust_others_balance ? "ON" : "OFF"}
                              </button>
                            </div>

                            <div className={styles.rowMini}>
                              <div>
                                <div className={styles.rowTitle}>Can adjust own balance</div>
                                <div className={styles.rowDesc}>
                                  Allow this user to adjust their own balance.
                                </div>
                              </div>
                              <button
                                className={`${styles.toggle} ${selectedUser.can_adjust_own_balance ? styles.on : styles.off
                                  }`}
                                onClick={() =>
                                  handleSetAdminPerm({
                                    canAdjustOwnBalance: !selectedUser.can_adjust_own_balance,
                                  })
                                }
                                disabled={permsLoading || selectedIsOwner}
                              >
                                {selectedUser.can_adjust_own_balance ? "ON" : "OFF"}
                              </button>
                            </div>
                          </Sub>)}
                        {isOwner && (
                          <Sub id="access" title="Access" hint="Owner only permissions" openId={openSub} onToggle={toggleSub}>

                            {isOwner && (
                              <div className={styles.rowMini}>
                                <div>
                                  <div className={styles.rowTitle}>Bypass disabled games/pages</div>
                                  <div className={styles.rowDesc}>
                                    Allows user to view disabled content and play disabled games.
                                  </div>
                                </div>

                                <button
                                  className={`${styles.toggle} ${selectedUser.role === "owner" || selectedUser.can_bypass_disabled
                                    ? styles.on
                                    : styles.off
                                    }`}
                                  onClick={handleToggleBypassDisabled}
                                  disabled={bypassLoading || selectedIsOwner}
                                  title={selectedIsOwner ? "Owner always bypasses" : "Toggle bypass"}
                                >
                                  {selectedUser.role === "owner" || selectedUser.can_bypass_disabled ? "ON" : "OFF"}
                                </button>
                              </div>
                            )}

                            {/* ✅ NEW: Custom Bets permissions (owner only, per admin) */}
                            {canEditCustomBetsPerms && (
                              <SubSub id="custom_bets" title="Custom Bets admin permissions" openId={openSubSub} onToggle={toggleSubSub}>

                                <div className={styles.rowMini}>
                                  <div>
                                    <div className={styles.rowTitle}>Can close custom bets</div>
                                    <div className={styles.rowDesc}>Allow ending markets early (close).</div>
                                  </div>
                                  <button
                                    className={`${styles.toggle} ${selectedUser.can_close_custom_bets ? styles.on : styles.off
                                      }`}
                                    onClick={() =>
                                      handleSetCustomBetsPerms({
                                        canCloseCustomBets: !selectedUser.can_close_custom_bets,
                                      })
                                    }
                                    disabled={customBetsPermsLoading}
                                  >
                                    {selectedUser.can_close_custom_bets ? "ON" : "OFF"}
                                  </button>
                                </div>

                                <div className={styles.rowMini}>
                                  <div>
                                    <div className={styles.rowTitle}>Can remove custom bets</div>
                                    <div className={styles.rowDesc}>Allow deleting a market and refunding pending bets.</div>
                                  </div>
                                  <button
                                    className={`${styles.toggle} ${selectedUser.can_remove_custom_bets ? styles.on : styles.off
                                      }`}
                                    onClick={() =>
                                      handleSetCustomBetsPerms({
                                        canRemoveCustomBets: !selectedUser.can_remove_custom_bets,
                                      })
                                    }
                                    disabled={customBetsPermsLoading}
                                  >
                                    {selectedUser.can_remove_custom_bets ? "ON" : "OFF"}
                                  </button>
                                </div>
                              </SubSub>
                            )}

                            {showAdminActionPerms && (
                              <SubSub id="admin_actions" title="Admin action permissions" openId={openSubSub} onToggle={toggleSubSub}>

                                {[
                                  { k: "can_change_roles", label: "Allow ADMIN to change others' role", patch: "canChangeRoles" },
                                  { k: "can_change_admin_roles", label: "Allow ADMIN to change other ADMINs' role", patch: "canChangeAdminRoles" },
                                  { k: "can_timeout_users", label: "Allow ADMIN to timeout others", patch: "canTimeoutUsers" },
                                  { k: "can_timeout_admins", label: "Allow ADMIN to timeout other ADMINs", patch: "canTimeoutAdmins" },
                                  { k: "can_ban_users", label: "Allow ADMIN to ban others", patch: "canBanUsers" },
                                  { k: "can_ban_admins", label: "Allow ADMIN to ban other ADMINs", patch: "canBanAdmins" },
                                  { k: "can_deactivate_users", label: "Allow ADMIN to deactivate others", patch: "canDeactivateUsers" },
                                  { k: "can_deactivate_admins", label: "Allow ADMIN to deactivate other ADMINs", patch: "canDeactivateAdmins" },
                                ].map((item) => {
                                  const on = Boolean(selectedUser?.[item.k]);
                                  return (
                                    <div key={item.k} className={styles.rowMini}>
                                      <div>
                                        <div className={styles.rowTitle}>{item.label}</div>
                                        <div className={styles.rowDesc}>Per-admin permission.</div>
                                      </div>
                                      <button
                                        className={`${styles.toggle} ${on ? styles.on : styles.off}`}
                                        onClick={() => handleSetAdminAccessPerm({ [item.patch]: !on })}
                                        disabled={!canEditAdminActionPerms || accessPermsLoading}
                                        title={!canEditAdminActionPerms ? "Owner only" : ""}
                                      >
                                        {on ? "ON" : "OFF"}
                                      </button>
                                    </div>
                                  );
                                })}
                              </SubSub>
                            )}
                          </Sub>)}
                        {isOwner && (
                          <Sub id="danger" title="Danger Zone" hint="Permanent actions" openId={openSub} onToggle={toggleSub} danger>

                            <div className={styles.inlineNote}>
                              Hard delete permanently removes the user record.
                            </div>

                            <div className={styles.btnRow}>
                              <button
                                className={styles.dangerBtn}
                                onClick={() => setShowDeleteModal(true)}
                                disabled={!canDangerModifySelected}
                              >
                                Delete User
                              </button>
                            </div>
                          </Sub>)}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <Modal
          isOpen={showNotAllowedModal}
          onClose={() => setShowNotAllowedModal(false)}
          title="Not Allowed"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9L1.8 18.3A2 2 0 0 0 3.5 21.3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          }
          description="You are not allowed to do that. This action requires a permission your account does not have — ask the owner to grant it."
        />

        <Modal
          isOpen={showDeleteModal && !!selectedUser}
          onClose={() => setShowDeleteModal(false)}
          title="Delete User"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M10 11v6M14 11v6" />
              <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          }
          description={
            selectedUser
              ? `This will permanently delete ${selectedUser.username} (#${selectedUser.id}). This action cannot be undone.`
              : ""
          }
        >
          <div className={styles.modalActions}>
            <button
              className={styles.secondaryBtn}
              onClick={() => setShowDeleteModal(false)}
              disabled={deleteLoading}
              type="button"
            >
              Cancel
            </button>
            <button className={styles.dangerBtn} onClick={handleDeleteUser} disabled={deleteLoading} type="button">
              {deleteLoading ? "Deleting..." : "Delete permanently"}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}

export default Admin;