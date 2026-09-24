const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");
const { validateBody } = require("../middleware/validation");

/**
 * Authentication Routes
 */

// Register
router.post(
  "/register",
  validateBody({
    email: { required: true, type: "string" },
    password: { required: true, type: "string" },
    username: { required: true, type: "string" },
  }),
  AuthController.register
);

// Login
router.post(
  "/login",
  validateBody({
    email: { required: true, type: "string" },
    password: { required: true, type: "string" },
  }),
  AuthController.login
);

// Get current user
router.get("/me", authenticateToken, AuthController.getCurrentUser);

// Logout
router.post("/logout", authenticateToken, AuthController.logout);

// Verify token
router.get("/verify", authenticateToken, AuthController.verifyToken);

// Change password
router.post(
  "/change-password",
  authenticateToken,
  validateBody({
    currentPassword: { required: true, type: "string" },
    newPassword: { required: true, type: "string" },
  }),
  AuthController.changePassword
);

// Get user statistics
router.get("/stats", authenticateToken, AuthController.getUserStats);

module.exports = router;