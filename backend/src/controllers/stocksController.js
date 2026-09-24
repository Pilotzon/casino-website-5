const StockService = require('../services/stockService');
const Stock = require('../models/Stock');
const User = require('../models/User');
const AuditService = require('../services/auditService');
const { validateBetAmount } = require('../middleware/validation');

/**
 * Stocks Controller
 */
class StocksController {
  
  /**
   * Get stock price
   */
  static async getStockPrice(req, res) {
    try {
      const { symbol } = req.params;

      const stockData = await StockService.getStockPrice(symbol);

      res.json({
        success: true,
        data: stockData
      });
    } catch (error) {
      console.error('Get stock price error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch stock price'
      });
    }
  }

  /**
   * Get stock chart data
   */
  static async getChartData(req, res) {
    try {
      const { symbol } = req.params;
      const { timeframe = '5min' } = req.query;

      const chartData = await StockService.getChartData(symbol, timeframe);

      res.json({
        success: true,
        data: chartData
      });
    } catch (error) {
      console.error('Get chart data error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch chart data'
      });
    }
  }

  /**
   * Search stocks
   */
  static async searchStocks(req, res) {
    try {
      const { q } = req.query;

      if (!q || q.length < 1) {
        return res.status(400).json({
          success: false,
          message: 'Search query required'
        });
      }

      const results = await StockService.searchStocks(q);

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      console.error('Search stocks error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to search stocks'
      });
    }
  }

  /**
   * Get popular symbols
   */
  static async getPopularSymbols(req, res) {
    try {
      const symbols = StockService.getPopularSymbols();

      res.json({
        success: true,
        data: symbols
      });
    } catch (error) {
      console.error('Get popular symbols error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch popular symbols'
      });
    }
  }

  /**
   * Place stock bet
   */
  static async placeBet(req, res) {
    try {
      const { symbol, direction, betAmount, timeframe = '5min' } = req.body;

      // Validate bet amount
      const validation = validateBetAmount(betAmount);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message
        });
      }

      // Validate direction
      if (!['up', 'down'].includes(direction)) {
        return res.status(400).json({
          success: false,
          message: 'Direction must be "up" or "down"'
        });
      }

      // Validate timeframe
      if (!['5min', '15min', '30min', '1hour'].includes(timeframe)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid timeframe'
        });
      }

      // Get current stock price
      const stockData = await StockService.getStockPrice(symbol);
      const entryPrice = stockData.currentPrice;

      // Deduct bet amount
      User.updateBalance(req.user.id, -betAmount, `Stock bet placed: ${symbol}`);

      // Create bet
      const bet = Stock.create({
        userId: req.user.id,
        symbol,
        direction,
        entryPrice,
        betAmount,
        timeframe
      });

      // Log the bet
      AuditService.logStockBetPlaced(
        req.user.id,
        symbol,
        direction,
        entryPrice,
        betAmount,
        timeframe,
        req
      );

      res.json({
        success: true,
        message: 'Stock bet placed successfully',
        data: bet
      });
    } catch (error) {
      console.error('Place stock bet error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to place bet'
      });
    }
  }

  /**
   * Get user's stock bets
   */
  static async getUserBets(req, res) {
    try {
      const { status } = req.query;
      const limit = parseInt(req.query.limit) || 50;

      const bets = Stock.getUserBets(req.user.id, status, limit);

      res.json({
        success: true,
        data: bets
      });
    } catch (error) {
      console.error('Get user bets error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bets'
      });
    }
  }

  /**
   * Get active bets with live updates
   */
  static async getActiveBetUpdates(req, res) {
    try {
      const updates = await StockService.getActiveBetUpdates(req.user.id);

      res.json({
        success: true,
        data: updates
      });
    } catch (error) {
      console.error('Get active bet updates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bet updates'
      });
    }
  }

  /**
   * Get stock bet statistics
   */
  static async getStockStats(req, res) {
    try {
      const timeframe = req.query.timeframe || '24h';
      const stats = Stock.getStats(req.user.id, timeframe);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get stock stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch statistics'
      });
    }
  }

  /**
   * Get all active stock bets (for browsing)
   */
  static async getAllActiveBets(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const bets = Stock.getActiveBets(limit);

      res.json({
        success: true,
        data: bets
      });
    } catch (error) {
      console.error('Get all active bets error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch active bets'
      });
    }
  }

  /**
   * Get market status
   */
  static async getMarketStatus(req, res) {
    try {
      const status = await StockService.getMarketStatus();

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error('Get market status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch market status'
      });
    }
  }

  /**
   * Manually resolve bet (admin only)
   */
  static async resolveBet(req, res) {
    try {
      const { betId, exitPrice } = req.body;

      if (!exitPrice || exitPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid exit price required'
        });
      }

      const bet = Stock.resolve(betId, exitPrice);

      res.json({
        success: true,
        message: 'Bet resolved successfully',
        data: bet
      });
    } catch (error) {
      console.error('Resolve bet error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to resolve bet'
      });
    }
  }

  /**
   * Get popular trading symbols from recent bets
   */
  static async getPopularTradingSymbols(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const limit = parseInt(req.query.limit) || 10;

      const symbols = Stock.getPopularSymbols(limit, hours);

      res.json({
        success: true,
        data: symbols
      });
    } catch (error) {
      console.error('Get popular trading symbols error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch popular symbols'
      });
    }
  }

  /**
   * Validate stock symbol
   */
  static async validateSymbol(req, res) {
    try {
      const { symbol } = req.params;

      const validation = await StockService.validateSymbol(symbol);

      res.json({
        success: true,
        data: validation
      });
    } catch (error) {
      console.error('Validate symbol error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to validate symbol'
      });
    }
  }
}

module.exports = StocksController;