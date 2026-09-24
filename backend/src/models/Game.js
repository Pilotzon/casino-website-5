const { db } = require('../config/database');

class Game {
  /**
   * Get game by name
   */
  static findByName(name) {
    return db.prepare(`
      SELECT id, name, display_name, is_enabled, is_mobile_enabled, config, created_at, updated_at
      FROM games
      WHERE name = ?
    `).get(name);
  }

  /**
   * Get game by ID
   */
  static findById(id) {
    return db.prepare(`
      SELECT id, name, display_name, is_enabled, is_mobile_enabled, config, created_at, updated_at
      FROM games
      WHERE id = ?
    `).get(id);
  }

  /**
   * Get all games
   */
  static getAll(includeDisabled = false) {
    if (includeDisabled) {
      return db.prepare(`
        SELECT id, name, display_name, is_enabled, is_mobile_enabled, config, created_at, updated_at
        FROM games
        ORDER BY id
      `).all();
    }

    return db.prepare(`
      SELECT id, name, display_name, is_enabled, is_mobile_enabled, config, created_at, updated_at
      FROM games
      WHERE is_enabled = 1
      ORDER BY id
    `).all();
  }

  /**
   * Enable/disable game (owner only)
   */
  static setEnabled(gameId, isEnabled, ownerId) {
    db.prepare(`
      UPDATE games 
      SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(isEnabled ? 1 : 0, gameId);

    // Log the change
    db.prepare(`
      INSERT INTO audit_logs (user_id, action_type, action_details)
      VALUES (?, ?, ?)
    `).run(ownerId, 'GAME_STATUS_CHANGED', JSON.stringify({
      game_id: gameId,
      is_enabled: isEnabled
    }));

    return this.findById(gameId);
  }

  static setMobileEnabled(gameId, isMobileEnabled, ownerId) {
    db.prepare(`
      UPDATE games 
      SET is_mobile_enabled = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(isMobileEnabled ? 1 : 0, gameId);

    db.prepare(`
      INSERT INTO audit_logs (user_id, action_type, action_details)
      VALUES (?, ?, ?)
    `).run(ownerId, 'GAME_MOBILE_STATUS_CHANGED', JSON.stringify({
      game_id: gameId,
      is_mobile_enabled: isMobileEnabled
    }));

    return this.findById(gameId);
  }

  static isMobileEnabled(gameName) {
    const game = this.findByName(gameName);
    return game && game.is_mobile_enabled === 1;
  }

  /**
   * Update game configuration
   */
  static updateConfig(gameId, config, ownerId) {
    db.prepare(`
      UPDATE games 
      SET config = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(JSON.stringify(config), gameId);

    // Log the change
    db.prepare(`
      INSERT INTO audit_logs (user_id, action_type, action_details)
      VALUES (?, ?, ?)
    `).run(ownerId, 'GAME_CONFIG_UPDATED', JSON.stringify({
      game_id: gameId,
      config
    }));

    return this.findById(gameId);
  }

  /**
   * Get game statistics
   */
  static getStats(gameId, timeframe = '24h') {
    let whereClause = 'WHERE game_id = ?';
    const params = [gameId];

    if (timeframe !== 'all') {
      const hours = parseInt(timeframe.replace('h', ''));
      whereClause += ` AND created_at >= datetime('now', '-${hours} hours')`;
    }

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_rounds,
        SUM(bet_amount) as total_wagered,
        SUM(payout_amount) as total_paid_out,
        SUM(bet_amount - payout_amount) as house_profit,
        AVG(bet_amount) as avg_bet,
        MAX(payout_amount) as max_payout
      FROM rounds
      ${whereClause}
    `).get(...params);

    return {
      total_rounds: stats.total_rounds || 0,
      total_wagered: stats.total_wagered || 0,
      total_paid_out: stats.total_paid_out || 0,
      house_profit: stats.house_profit || 0,
      avg_bet: stats.avg_bet || 0,
      max_payout: stats.max_payout || 0,
      rtp: stats.total_wagered > 0 
        ? ((stats.total_paid_out / stats.total_wagered) * 100).toFixed(2) 
        : 0
    };
  }

  /**
   * Check if game is enabled
   */
  static isEnabled(gameName) {
    const game = this.findByName(gameName);
    return game && game.is_enabled === 1;
  }

  /**
   * Get recent rounds for a game
   */
  static getRecentRounds(gameId, limit = 50) {
    return db.prepare(`
      SELECT 
        r.id,
        r.round_uuid,
        r.bet_amount,
        r.payout_amount,
        r.multiplier,
        r.created_at,
        u.username
      FROM rounds r
      JOIN users u ON r.user_id = u.id
      WHERE r.game_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(gameId, limit);
  }
}

module.exports = Game;