const { db } = require("../config/database");
const bcrypt = require("bcrypt");

class User {
  static async create({ email, password, username }) {
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const result = db
        .prepare(
          `
        INSERT INTO users (email, password_hash, username, balance, role)
        VALUES (?, ?, ?, 100.0, 'user')
      `
        )
        .run(email, passwordHash, username);

      db.prepare(
        `
        INSERT INTO audit_logs (user_id, action_type, action_details)
        VALUES (?, ?, ?)
      `
      ).run(result.lastInsertRowid, "ACCOUNT_CREATED", JSON.stringify({ email, username }));

      return this.findById(result.lastInsertRowid);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT") {
        if (error.message.includes("email")) throw new Error("Email already registered");
        if (error.message.includes("username")) throw new Error("Username already taken");
      }
      throw error;
    }
  }

  static findById(id) {
    return db
      .prepare(
        `
      SELECT id, email, username, balance, role, is_active,
             banned_until, timed_out_until,
             banned_by, timed_out_by, deactivated_by,
             can_bypass_disabled,
             can_manage_games, can_manage_pages,
             can_adjust_others_balance, can_adjust_own_balance,
             can_change_roles, can_change_admin_roles,
             can_timeout_users, can_timeout_admins,
             can_ban_users, can_ban_admins,
             can_deactivate_users, can_deactivate_admins,
             can_close_custom_bets, can_remove_custom_bets,
             created_at, updated_at
      FROM users
      WHERE id = ?
    `
      )
      .get(id);
  }

  static findByEmail(email) {
    return db
      .prepare(
        `
      SELECT id, email, username, balance, role, is_active, password_hash,
             banned_until, timed_out_until,
             banned_by, timed_out_by, deactivated_by,
             can_bypass_disabled,
             can_manage_games, can_manage_pages,
             can_adjust_others_balance, can_adjust_own_balance,
             can_change_roles, can_change_admin_roles,
             can_timeout_users, can_timeout_admins,
             can_ban_users, can_ban_admins,
             can_deactivate_users, can_deactivate_admins,
             can_close_custom_bets, can_remove_custom_bets,
             created_at, updated_at
      FROM users
      WHERE email = ?
    `
      )
      .get(email);
  }

  static async verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  static setBypassDisabled(userId, canBypass, adminId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("User not found");
    if (user.role === "owner") throw new Error("Owner bypass cannot be changed");

    db.prepare("UPDATE users SET can_bypass_disabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      canBypass ? 1 : 0,
      userId
    );

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, adminId, "BYPASS_DISABLED_CHANGED", JSON.stringify({ can_bypass_disabled: !!canBypass }));

    return this.findById(userId);
  }

  static setAdminPermissions(userId, perms, ownerId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("User not found");
    if (user.role === "owner") throw new Error("Cannot modify owner permissions");

    db.prepare(
      `
      UPDATE users
      SET can_manage_games = ?,
          can_manage_pages = ?,
          can_adjust_others_balance = ?,
          can_adjust_own_balance = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      perms.can_manage_games ? 1 : 0,
      perms.can_manage_pages ? 1 : 0,
      perms.can_adjust_others_balance ? 1 : 0,
      perms.can_adjust_own_balance ? 1 : 0,
      userId
    );

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, ownerId, "ADMIN_PERMISSIONS_CHANGED", JSON.stringify(perms));

    return this.findById(userId);
  }

  static setAdminActionPermissions(userId, perms, ownerId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("User not found");
    if (user.role === "owner") throw new Error("Cannot modify owner permissions");

    db.prepare(
      `
      UPDATE users
      SET can_change_roles = ?,
          can_change_admin_roles = ?,
          can_timeout_users = ?,
          can_timeout_admins = ?,
          can_ban_users = ?,
          can_ban_admins = ?,
          can_deactivate_users = ?,
          can_deactivate_admins = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      perms.can_change_roles ? 1 : 0,
      perms.can_change_admin_roles ? 1 : 0,
      perms.can_timeout_users ? 1 : 0,
      perms.can_timeout_admins ? 1 : 0,
      perms.can_ban_users ? 1 : 0,
      perms.can_ban_admins ? 1 : 0,
      perms.can_deactivate_users ? 1 : 0,
      perms.can_deactivate_admins ? 1 : 0,
      userId
    );

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, ownerId, "ADMIN_ACTION_PERMISSIONS_CHANGED", JSON.stringify(perms));

    return this.findById(userId);
  }

  // ✅ NEW: per-admin custom bets permissions (owner only)
  static setCustomBetsPermissions(userId, perms, ownerId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("User not found");
    if (user.role === "owner") throw new Error("Cannot modify owner permissions");
    if (user.role !== "admin") throw new Error("Target user must be admin");

    db.prepare(
      `
      UPDATE users
      SET can_close_custom_bets = ?,
          can_remove_custom_bets = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      perms.can_close_custom_bets ? 1 : 0,
      perms.can_remove_custom_bets ? 1 : 0,
      userId
    );

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, ownerId, "ADMIN_CUSTOM_BETS_PERMISSIONS_CHANGED", JSON.stringify(perms));

    return this.findById(userId);
  }

  static updateBalance(userId, amount, description = "") {
    const updateBalance = db.transaction((userId, amount) => {
      const row = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
      if (!row) throw new Error("User not found");

      const current = Number(row.balance);
      const delta = Number(amount);

      if (!Number.isFinite(current) || !Number.isFinite(delta)) throw new Error("Invalid balance update");

      const newBalance = current + delta;
      if (newBalance < 0) throw new Error("Insufficient balance");

      db.prepare("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newBalance, userId);

      db.prepare(
        `
        INSERT INTO audit_logs (user_id, action_type, action_details)
        VALUES (?, ?, ?)
      `
      ).run(userId, "BALANCE_CHANGE", JSON.stringify({ amount: delta, new_balance: newBalance, description }));

      return newBalance;
    });

    return updateBalance(userId, amount);
  }

  static updateRole(userId, newRole, adminId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (user && user.role === "owner") throw new Error("Cannot change owner role");

    db.prepare("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newRole, userId);

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, adminId, "ROLE_CHANGED", JSON.stringify({ new_role: newRole }));

    return this.findById(userId);
  }

  static setActive(userId, isActive, adminId) {
    const user = db.prepare("SELECT role, is_active FROM users WHERE id = ?").get(userId);
    if (user && user.role === "owner") throw new Error("Cannot deactivate owner account");

    const deactivatedBy = isActive ? null : adminId;

    db.prepare(
      "UPDATE users SET is_active = ?, deactivated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(isActive ? 1 : 0, deactivatedBy, userId);

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, adminId, "ACCOUNT_STATUS_CHANGED", JSON.stringify({ is_active: isActive, deactivated_by: deactivatedBy }));

    return this.findById(userId);
  }

  static setBanUntil(userId, bannedUntilIso, adminId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (user && user.role === "owner") throw new Error("Cannot ban owner account");

    const bannedBy = bannedUntilIso ? adminId : null;

    db.prepare(
      "UPDATE users SET banned_until = ?, banned_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(bannedUntilIso ?? null, bannedBy, userId);

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(
      userId,
      adminId,
      bannedUntilIso ? "USER_BANNED" : "USER_UNBANNED",
      JSON.stringify({ banned_until: bannedUntilIso ?? null, banned_by: bannedBy })
    );

    return this.findById(userId);
  }

  static setTimeoutUntil(userId, timedOutUntilIso, adminId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (user && user.role === "owner") throw new Error("Cannot timeout owner account");

    const timedOutBy = timedOutUntilIso ? adminId : null;

    db.prepare(
      "UPDATE users SET timed_out_until = ?, timed_out_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(timedOutUntilIso ?? null, timedOutBy, userId);

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(
      userId,
      adminId,
      timedOutUntilIso ? "USER_TIMED_OUT" : "USER_TIMEOUT_CLEARED",
      JSON.stringify({ timed_out_until: timedOutUntilIso ?? null, timed_out_by: timedOutBy })
    );

    return this.findById(userId);
  }

  static hardDelete(userId, adminId) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("User not found");
    if (user.role === "owner") throw new Error("Cannot delete owner account");

    db.prepare(
      `
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, adminId, "USER_DELETED", JSON.stringify({ deleted: true }));

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return true;
  }

  static getAll(limit = 100, offset = 0) {
    return db
      .prepare(
        `
      SELECT id, email, username, balance, role, is_active,
             banned_until, timed_out_until,
             banned_by, timed_out_by, deactivated_by,
             can_bypass_disabled,
             can_manage_games, can_manage_pages,
             can_adjust_others_balance, can_adjust_own_balance,
             can_change_roles, can_change_admin_roles,
             can_timeout_users, can_timeout_admins,
             can_ban_users, can_ban_admins,
             can_deactivate_users, can_deactivate_admins,
             can_close_custom_bets, can_remove_custom_bets,
             created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(limit, offset);
  }

  static getCount() {
    return db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  }

  static getStats(userId) {
    const stats = {
      total_bets: 0,
      total_wagered: 0,
      total_profit: 0,
      win_count: 0,
      loss_count: 0,
      biggest_win: 0,
      biggest_loss: 0,
    };

    const result = db
      .prepare(
        `
      SELECT 
        COUNT(*) as total_bets,
        SUM(bet_amount) as total_wagered,
        SUM(payout_amount - bet_amount) as total_profit,
        SUM(CASE WHEN payout_amount > bet_amount THEN 1 ELSE 0 END) as win_count,
        SUM(CASE WHEN payout_amount < bet_amount THEN 1 ELSE 0 END) as loss_count,
        MAX(payout_amount - bet_amount) as biggest_win,
        MIN(payout_amount - bet_amount) as biggest_loss
      FROM rounds
      WHERE user_id = ?
    `
      )
      .get(userId);

    if (result && result.total_bets > 0) {
      return {
        total_bets: result.total_bets,
        total_wagered: result.total_wagered || 0,
        total_profit: result.total_profit || 0,
        win_count: result.win_count || 0,
        loss_count: result.loss_count || 0,
        win_rate: result.total_bets > 0 ? (result.win_count / result.total_bets) * 100 : 0,
        biggest_win: result.biggest_win || 0,
        biggest_loss: result.biggest_loss || 0,
      };
    }

    return stats;
  }
}

module.exports = User;