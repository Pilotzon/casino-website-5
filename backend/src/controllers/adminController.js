const User = require("../models/User");
const Game = require("../models/Game");
const Round = require("../models/Round");
const AuditLog = require("../models/AuditLog");
const AuditService = require("../services/auditService");
const { db } = require("../config/database");
const { sanitizeString } = require("../middleware/validation");

function bool(v) {
  return Boolean(Number(v));
}

function canManageGames(req) {
  if (req.user.role === "owner") return true;
  return req.user.role === "admin" && Boolean(req.user.can_manage_games);
}

function canManagePages(req) {
  if (req.user.role === "owner") return true;
  return req.user.role === "admin" && Boolean(req.user.can_manage_pages);
}

function gate(reqUser, target, action) {
  if (reqUser.role === "owner") return { ok: true };
  if (reqUser.role !== "admin") return { ok: false, status: 403, message: "Admin access required" };

  if (!target) return { ok: false, status: 404, message: "User not found" };
  if (target.role === "owner") return { ok: false, status: 403, message: "Cannot modify owner" };

  const targetIsAdmin = target.role === "admin";

  switch (action) {
    case "role":
      if (!bool(reqUser.can_change_roles)) return { ok: false, status: 403, message: "Not allowed to change roles" };
      if (targetIsAdmin && !bool(reqUser.can_change_admin_roles)) {
        return { ok: false, status: 403, message: "Not allowed to change other admins' roles" };
      }
      return { ok: true };

    case "timeout":
      if (!bool(reqUser.can_timeout_users)) return { ok: false, status: 403, message: "Not allowed to timeout users" };
      if (targetIsAdmin && !bool(reqUser.can_timeout_admins)) {
        return { ok: false, status: 403, message: "Not allowed to timeout admins" };
      }
      return { ok: true };

    case "ban":
      if (!bool(reqUser.can_ban_users)) return { ok: false, status: 403, message: "Not allowed to ban/unban users" };
      if (targetIsAdmin && !bool(reqUser.can_ban_admins)) {
        return { ok: false, status: 403, message: "Not allowed to ban/unban admins" };
      }
      return { ok: true };

    case "deactivate":
      if (!bool(reqUser.can_deactivate_users)) return { ok: false, status: 403, message: "Not allowed to deactivate users" };
      if (targetIsAdmin && !bool(reqUser.can_deactivate_admins)) {
        return { ok: false, status: 403, message: "Not allowed to deactivate admins" };
      }
      return { ok: true };

    default:
      return { ok: false, status: 400, message: "Unknown action" };
  }
}

function denyIfOwnerApplied(reqUser, target, kind) {
  if (reqUser.role === "owner") return null;

  const byKey =
    kind === "ban" ? "banned_by" :
    kind === "timeout" ? "timed_out_by" :
    kind === "deactivate" ? "deactivated_by" :
    null;

  if (!byKey) return null;

  const by = target?.[byKey];
  if (!by) return null;

  const ownerRow = db.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").get();
  const ownerId = ownerRow?.id;

  if (ownerId && Number(by) === Number(ownerId)) {
    return { status: 403, message: "This action was applied by the owner and cannot be changed by admins" };
  }

  return null;
}

class AdminController {
  static async getAllUsers(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;

      const users = User.getAll(limit, offset);
      const totalUsers = User.getCount();

      res.json({ success: true, data: { users, total: totalUsers, limit, offset } });
    } catch (error) {
      console.error("Get all users error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
  }

  static async getUserDetails(req, res) {
    try {
      const { userId } = req.params;

      const user = User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const stats = User.getStats(userId);
      const recentRounds = Round.getUserRounds(userId, 20);
      const auditLogs = AuditLog.getUserLogs(userId, 50);

      res.json({ success: true, data: { user, stats, recentRounds, auditLogs } });
    } catch (error) {
      console.error("Get user details error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch user details" });
    }
  }

  static async adjustBalance(req, res) {
    try {
      const { userId } = req.params;
      const { amount, reason } = req.body;

      if (amount === undefined || isNaN(amount)) {
        return res.status(400).json({ success: false, message: "Valid amount required" });
      }
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ success: false, message: "Reason must be at least 5 characters" });
      }

      const targetUser = User.findById(userId);
      if (!targetUser) return res.status(404).json({ success: false, message: "User not found" });

      if (targetUser.role === "owner" && req.user.role !== "owner") {
        return res.status(403).json({ success: false, message: "Only the owner can adjust owner balance" });
      }

      const isSelf = Number(req.user.id) === Number(userId);

      if (req.user.role === "admin") {
        if (isSelf && !req.user.can_adjust_own_balance) {
          return res.status(403).json({ success: false, message: "You cannot adjust your own balance" });
        }
        if (!isSelf && !req.user.can_adjust_others_balance) {
          return res.status(403).json({ success: false, message: "You cannot adjust other users' balances" });
        }
      }

      const sanitizedReason = sanitizeString(reason, 500);

      const newBalance = User.updateBalance(userId, Number(amount), `Admin adjustment: ${sanitizedReason}`);
      AuditService.logBalanceAdjustment(userId, req.user.id, Number(amount), sanitizedReason, req);

      res.json({
        success: true,
        message: "Balance adjusted successfully",
        data: { userId, amount: Number(amount), newBalance, reason: sanitizedReason },
      });
    } catch (error) {
      console.error("Adjust balance error:", error);
      res.status(500).json({ success: false, message: error.message || "Failed to adjust balance" });
    }
  }

  static async changeUserRole(req, res) {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (!["user", "admin"].includes(role)) {
        return res.status(400).json({ success: false, message: 'Role must be "user" or "admin"' });
      }

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Owner role cannot be changed" });

      const g = gate(req.user, target, "role");
      if (!g.ok) return res.status(g.status).json({ success: false, message: g.message });

      const oldRole = target.role;
      const updatedUser = User.updateRole(userId, role, req.user.id);
      AuditService.logRoleChange(userId, req.user.id, oldRole, role, req);

      res.json({ success: true, message: "User role updated successfully", data: updatedUser });
    } catch (error) {
      console.error("Change user role error:", error);
      res.status(500).json({ success: false, message: error.message || "Failed to change role" });
    }
  }

  static async setUserStatus(req, res) {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") {
        return res.status(400).json({ success: false, message: "isActive must be a boolean" });
      }

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Owner cannot be deactivated" });

      const lock = denyIfOwnerApplied(req.user, target, "deactivate");
      if (lock) return res.status(lock.status).json({ success: false, message: lock.message });

      const g = gate(req.user, target, "deactivate");
      if (!g.ok) return res.status(g.status).json({ success: false, message: g.message });

      const updatedUser = User.setActive(userId, isActive, req.user.id);
      AuditService.logAccountStatusChange(userId, req.user.id, isActive, req);

      res.json({
        success: true,
        message: `User ${isActive ? "activated" : "deactivated"} successfully`,
        data: updatedUser,
      });
    } catch (error) {
      console.error("Set user status error:", error);
      res.status(500).json({ success: false, message: error.message || "Failed to change user status" });
    }
  }

  static async setBypassDisabled(req, res) {
    try {
      const { userId } = req.params;
      const { canBypass } = req.body;

      if (typeof canBypass !== "boolean") {
        return res.status(400).json({ success: false, message: "canBypass must be boolean" });
      }

      const updated = User.setBypassDisabled(userId, canBypass, req.user.id);
      res.json({ success: true, message: "Bypass permission updated", data: updated });
    } catch (e) {
      console.error("Set bypass error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to update bypass permission" });
    }
  }

  static async setAdminPermissions(req, res) {
    try {
      const { userId } = req.params;
      const { canManageGames, canManagePages, canAdjustOthersBalance, canAdjustOwnBalance } = req.body;

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") {
        return res.status(403).json({ success: false, message: "Cannot modify owner permissions" });
      }

      const updated = User.setAdminPermissions(
        userId,
        {
          can_manage_games: !!canManageGames,
          can_manage_pages: !!canManagePages,
          can_adjust_others_balance: !!canAdjustOthersBalance,
          can_adjust_own_balance: !!canAdjustOwnBalance,
        },
        req.user.id
      );

      res.json({ success: true, message: "Admin permissions updated", data: updated });
    } catch (e) {
      console.error("Set admin permissions error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to update permissions" });
    }
  }

  static async setAdminActionPermissions(req, res) {
    try {
      const { userId } = req.params;
      const body = req.body || {};

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Cannot modify owner permissions" });

      const updated = User.setAdminActionPermissions(
        userId,
        {
          can_change_roles: !!body.canChangeRoles,
          can_change_admin_roles: !!body.canChangeAdminRoles,
          can_timeout_users: !!body.canTimeoutUsers,
          can_timeout_admins: !!body.canTimeoutAdmins,
          can_ban_users: !!body.canBanUsers,
          can_ban_admins: !!body.canBanAdmins,
          can_deactivate_users: !!body.canDeactivateUsers,
          can_deactivate_admins: !!body.canDeactivateAdmins,
        },
        req.user.id
      );

      res.json({ success: true, message: "Admin action permissions updated", data: updated });
    } catch (e) {
      console.error("Set admin action permissions error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to update admin action permissions" });
    }
  }

  // ✅ NEW: owner-only custom bets permissions for admins
  static async setAdminCustomBetsPermissions(req, res) {
    try {
      const { userId } = req.params;
      const body = req.body || {};

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Cannot modify owner permissions" });

      const updated = User.setCustomBetsPermissions(
        userId,
        {
          can_close_custom_bets: !!body.canCloseCustomBets,
          can_remove_custom_bets: !!body.canRemoveCustomBets,
        },
        req.user.id
      );

      res.json({ success: true, message: "Admin custom bets permissions updated", data: updated });
    } catch (e) {
      console.error("Set admin custom bets perms error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to update custom bets permissions" });
    }
  }

  static async timeoutUser(req, res) {
    try {
      const { userId } = req.params;
      const { hours } = req.body;

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Cannot timeout owner" });

      const lock = denyIfOwnerApplied(req.user, target, "timeout");
      if (lock) return res.status(lock.status).json({ success: false, message: lock.message });

      const g = gate(req.user, target, "timeout");
      if (!g.ok) return res.status(g.status).json({ success: false, message: g.message });

      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) {
        return res.status(400).json({ success: false, message: "Valid hours required" });
      }

      if (req.user.role === "admin" && h > 6) {
        return res.status(403).json({ success: false, message: "Admin can timeout up to 6 hours" });
      }

      const until = new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
      const updated = User.setTimeoutUntil(userId, until, req.user.id);

      res.json({ success: true, message: "User timed out", data: updated });
    } catch (e) {
      console.error("Timeout user error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to timeout user" });
    }
  }

  static async clearTimeoutUser(req, res) {
    try {
      const { userId } = req.params;

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Cannot clear owner timeout" });

      const lock = denyIfOwnerApplied(req.user, target, "timeout");
      if (lock) return res.status(lock.status).json({ success: false, message: lock.message });

      const g = gate(req.user, target, "timeout");
      if (!g.ok) return res.status(g.status).json({ success: false, message: g.message });

      const updated = User.setTimeoutUntil(userId, null, req.user.id);
      res.json({ success: true, message: "Timeout cleared", data: updated });
    } catch (e) {
      console.error("Clear timeout error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to clear timeout" });
    }
  }

  static async banUser(req, res) {
    try {
      const { userId } = req.params;
      const { hours } = req.body;

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Cannot ban owner" });

      const lock = denyIfOwnerApplied(req.user, target, "ban");
      if (lock) return res.status(lock.status).json({ success: false, message: lock.message });

      const g = gate(req.user, target, "ban");
      if (!g.ok) return res.status(g.status).json({ success: false, message: g.message });

      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) {
        return res.status(400).json({ success: false, message: "Valid hours required" });
      }

      const until = new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
      const updated = User.setBanUntil(userId, until, req.user.id);

      res.json({ success: true, message: "User banned", data: updated });
    } catch (e) {
      console.error("Ban user error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to ban user" });
    }
  }

  static async clearBanUser(req, res) {
    try {
      const { userId } = req.params;

      const target = User.findById(userId);
      if (!target) return res.status(404).json({ success: false, message: "User not found" });
      if (target.role === "owner") return res.status(403).json({ success: false, message: "Cannot unban owner" });

      const lock = denyIfOwnerApplied(req.user, target, "ban");
      if (lock) return res.status(lock.status).json({ success: false, message: lock.message });

      const g = gate(req.user, target, "ban");
      if (!g.ok) return res.status(g.status).json({ success: false, message: g.message });

      const updated = User.setBanUntil(userId, null, req.user.id);
      res.json({ success: true, message: "Ban cleared", data: updated });
    } catch (e) {
      console.error("Clear ban error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to clear ban" });
    }
  }

  static async getSettings(req, res) {
    try {
      const settings = db.prepare("SELECT * FROM system_settings").all();
      const settingsObj = {};
      settings.forEach((s) => (settingsObj[s.setting_key] = s.setting_value));
      res.json({ success: true, data: settingsObj });
    } catch (error) {
      console.error("Get settings error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch settings" });
    }
  }

  static async updateSetting(req, res) {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ success: false, message: "Key and value required" });
      }

      const oldSetting = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = ?").get(key);
      const oldValue = oldSetting ? oldSetting.setting_value : null;

      db.prepare(
        `
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = CURRENT_TIMESTAMP
      `
      ).run(key, value);

      AuditService.logSettingChange(req.user.id, key, oldValue, value, req);

      res.json({ success: true, message: "Setting updated successfully", data: { key, value } });
    } catch (error) {
      console.error("Update setting error:", error);
      res.status(500).json({ success: false, message: "Failed to update setting" });
    }
  }

  static async getAllGames(req, res) {
    try {
      if (!canManageGames(req)) {
        return res.status(403).json({ success: false, message: "Not allowed to view/manage games" });
      }

      const games = Game.getAll(true);
      const gamesWithStats = games.map((game) => {
        const stats = Game.getStats(game.id, "24h");
        return { ...game, config: JSON.parse(game.config), stats };
      });

      res.json({ success: true, data: gamesWithStats });
    } catch (error) {
      console.error("Get all games error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch games" });
    }
  }

  static async setGameStatus(req, res) {
    try {
      const { gameId } = req.params;
      const { isEnabled } = req.body;

      if (typeof isEnabled !== "boolean") {
        return res.status(400).json({ success: false, message: "isEnabled must be a boolean" });
      }

      if (!canManageGames(req)) {
        return res.status(403).json({ success: false, message: "Not allowed to manage games" });
      }

      const game = Game.setEnabled(gameId, isEnabled, req.user.id);
      AuditService.logGameStatusChange(req.user.id, gameId, game.name, isEnabled, req);

      res.json({ success: true, message: `Game ${isEnabled ? "enabled" : "disabled"} successfully`, data: game });
    } catch (error) {
      console.error("Set game status error:", error);
      res.status(500).json({ success: false, message: "Failed to change game status" });
    }
  }

  static async setGameMobileStatus(req, res) {
    try {
      const { gameId } = req.params;
      const { isMobileEnabled } = req.body;

      if (typeof isMobileEnabled !== "boolean") {
        return res.status(400).json({ success: false, message: "isMobileEnabled must be a boolean" });
      }

      if (!canManageGames(req)) {
        return res.status(403).json({ success: false, message: "Not allowed to manage games" });
      }

      const game = Game.setMobileEnabled(gameId, isMobileEnabled, req.user.id);
      res.json({ success: true, message: `Game mobile ${isMobileEnabled ? "enabled" : "disabled"} successfully`, data: game });
    } catch (error) {
      console.error("Set game mobile status error:", error);
      res.status(500).json({ success: false, message: "Failed to change game mobile status" });
    }
  }

  static async getAllPages(req, res) {
    try {
      if (!canManagePages(req)) {
        return res.status(403).json({ success: false, message: "Not allowed to view/manage pages" });
      }

      const pages = db
        .prepare(`SELECT page_key, display_name, is_enabled, updated_at FROM pages ORDER BY page_key`)
        .all();
      res.json({ success: true, data: pages });
    } catch (e) {
      console.error("Get pages error:", e);
      res.status(500).json({ success: false, message: "Failed to fetch pages" });
    }
  }

  static async setPageStatus(req, res) {
    try {
      const { pageKey } = req.params;
      const { isEnabled } = req.body;

      if (typeof isEnabled !== "boolean") {
        return res.status(400).json({ success: false, message: "isEnabled must be boolean" });
      }

      if (!canManagePages(req)) {
        return res.status(403).json({ success: false, message: "Not allowed to manage pages" });
      }

      if (req.user.role === "admin" && pageKey === "admin") {
        return res.status(403).json({ success: false, message: "Admin cannot modify Admin Panel page" });
      }

      const existing = db.prepare(`SELECT page_key FROM pages WHERE page_key = ?`).get(pageKey);
      if (!existing) return res.status(404).json({ success: false, message: "Page not found" });

      db.prepare(`UPDATE pages SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE page_key = ?`).run(
        isEnabled ? 1 : 0,
        pageKey
      );

      db.prepare(`INSERT INTO audit_logs (user_id, action_type, action_details) VALUES (?, ?, ?)`).run(
        req.user.id,
        "PAGE_STATUS_CHANGED",
        JSON.stringify({ page_key: pageKey, is_enabled: isEnabled })
      );

      const updated = db
        .prepare(`SELECT page_key, display_name, is_enabled, updated_at FROM pages WHERE page_key = ?`)
        .get(pageKey);

      res.json({ success: true, message: "Page updated", data: updated });
    } catch (e) {
      console.error("Set page status error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to set page status" });
    }
  }

  static async resolveStockBets(req, res) {
    try {
      const StockService = require("../services/stockService");
      const result = await StockService.resolvePendingBets();
      res.json({ success: true, message: "Stock bet resolution complete", data: result });
    } catch (error) {
      console.error("Resolve stock bets error:", error);
      res.status(500).json({ success: false, message: "Failed to resolve stock bets" });
    }
  }

  static async cleanupOldData(req, res) {
    try {
      const days = parseInt(req.query.days) || 90;
      const roundsDeleted = Round.deleteOlderThan(days);
      const logsDeleted = AuditLog.deleteOlderThan(days > 90 ? days : 365);

      res.json({ success: true, message: "Cleanup complete", data: { roundsDeleted, logsDeleted } });
    } catch (error) {
      console.error("Cleanup error:", error);
      res.status(500).json({ success: false, message: "Failed to cleanup old data" });
    }
  }

  static async deleteUserHard(req, res) {
    try {
      const { userId } = req.params;
      const ok = User.hardDelete(userId, req.user.id);
      res.json({ success: true, message: "User deleted", data: { deleted: ok } });
    } catch (e) {
      console.error("Delete user error:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to delete user" });
    }
  }

  static async getAuditLogs(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      const actionType = req.query.actionType || null;

      const logs = AuditLog.getAll(limit, offset, actionType);
      const total = AuditLog.getCount(actionType);

      res.json({ success: true, data: { logs, total, limit, offset } });
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch audit logs" });
    }
  }

  static async searchAuditLogs(req, res) {
    try {
      const { q } = req.query;
      const limit = parseInt(req.query.limit) || 50;

      if (!q) return res.status(400).json({ success: false, message: "Search query required" });

      const logs = AuditLog.search(q, limit);
      res.json({ success: true, data: logs });
    } catch (error) {
      console.error("Search audit logs error:", error);
      res.status(500).json({ success: false, message: "Failed to search audit logs" });
    }
  }
}

module.exports = AdminController;