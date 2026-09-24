const express = require("express");
const router = express.Router();
const PagesController = require("../controllers/pagesController");
const { optionalAuth } = require("../middleware/auth");

router.get("/", optionalAuth, PagesController.getPages);
// public site status: sign-up availability + maintenance (betting) mode
router.get("/status", PagesController.getSiteStatus);

module.exports = router;