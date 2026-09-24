const User = require('../models/User');
const Round = require('../models/Round');
const Stock = require('../models/Stock');
const CustomBet = require('../models/CustomBet');
const AuditLog = require('../models/AuditLog');

/**
 * Dashboard Controller
 */
class DashboardController {
  
  /**
   * Get user dashboard statistics
   */
  static async getUserDashboard(req, res) {
    try {
      const timeframe = req.query.timeframe || '24h';

      // Get gaming statistics
      const gameStats = Round.getUserStats(req.user.id, timeframe);
      
      // Get stock betting statistics
      const stockStats = Stock.getStats(req.user.id, timeframe);
      
      // Get custom bet statistics
      const customBetStats = CustomBet.getCreatorStats(req.user.id);
      
      // Get user balance
      const user = User.findById(req.user.id);
      
      // Get game breakdown
      const gameBreakdown = Round.getGameBreakdown(req.user.id, timeframe);
      
      // Get recent activity
      const recentRounds = Round.getUserRounds(req.user.id, 10);
      const recentStockBets = Stock.getUserBets(req.user.id, null, 10);
      const recentCustomBets = CustomBet.getUserParticipations(req.user.id, 10);

      res.json({
        success: true,
        data: {
          balance: user.balance,
          timeframe,
          gaming: gameStats,
          stocks: stockStats,
          customBets: customBetStats,
          gameBreakdown,
          recentActivity: {
            rounds: recentRounds,
            stockBets: recentStockBets,
            customBets: recentCustomBets
          }
        }
      });
    } catch (error) {
      console.error('Get user dashboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard data'
      });
    }
  }

  /**
   * Get platform-wide statistics (admin/owner)
   */
  static async getPlatformStats(req, res) {
    try {
      const timeframe = req.query.timeframe || '24h';

      // Get overall platform statistics
      const platformStats = Round.getPlatformStats(timeframe);
      
      // Get stock betting statistics
      const stockStats = Stock.getStats(null, timeframe);
      
      // Get user count
      const totalUsers = User.getCount();
      
      // Get audit log statistics
      const auditStats = AuditLog.getActionStats(
        timeframe === 'all' ? 168 : parseInt(timeframe.replace('h', ''))
      );

      res.json({
        success: true,
        data: {
          timeframe,
          totalUsers,
          gaming: platformStats,
          stocks: stockStats,
          auditActivity: auditStats
        }
      });
    } catch (error) {
      console.error('Get platform stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch platform statistics'
      });
    }
  }

  /**
   * Get user statistics by timeframe
   */
  static async getStatsByTimeframe(req, res) {
    try {
      const { timeframe } = req.params;

      const validTimeframes = ['24h', '7d', '30d', 'all'];
      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid timeframe. Use: 24h, 7d, 30d, or all'
        });
      }

      // Convert days to hours
      const timeframeHours = {
        '24h': '24h',
        '7d': (7 * 24) + 'h',
        '30d': (30 * 24) + 'h',
        'all': 'all'
      }[timeframe];

      const stats = Round.getUserStats(req.user.id, timeframeHours);

      res.json({
        success: true,
        data: {
          timeframe,
          stats
        }
      });
    } catch (error) {
      console.error('Get stats by timeframe error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch statistics'
      });
    }
  }

  /**
   * Get leaderboard
   */
  static async getLeaderboard(req, res) {
    try {
      const type = req.query.type || 'profit'; // profit, wagered, rounds
      const timeframe = req.query.timeframe || '24h';
      const limit = parseInt(req.query.limit) || 10;

      let query = '';
      const hours = timeframe === 'all' ? 0 : parseInt(timeframe.replace('h', '') || timeframe.replace('d', '') * 24);

      switch (type) {
        case 'profit':
          query = `
            SELECT 
              u.username,
              SUM(r.payout_amount - r.bet_amount) as total_profit,
              COUNT(*) as total_rounds
            FROM rounds r
            JOIN users u ON r.user_id = u.id
            ${hours > 0 ? `WHERE r.created_at >= datetime('now', '-${hours} hours')` : ''}
            GROUP BY u.id, u.username
            ORDER BY total_profit DESC
            LIMIT ?
          `;
          break;
        
        case 'wagered':
          query = `
            SELECT 
              u.username,
              SUM(r.bet_amount) as total_wagered,
              COUNT(*) as total_rounds
            FROM rounds r
            JOIN users u ON r.user_id = u.id
            ${hours > 0 ? `WHERE r.created_at >= datetime('now', '-${hours} hours')` : ''}
            GROUP BY u.id, u.username
            ORDER BY total_wagered DESC
            LIMIT ?
          `;
          break;
        
        case 'rounds':
          query = `
            SELECT 
              u.username,
              COUNT(*) as total_rounds,
              SUM(r.bet_amount) as total_wagered
            FROM rounds r
            JOIN users u ON r.user_id = u.id
            ${hours > 0 ? `WHERE r.created_at >= datetime('now', '-${hours} hours')` : ''}
            GROUP BY u.id, u.username
            ORDER BY total_rounds DESC
            LIMIT ?
          `;
          break;
        
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid leaderboard type'
          });
      }

      const { db } = require('../config/database');
      const leaderboard = db.prepare(query).all(limit);

      res.json({
        success: true,
        data: {
          type,
          timeframe,
          leaderboard
        }
      });
    } catch (error) {
      console.error('Get leaderboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard'
      });
    }
  }

  /**
   * Get recent platform activity
   */
  static async getRecentActivity(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;

      const recentRounds = Round.getRecentRounds(limit);

      res.json({
        success: true,
        data: recentRounds
      });
    } catch (error) {
      console.error('Get recent activity error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch recent activity'
      });
    }
  }

  /**
   * Get user's biggest wins
   */
  static async getBiggestWins(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 10;

      const { db } = require('../config/database');
      const biggestWins = db.prepare(`
        SELECT 
          r.id,
          r.bet_amount,
          r.payout_amount,
          r.payout_amount - r.bet_amount as profit,
          r.multiplier,
          r.created_at,
          g.display_name as game_name
        FROM rounds r
        JOIN games g ON r.game_id = g.id
        WHERE r.user_id = ?
        AND r.payout_amount > r.bet_amount
        ORDER BY profit DESC
        LIMIT ?
      `).all(req.user.id, limit);

      res.json({
        success: true,
        data: biggestWins
      });
    } catch (error) {
      console.error('Get biggest wins error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch biggest wins'
      });
    }
  }

  /**
   * Get user activity timeline
   */
  static async getActivityTimeline(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const { db } = require('../config/database');

      // Get hourly activity
      const timeline = db.prepare(`
        SELECT 
          strftime('%Y-%m-%d %H:00:00', created_at) as hour,
          COUNT(*) as bet_count,
          SUM(bet_amount) as total_wagered,
          SUM(payout_amount - bet_amount) as total_profit
        FROM rounds
        WHERE user_id = ?
        AND created_at >= datetime('now', '-${hours} hours')
        GROUP BY hour
        ORDER BY hour ASC
      `).all(req.user.id);

      res.json({
        success: true,
        data: timeline
      });
    } catch (error) {
      console.error('Get activity timeline error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch activity timeline'
      });
    }
  }

  /**
   * Get profit chart data
   */
  static async getProfitChart(req, res) {
    try {
      const timeframe = req.query.timeframe || '24h';
      const { db } = require('../config/database');

      const hours = timeframe === 'all' ? 0 : parseInt(timeframe.replace('h', '') || timeframe.replace('d', '') * 24);

      const profitData = db.prepare(`
        SELECT 
          datetime(created_at) as timestamp,
          bet_amount,
          payout_amount,
          payout_amount - bet_amount as profit,
          SUM(payout_amount - bet_amount) OVER (ORDER BY created_at) as cumulative_profit
        FROM rounds
        WHERE user_id = ?
        ${hours > 0 ? `AND created_at >= datetime('now', '-${hours} hours')` : ''}
        ORDER BY created_at ASC
      `).all(req.user.id);

      res.json({
        success: true,
        data: profitData
      });
    } catch (error) {
      console.error('Get profit chart error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch profit chart data'
      });
    }
  }

  /**
   * Export user data
   */
  static async exportUserData(req, res) {
    try {
      const format = req.query.format || 'json';

      const userData = {
        profile: User.findById(req.user.id),
        stats: User.getStats(req.user.id),
        rounds: Round.getUserRounds(req.user.id, 1000),
        stockBets: Stock.getUserBets(req.user.id, null, 1000),
        customBets: {
          created: CustomBet.getUserBets(req.user.id, 1000),
          participated: CustomBet.getUserParticipations(req.user.id, 1000)
        }
      };

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="user-data.json"');
        res.json(userData);
      } else {
        res.status(400).json({
          success: false,
          message: 'Unsupported format'
        });
      }
    } catch (error) {
      console.error('Export user data error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export data'
      });
    }
  }
}

module.exports = DashboardController;