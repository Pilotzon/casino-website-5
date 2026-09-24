const express = require("express");
const router = express.Router();
const AdminController = require("../controllers/adminController");
const { authenticateToken, requireAdmin, requireOwner } = require("../middleware/auth");

router.use(authenticateToken);

// Users
router.get("/users", requireAdmin, AdminController.getAllUsers);
router.get("/users/:userId", requireAdmin, AdminController.getUserDetails);

router.post("/users/:userId/adjust-balance", requireAdmin, AdminController.adjustBalance);
router.post("/users/:userId/role", requireAdmin, AdminController.changeUserRole);
router.post("/users/:userId/status", requireAdmin, AdminController.setUserStatus);

// Owner-only permissions
router.post("/users/:userId/bypass-disabled", requireOwner, AdminController.setBypassDisabled);
router.post("/users/:userId/admin-permissions", requireOwner, AdminController.setAdminPermissions);
router.post("/users/:userId/admin-access", requireOwner, AdminController.setAdminActionPermissions);

// ✅ NEW: owner-only custom bet permissions for admins
router.post("/users/:userId/custom-bets-permissions", requireOwner, AdminController.setAdminCustomBetsPermissions);

// timeout
router.post("/users/:userId/timeout", requireAdmin, AdminController.timeoutUser);
router.post("/users/:userId/timeout/clear", requireAdmin, AdminController.clearTimeoutUser);

// ✅ ban/unban (NOT owner-only)
router.post("/users/:userId/ban", requireAdmin, AdminController.banUser);
router.post("/users/:userId/ban/clear", requireAdmin, AdminController.clearBanUser);

// delete
router.delete("/users/:userId", requireOwner, AdminController.deleteUserHard);

// Audit
router.get("/audit-logs", requireAdmin, AdminController.getAuditLogs);
router.get("/audit-logs/search", requireAdmin, AdminController.searchAuditLogs);

// Settings (owner)
router.get("/settings", requireOwner, AdminController.getSettings);
router.post("/settings", requireOwner, AdminController.updateSetting);

// Games visible to permitted admins too (permission enforced in controller)
router.get("/games", requireAdmin, AdminController.getAllGames);
router.post("/games/:gameId/status", requireAdmin, AdminController.setGameStatus);
router.post("/games/:gameId/mobile-status", requireAdmin, AdminController.setGameMobileStatus);

// Pages visible to permitted admins too (permission enforced in controller)
router.get("/pages", requireAdmin, AdminController.getAllPages);
router.post("/pages/:pageKey/status", requireAdmin, AdminController.setPageStatus);


// Cleanup (owner only)
router.post("/cleanup", requireOwner, AdminController.cleanupOldData);

module.exports = router;