const fetch = require('node-fetch');
const Stock = require('../models/Stock');

/**
 * Stock Service
 * Handles stock price fetching and bet resolution
 */
class StockService {
  
  /**
   * Get current stock price from Finnhub API
   */
  static async getStockPrice(symbol) {
    const apiKey = process.env.FINNHUB_API_KEY;
    
    if (!apiKey || apiKey === 'your-finnhub-api-key-here') {
      throw new Error('Finnhub API key not configured. Please add FINNHUB_API_KEY to your .env file.');
    }

    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol.toUpperCase()}&token=${apiKey}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch stock price');
      }

      const data = await response.json();

      // Finnhub returns { c: current_price, h: high, l: low, o: open, pc: previous_close, t: timestamp }
      if (!data.c || data.c === 0) {
        throw new Error('Invalid stock symbol or market closed');
      }

      return {
        symbol: symbol.toUpperCase(),
        currentPrice: data.c,
        high: data.h,
        low: data.l,
        open: data.o,
        previousClose: data.pc,
        timestamp: data.t,
        change: data.c - data.pc,
        changePercent: ((data.c - data.pc) / data.pc) * 100
      };
    } catch (error) {
      console.error('Stock API error:', error);
      throw new Error('Unable to fetch stock price. Please try again later.');
    }
  }

  /**
   * Get historical stock data (for charts)
   */
  static async getStockCandles(symbol, resolution = '5', from, to) {
    const apiKey = process.env.FINNHUB_API_KEY;
    
    if (!apiKey || apiKey === 'your-finnhub-api-key-here') {
      throw new Error('Finnhub API key not configured');
    }

    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=${symbol.toUpperCase()}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch stock candles');
      }

      const data = await response.json();

      if (data.s !== 'ok') {
        throw new Error('No data available for this timeframe');
      }

      // Transform to chart-friendly format
      const candles = data.t.map((timestamp, index) => ({
        timestamp,
        open: data.o[index],
        high: data.h[index],
        low: data.l[index],
        close: data.c[index],
        volume: data.v[index]
      }));

      return candles;
    } catch (error) {
      console.error('Stock candles API error:', error);
      throw new Error('Unable to fetch stock chart data');
    }
  }

  /**
   * Search for stocks
   */
  static async searchStocks(query) {
    const apiKey = process.env.FINNHUB_API_KEY;
    
    if (!apiKey || apiKey === 'your-finnhub-api-key-here') {
      throw new Error('Finnhub API key not configured');
    }

    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${apiKey}`
      );

      if (!response.ok) {
        throw new Error('Failed to search stocks');
      }

      const data = await response.json();

      // Return top 10 results
      return data.result.slice(0, 10).map(stock => ({
        symbol: stock.symbol,
        description: stock.description,
        type: stock.type
      }));
    } catch (error) {
      console.error('Stock search API error:', error);
      throw new Error('Unable to search stocks');
    }
  }

  /**
   * Get popular stock symbols
   */
  static getPopularSymbols() {
    return [
      { symbol: 'AAPL', name: 'Apple Inc.' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.' },
      { symbol: 'MSFT', name: 'Microsoft Corporation' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.' },
      { symbol: 'TSLA', name: 'Tesla Inc.' },
      { symbol: 'META', name: 'Meta Platforms Inc.' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
      { symbol: 'V', name: 'Visa Inc.' },
      { symbol: 'WMT', name: 'Walmart Inc.' }
    ];
  }

  /**
   * Resolve pending stock bets
   * This should be called periodically (e.g., every minute)
   */
  static async resolvePendingBets() {
    const pendingBets = Stock.getPendingBets();
    let resolvedCount = 0;

    for (const bet of pendingBets) {
      try {
        // Get current price
        const stockData = await this.getStockPrice(bet.symbol);
        
        // Resolve the bet
        Stock.resolve(bet.id, stockData.currentPrice);
        resolvedCount++;

        // Small delay to avoid hitting API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Failed to resolve bet ${bet.id}:`, error);
        // Continue with other bets
      }
    }

    return {
      totalPending: pendingBets.length,
      resolved: resolvedCount,
      failed: pendingBets.length - resolvedCount
    };
  }

  /**
   * Validate stock symbol
   */
  static async validateSymbol(symbol) {
    try {
      const data = await this.getStockPrice(symbol);
      return {
        valid: true,
        data
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate timeframe in seconds
   */
  static getTimeframeSeconds(timeframe) {
    const timeframes = {
      '5min': 5 * 60,
      '15min': 15 * 60,
      '30min': 30 * 60,
      '1hour': 60 * 60
    };

    return timeframes[timeframe] || 5 * 60;
  }

  /**
   * Get chart data for a timeframe
   */
  static async getChartData(symbol, timeframe = '5min') {
    const now = Math.floor(Date.now() / 1000);
    const hoursBack = {
      '5min': 2,
      '15min': 6,
      '30min': 12,
      '1hour': 24
    }[timeframe] || 2;

    const from = now - (hoursBack * 60 * 60);
    const resolution = {
      '5min': '5',
      '15min': '15',
      '30min': '30',
      '1hour': '60'
    }[timeframe] || '5';

    try {
      const candles = await this.getStockCandles(symbol, resolution, from, now);
      
      return {
        symbol,
        timeframe,
        data: candles,
        currentPrice: candles[candles.length - 1]?.close || 0
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get market status
   */
  static async getMarketStatus() {
    // US market hours: 9:30 AM - 4:00 PM EST (Mon-Fri)
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    
    // Simple check - this doesn't account for holidays
    const isWeekday = day >= 1 && day <= 5;
    const isDuringMarketHours = hour >= 14 && hour < 21; // Approximate EST in UTC

    return {
      isOpen: isWeekday && isDuringMarketHours,
      day,
      hour,
      message: isWeekday && isDuringMarketHours 
        ? 'Market is open' 
        : 'Market is closed. Prices may be delayed.'
    };
  }

  /**
   * Get live updates for active bets
   */
  static async getActiveBetUpdates(userId) {
    const activeBets = Stock.getUserBets(userId, 'pending');
    const updates = [];

    for (const bet of activeBets) {
      try {
        const stockData = await this.getStockPrice(bet.symbol);
        
        const currentChange = stockData.currentPrice - bet.entry_price;
        const currentChangePercent = (currentChange / bet.entry_price) * 100;
        
        const isWinning = 
          (bet.direction === 'up' && currentChange > 0) ||
          (bet.direction === 'down' && currentChange < 0);

        const timeRemaining = new Date(bet.expires_at) - new Date();

        updates.push({
          betId: bet.id,
          symbol: bet.symbol,
          direction: bet.direction,
          entryPrice: bet.entry_price,
          currentPrice: stockData.currentPrice,
          change: currentChange,
          changePercent: currentChangePercent,
          isWinning,
          timeRemaining: Math.max(0, timeRemaining),
          expiresAt: bet.expires_at
        });

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Failed to get updates for bet ${bet.id}:`, error);
      }
    }

    return updates;
  }
}

module.exports = StockService;