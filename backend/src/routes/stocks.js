const express = require('express');
const router = express.Router();
const StocksController = require('../controllers/stocksController');
const { authenticateToken, optionalAuth, userRateLimit } = require('../middleware/auth');

/**
 * Stocks Routes
 */

// Get stock price
router.get('/price/:symbol', optionalAuth, StocksController.getStockPrice);

// Get chart data
router.get('/chart/:symbol', optionalAuth, StocksController.getChartData);

// Search stocks
router.get('/search', optionalAuth, StocksController.searchStocks);

// Get popular symbols
router.get('/popular', optionalAuth, StocksController.getPopularSymbols);

// Get popular trading symbols (from recent bets)
router.get('/popular-trading', optionalAuth, StocksController.getPopularTradingSymbols);

// Validate symbol
router.get('/validate/:symbol', optionalAuth, StocksController.validateSymbol);

// Get market status
router.get('/market/status', optionalAuth, StocksController.getMarketStatus);

// Place stock bet (requires authentication)
router.post('/bet', 
  authenticateToken,
  userRateLimit(50, 60000),
  StocksController.placeBet
);

// Get user's stock bets
router.get('/bets/user', authenticateToken, StocksController.getUserBets);

// Get active bet updates
router.get('/bets/updates', authenticateToken, StocksController.getActiveBetUpdates);

// Get stock statistics
router.get('/stats', authenticateToken, StocksController.getStockStats);

// Get all active bets (for browsing)
router.get('/bets/active', optionalAuth, StocksController.getAllActiveBets);

module.exports = router;