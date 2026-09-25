const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboardController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * Dashboard Routes
 */

// Get user dashboard
router.get('/', authenticateToken, DashboardController.getUserDashboard);

// Today's profit / wagered + the 3 latest bets (navbar balance box).
// ?since=<ISO local midnight> so "today" follows the player's timezone.
router.get('/today', authenticateToken, DashboardController.getTodaySummary);

// Get statistics by timeframe
router.get('/stats/:timeframe', authenticateToken, DashboardController.getStatsByTimeframe);

// Get leaderboard
router.get('/leaderboard', authenticateToken, DashboardController.getLeaderboard);

// Get recent activity
router.get('/activity/recent', authenticateToken, DashboardController.getRecentActivity);

// Get biggest wins
router.get('/wins/biggest', authenticateToken, DashboardController.getBiggestWins);

// Get activity timeline
router.get('/activity/timeline', authenticateToken, DashboardController.getActivityTimeline);

// Get profit chart data
router.get('/profit/chart', authenticateToken, DashboardController.getProfitChart);

// Export user data
router.get('/export', authenticateToken, DashboardController.exportUserData);

// Platform statistics (admin only)
router.get('/platform/stats', requireAdmin, DashboardController.getPlatformStats);

module.exports = router;