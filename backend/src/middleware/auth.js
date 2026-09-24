const jwt = require("jsonwebtoken");
const { db } = require("../config/database");

function isFutureDate(value) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ success: false, message: "Access token required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = db
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
             can_close_custom_bets, can_remove_custom_bets
      FROM users
      WHERE id = ?
    `
      )
      .get(decoded.userId);

    if (!user) return res.status(403).json({ success: false, message: "User not found" });
    if (!user.is_active) return res.status(403).json({ success: false, message: "Account is inactive" });

    if (isFutureDate(user.banned_until)) {
      return res.status(403).json({ success: false, message: "Account is banned" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") return res.status(401).json({ success: false, message: "Token expired" });
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = db
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
             can_close_custom_bets, can_remove_custom_bets
      FROM users
      WHERE id = ?
    `
      )
      .get(decoded.userId);

    if (user && user.is_active && !isFutureDate(user.banned_until)) req.user = user;
    else req.user = null;
  } catch {
    req.user = null;
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.user.role !== "admin" && req.user.role !== "owner") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.user.role !== "owner") return res.status(403).json({ success: false, message: "Owner access required" });
  next();
}

function requireNotTimedOut(req, res, next) {
  if (!req.user) return next();
  if (isFutureDate(req.user.timed_out_until)) {
    return res.status(403).json({ success: false, message: "You are timed out and cannot bet right now" });
  }
  next();
}

const userRateLimitMap = new Map();
function userRateLimit(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    if (!req.user) return next();

    const userId = req.user.id;
    const now = Date.now();

    if (!userRateLimitMap.has(userId)) userRateLimitMap.set(userId, []);

    const userRequests = userRateLimitMap.get(userId);
    const validRequests = userRequests.filter((timestamp) => now - timestamp < windowMs);

    if (validRequests.length >= maxRequests) {
      return res.status(429).json({ success: false, message: "Too many requests, please slow down" });
    }

    validRequests.push(now);
    userRateLimitMap.set(userId, validRequests);

    if (Math.random() < 0.01) {
      for (const [key, value] of userRateLimitMap.entries()) {
        if (value.length === 0 || now - value[value.length - 1] > windowMs * 2) {
          userRateLimitMap.delete(key);
        }
      }
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  requireOwner,
  requireNotTimedOut,
  userRateLimit,
};