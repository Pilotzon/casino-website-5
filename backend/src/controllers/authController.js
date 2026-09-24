const jwt = require("jsonwebtoken");
const User = require("../models/User");
const AuditService = require("../services/auditService");
const { validateEmail, validatePassword, validateUsername } = require("../middleware/validation");
const { db } = require("../config/database");

function isFutureDate(value) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function toUserPayload(u) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    balance: u.balance,
    role: u.role,
    is_active: u.is_active,
    can_bypass_disabled: Boolean(u.can_bypass_disabled),

    // existing perms
    can_manage_games: Boolean(u.can_manage_games),
    can_manage_pages: Boolean(u.can_manage_pages),
    can_adjust_others_balance: Boolean(u.can_adjust_others_balance),
    can_adjust_own_balance: Boolean(u.can_adjust_own_balance),

    // admin action perms
    can_change_roles: Boolean(u.can_change_roles),
    can_change_admin_roles: Boolean(u.can_change_admin_roles),
    can_timeout_users: Boolean(u.can_timeout_users),
    can_timeout_admins: Boolean(u.can_timeout_admins),
    can_ban_users: Boolean(u.can_ban_users),
    can_ban_admins: Boolean(u.can_ban_admins),
    can_deactivate_users: Boolean(u.can_deactivate_users),
    can_deactivate_admins: Boolean(u.can_deactivate_admins),
  };
}

class AuthController {
  static async register(req, res) {
    try {
      const { email, password, username } = req.body;

      const signupEnabled = db
        .prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'signup_enabled'")
        .get();

      if (signupEnabled && signupEnabled.setting_value === "false") {
        return res.status(403).json({ success: false, message: "Signup is currently disabled" });
      }

      if (!validateEmail(email)) return res.status(400).json({ success: false, message: "Invalid email address" });

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) return res.status(400).json({ success: false, message: passwordValidation.message });

      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) return res.status(400).json({ success: false, message: usernameValidation.message });

      const user = await User.create({ email, password, username });

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

      AuditService.logLogin(user.id, req);

      res.status(201).json({
        success: true,
        message: "Account created successfully",
        data: { token, user: toUserPayload(user) },
      });
    } catch (error) {
      if (error.message.includes("already")) return res.status(400).json({ success: false, message: error.message });
      console.error("Registration error:", error);
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  }

  static async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required" });
      }

      const user = await User.findByEmail(email);
      if (!user) {
        AuditService.logFailedLogin(email, "User not found", req);
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      const isValidPassword = await User.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        AuditService.logFailedLogin(email, "Invalid password", req);
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      if (!user.is_active) return res.status(403).json({ success: false, message: "Account is inactive. Please contact support." });

      if (isFutureDate(user.banned_until)) return res.status(403).json({ success: false, message: "Account is banned. Please contact support." });

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

      AuditService.logLogin(user.id, req);

      res.json({
        success: true,
        message: "Login successful",
        data: { token, user: toUserPayload(user) },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ success: false, message: "Login failed" });
    }
  }

  static async getCurrentUser(req, res) {
    try {
      const user = User.findById(req.user.id);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      if (isFutureDate(user.banned_until)) return res.status(403).json({ success: false, message: "Account is banned" });

      res.json({ success: true, data: toUserPayload(user) });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch user data" });
    }
  }

  static async logout(req, res) {
    try {
      AuditService.logLogout(req.user.id, req);
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ success: false, message: "Logout failed" });
    }
  }

  static async verifyToken(req, res) {
    try {
      const user = User.findById(req.user.id);

      if (!user || !user.is_active) return res.status(401).json({ success: false, message: "Invalid token" });
      if (isFutureDate(user.banned_until)) return res.status(403).json({ success: false, message: "Account is banned" });

      res.json({ success: true, data: { valid: true, user: toUserPayload(user) } });
    } catch {
      res.status(401).json({ success: false, message: "Invalid token" });
    }
  }

  static async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;

      if (req.user.role === "owner") {
        return res.status(403).json({
          success: false,
          message: "Owner password cannot be changed through the application",
        });
      }

      const user = await User.findByEmail(req.user.email);
      const isValid = await User.verifyPassword(currentPassword, user.password_hash);
      if (!isValid) return res.status(401).json({ success: false, message: "Current password is incorrect" });

      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.valid) return res.status(400).json({ success: false, message: passwordValidation.message });

      const bcrypt = require("bcrypt");
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newPasswordHash, req.user.id);
      AuditService.logPasswordChange(req.user.id, req);

      res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ success: false, message: "Failed to change password" });
    }
  }

  static async getUserStats(req, res) {
    try {
      const stats = User.getStats(req.user.id);
      const activitySummary = AuditService.getUserActivitySummary(req.user.id, 24);

      res.json({ success: true, data: { gaming: stats, activity: activitySummary } });
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch statistics" });
    }
  }
}

module.exports = AuthController;