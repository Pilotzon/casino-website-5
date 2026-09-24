const { db } = require('../config/database');

class AuditLog {
  /**
   * Create audit log entry
   */
  static create({ userId = null, adminId = null, actionType, actionDetails = {}, ipAddress = null }) {
    const result = db.prepare(`
      INSERT INTO audit_logs (user_id, admin_id, action_type, action_details, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, adminId, actionType, JSON.stringify(actionDetails), ipAddress);

    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find log by ID
   */
  static findById(id) {
    const log = db.prepare(`
      SELECT 
        al.*,
        u.username as user_username,
        a.username as admin_username
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN users a ON al.admin_id = a.id
      WHERE al.id = ?
    `).get(id);

    if (log && log.action_details) {
      log.action_details = JSON.parse(log.action_details);
    }

    return log;
  }

  /**
   * Get logs for a specific user
   */
  static getUserLogs(userId, limit = 50, offset = 0) {
    const logs = db.prepare(`
      SELECT 
        al.id,
        al.action_type,
        al.action_details,
        al.ip_address,
        al.created_at,
        a.username as admin_username
      FROM audit_logs al
      LEFT JOIN users a ON al.admin_id = a.id
      WHERE al.user_id = ?
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);

    return logs.map(log => ({
      ...log,
      action_details: log.action_details ? JSON.parse(log.action_details) : null
    }));
  }

  /**
   * Get all logs (admin view)
   */
  static getAll(limit = 100, offset = 0, actionType = null) {
    let query = `
      SELECT 
        al.id,
        al.action_type,
        al.action_details,
        al.ip_address,
        al.created_at,
        u.username as user_username,
        a.username as admin_username
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN users a ON al.admin_id = a.id
    `;

    const params = [];

    if (actionType) {
      query += ' WHERE al.action_type = ?';
      params.push(actionType);
    }

    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = db.prepare(query).all(...params);

    return logs.map(log => ({
      ...log,
      action_details: log.action_details ? JSON.parse(log.action_details) : null
    }));
  }

  /**
   * Get logs by action type
   */
  static getByActionType(actionType, limit = 50) {
    const logs = db.prepare(`
      SELECT 
        al.id,
        al.action_type,
        al.action_details,
        al.ip_address,
        al.created_at,
        u.username as user_username,
        a.username as admin_username
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN users a ON al.admin_id = a.id
      WHERE al.action_type = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(actionType, limit);

    return logs.map(log => ({
      ...log,
      action_details: log.action_details ? JSON.parse(log.action_details) : null
    }));
  }

  /**
   * Get logs within timeframe
   */
  static getRecentLogs(hours = 24, limit = 100) {
    const logs = db.prepare(`
      SELECT 
        al.id,
        al.action_type,
        al.action_details,
        al.ip_address,
        al.created_at,
        u.username as user_username,
        a.username as admin_username
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN users a ON al.admin_id = a.id
      WHERE al.created_at >= datetime('now', '-${hours} hours')
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(limit);

    return logs.map(log => ({
      ...log,
      action_details: log.action_details ? JSON.parse(log.action_details) : null
    }));
  }

  /**
   * Get admin action logs
   */
  static getAdminActions(adminId, limit = 50) {
    const logs = db.prepare(`
      SELECT 
        al.id,
        al.action_type,
        al.action_details,
        al.ip_address,
        al.created_at,
        u.username as affected_user
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.admin_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(adminId, limit);

    return logs.map(log => ({
      ...log,
      action_details: log.action_details ? JSON.parse(log.action_details) : null
    }));
  }

  /**
   * Search logs
   */
  static search(searchTerm, limit = 50) {
    const logs = db.prepare(`
      SELECT 
        al.id,
        al.action_type,
        al.action_details,
        al.ip_address,
        al.created_at,
        u.username as user_username,
        a.username as admin_username
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN users a ON al.admin_id = a.id
      WHERE 
        al.action_type LIKE ? OR
        al.action_details LIKE ? OR
        u.username LIKE ? OR
        a.username LIKE ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, limit);

    return logs.map(log => ({
      ...log,
      action_details: log.action_details ? JSON.parse(log.action_details) : null
    }));
  }

  /**
   * Get action type statistics
   */
  static getActionStats(hours = 24) {
    const stats = db.prepare(`
      SELECT 
        action_type,
        COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= datetime('now', '-${hours} hours')
      GROUP BY action_type
      ORDER BY count DESC
    `).all();

    return stats;
  }

  /**
   * Delete old logs (cleanup)
   */
  static deleteOlderThan(days = 365) {
    const result = db.prepare(`
      DELETE FROM audit_logs
      WHERE created_at < datetime('now', '-${days} days')
      AND action_type NOT IN ('ACCOUNT_CREATED', 'ROLE_CHANGED', 'BALANCE_ADJUSTED')
    `).run();

    return result.changes;
  }

  /**
   * Get log count
   */
  static getCount(actionType = null) {
    if (actionType) {
      return db.prepare(`
        SELECT COUNT(*) as count 
        FROM audit_logs 
        WHERE action_type = ?
      `).get(actionType).count;
    }

    return db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
  }
}

// Common action types as constants
AuditLog.ACTION_TYPES = {
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  BALANCE_CHANGE: 'BALANCE_CHANGE',
  BALANCE_ADJUSTED: 'BALANCE_ADJUSTED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  ACCOUNT_STATUS_CHANGED: 'ACCOUNT_STATUS_CHANGED',
  GAME_STATUS_CHANGED: 'GAME_STATUS_CHANGED',
  GAME_CONFIG_UPDATED: 'GAME_CONFIG_UPDATED',
  SETTING_CHANGED: 'SETTING_CHANGED',
  BET_PLACED: 'BET_PLACED',
  BET_RESOLVED: 'BET_RESOLVED'
};

module.exports = AuditLog;