const express = require("express");
const router = express.Router();

const CustomBetsController = require("../controllers/customBetsController");
const {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  requireNotTimedOut,
  userRateLimit,
} = require("../middleware/auth");
const { requireNotMaintenance } = require("../middleware/maintenance");
const { upload } = require("../middleware/upload");

function requireCanCloseCustomBets(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.user.role === "owner") return next();
  if (req.user.role === "admin" && Boolean(req.user.can_close_custom_bets)) return next();
  return res.status(403).json({ success: false, message: "Not allowed to close custom bets" });
}

function requireCanRemoveCustomBets(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.user.role === "owner") return next();
  if (req.user.role === "admin" && Boolean(req.user.can_remove_custom_bets)) return next();
  return res.status(403).json({ success: false, message: "Not allowed to remove custom bets" });
}

router.get("/", optionalAuth, CustomBetsController.list);
router.get("/:betId", optionalAuth, CustomBetsController.getOne);

router.get("/:betId/graph", optionalAuth, CustomBetsController.graph);
router.get("/:betId/graph-market", optionalAuth, CustomBetsController.graphMarket);

// Comments
router.get("/:betId/comments", optionalAuth, CustomBetsController.listComments);
router.post(
  "/:betId/comments",
  authenticateToken,
  userRateLimit(60, 60000),
  CustomBetsController.addComment
);

router.post(
  "/:betId/comments/:commentId/reply",
  authenticateToken,
  userRateLimit(60, 60000),
  CustomBetsController.replyToComment
);

router.post(
  "/:betId/comments/:commentId/like",
  authenticateToken,
  userRateLimit(120, 60000),
  CustomBetsController.toggleCommentLike
);

router.put(
  "/comments/:commentId",
  authenticateToken,
  userRateLimit(60, 60000),
  CustomBetsController.editComment
);

router.delete(
  "/comments/:commentId",
  authenticateToken,
  userRateLimit(60, 60000),
  CustomBetsController.deleteComment
);

router.post(
  "/",
  authenticateToken,
  requireNotTimedOut,
  userRateLimit(30, 60000),
  upload.single("image"),
  CustomBetsController.create
);

router.post(
  "/:betId/buy",
  authenticateToken,
  requireNotMaintenance,
  requireNotTimedOut,
  userRateLimit(60, 60000),
  CustomBetsController.placeBet
);

router.post("/:betId/close", authenticateToken, requireCanCloseCustomBets, CustomBetsController.adminClose);
router.post("/:betId/reopen", authenticateToken, requireCanCloseCustomBets, CustomBetsController.adminReopen);
router.post(
  "/:betId/extend-end",
  authenticateToken,
  requireCanCloseCustomBets,
  CustomBetsController.adminExtendEndAt
);

router.post("/:betId/resolve", authenticateToken, requireAdmin, CustomBetsController.adminResolve);
router.delete("/:betId", authenticateToken, requireCanRemoveCustomBets, CustomBetsController.adminRemove);

module.exports = router;