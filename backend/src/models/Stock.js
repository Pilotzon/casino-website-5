const { db } = require('../config/database');

class Stock {
  /**
   * Create a new stock bet
   */
  static create({ userId, symbol, direction, entryPrice, betAmount, timeframe }) {
    // Calculate expiration time
    const timeframeMinutes = {
      '5min': 5,
      '15min': 15,
      '30min': 30,
      '1hour': 60
    };

    const minutes = timeframeMinutes[timeframe] || 5;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const result = db.prepare(`
      INSERT INTO stock_bets (
        user_id, symbol, direction, entry_price, 
        bet_amount, timeframe, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, symbol.toUpperCase(), direction, entryPrice, betAmount, timeframe, expiresAt);

    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find stock bet by ID
   */
  static findById(id) {
    return db.prepare(`
      SELECT 
        sb.*,
        u.username
      FROM stock_bets sb
      JOIN users u ON sb.user_id = u.id
      WHERE sb.id = ?
    `).get(id);
  }

  /**
   * Get user's stock bets
   */
  static getUserBets(userId, status = null, limit = 50) {
    let query = `
      SELECT * FROM stock_bets
      WHERE user_id = ?
    `;

    const params = [userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
  }

  /**
   * Get pending stock bets (to be resolved)
   */
  static getPendingBets() {
    return db.prepare(`
      SELECT * FROM stock_bets
      WHERE status = 'pending'
      AND expires_at <= datetime('now')
      ORDER BY expires_at ASC
    `).all();
  }

  /**
   * Resolve stock bet
   */
  static resolve(betId, exitPrice) {
    const bet = this.findById(betId);
    if (!bet) {
      throw new Error('Bet not found');
    }

    if (bet.status !== 'pending') {
      throw new Error('Bet already resolved');
    }

    // Determine if bet won
    const priceChange = exitPrice - bet.entry_price;
    let won = false;

    if (bet.direction === 'up' && priceChange > 0) {
      won = true;
    } else if (bet.direction === 'down' && priceChange < 0) {
      won = true;
    }

    const status = won ? 'won' : 'lost';
    const payoutMultiplier = 1.85; // Fixed payout multiplier
    const payoutAmount = won ? bet.bet_amount * payoutMultiplier : 0;

    // Update bet
    db.prepare(`
      UPDATE stock_bets
      SET 
        exit_price = ?,
        status = ?,
        payout_amount = ?,
        resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(exitPrice, status, payoutAmount, betId);

    // Update user balance if won
    if (won) {
      db.prepare(`
        UPDATE users
        SET balance = balance + ?
        WHERE id = ?
      `).run(payoutAmount, bet.user_id);

      // Log the payout
      db.prepare(`
        INSERT INTO audit_logs (user_id, action_type, action_details)
        VALUES (?, ?, ?)
      `).run(bet.user_id, 'BET_RESOLVED', JSON.stringify({
        bet_type: 'stock',
        bet_id: betId,
        symbol: bet.symbol,
        won: true,
        payout: payoutAmount
      }));
    }

    return this.findById(betId);
  }

  /**
   * Get all active stock bets
   */
  static getActiveBets(limit = 100) {
    return db.prepare(`
      SELECT 
        sb.*,
        u.username
      FROM stock_bets sb
      JOIN users u ON sb.user_id = u.id
      WHERE sb.status = 'pending'
      ORDER BY sb.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Get stock bet statistics
   */
  static getStats(userId = null, timeframe = '24h') {
    let whereClause = "WHERE sb.status != 'pending'";
    const params = [];

    if (userId) {
      whereClause += ' AND sb.user_id = ?';
      params.push(userId);
    }

    if (timeframe !== 'all') {
      const hours = parseInt(timeframe.replace('h', ''));
      whereClause += ` AND sb.created_at >= datetime('now', '-${hours} hours')`;
    }

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_bets,
        SUM(bet_amount) as total_wagered,
        SUM(payout_amount) as total_payout,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as losses
      FROM stock_bets sb
      ${whereClause}
    `).get(...params);

    return {
      total_bets: stats.total_bets || 0,
      total_wagered: stats.total_wagered || 0,
      total_payout: stats.total_payout || 0,
      wins: stats.wins || 0,
      losses: stats.losses || 0,
      win_rate: stats.total_bets > 0 ? ((stats.wins / stats.total_bets) * 100).toFixed(2) : 0
    };
  }

  /**
   * Get popular symbols
   */
  static getPopularSymbols(limit = 10, hours = 24) {
    return db.prepare(`
      SELECT 
        symbol,
        COUNT(*) as bet_count,
        SUM(bet_amount) as total_volume
      FROM stock_bets
      WHERE created_at >= datetime('now', '-${hours} hours')
      GROUP BY symbol
      ORDER BY bet_count DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Cancel expired unresolved bets (refund)
   */
  static cancelExpired() {
    // Get expired bets that couldn't be resolved
    const expiredBets = db.prepare(`
      SELECT * FROM stock_bets
      WHERE status = 'pending'
      AND expires_at <= datetime('now', '-1 hour')
    `).all();

    const cancelBet = db.prepare(`
      UPDATE stock_bets
      SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const refundBalance = db.prepare(`
      UPDATE users
      SET balance = balance + ?
      WHERE id = ?
    `);

    const transaction = db.transaction((bets) => {
      for (const bet of bets) {
        cancelBet.run(bet.id);
        refundBalance.run(bet.bet_amount, bet.user_id);
      }
    });

    transaction(expiredBets);

    return expiredBets.length;
  }
}

module.exports = Stock;