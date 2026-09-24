-- Casino Platform Database Schema
-- Run this file to create all necessary tables

-- Drop existing tables if they exist (in correct order due to foreign keys)
DROP TABLE IF EXISTS custom_bet_entries;
DROP TABLE IF EXISTS custom_bets;
DROP TABLE IF EXISTS stock_bets;
DROP TABLE IF EXISTS game_rounds;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS users;

-- Users table
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin', 'owner') NOT NULL DEFAULT 'user',
    balance DECIMAL(20, 8) NOT NULL DEFAULT 100.00000000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessions table for JWT token management
CREATE TABLE sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_sessions (user_id),
    INDEX idx_token_hash (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit logs for all credit changes
CREATE TABLE audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(100) NOT NULL,
    amount_change DECIMAL(20, 8) NOT NULL,
    balance_before DECIMAL(20, 8) NOT NULL,
    balance_after DECIMAL(20, 8) NOT NULL,
    reason TEXT,
    performed_by VARCHAR(36),
    reference_type VARCHAR(50),
    reference_id VARCHAR(36),
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_audit (user_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at),
    INDEX idx_reference (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Game rounds table for all game plays
CREATE TABLE game_rounds (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    game_type ENUM('flip', 'dice', 'limbo', 'crash', 'mines', 'roulette', 'blackjack', 'keno', 'plinko') NOT NULL,
    bet_amount DECIMAL(20, 8) NOT NULL,
    payout_multiplier DECIMAL(10, 4) NOT NULL DEFAULT 0,
    payout_amount DECIMAL(20, 8) NOT NULL DEFAULT 0,
    outcome ENUM('win', 'loss', 'push', 'pending') NOT NULL DEFAULT 'pending',
    round_data JSON NOT NULL,
    server_seed VARCHAR(64) NOT NULL,
    client_seed VARCHAR(64),
    nonce INT UNSIGNED NOT NULL DEFAULT 0,
    is_autobet BOOLEAN NOT NULL DEFAULT FALSE,
    autobet_session_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_games (user_id),
    INDEX idx_game_type (game_type),
    INDEX idx_outcome (outcome),
    INDEX idx_created_at (created_at),
    INDEX idx_autobet_session (autobet_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stock bets table
CREATE TABLE stock_bets (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    bet_direction ENUM('up', 'down') NOT NULL,
    bet_amount DECIMAL(20, 8) NOT NULL,
    timeframe_seconds INT NOT NULL,
    payout_multiplier DECIMAL(5, 2) NOT NULL DEFAULT 1.85,
    status ENUM('active', 'won', 'lost', 'cancelled') NOT NULL DEFAULT 'active',
    exit_price DECIMAL(20, 8),
    payout_amount DECIMAL(20, 8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_stocks (user_id),
    INDEX idx_symbol (symbol),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom bets table
CREATE TABLE custom_bets (
    id VARCHAR(36) PRIMARY KEY,
    creator_id VARCHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    options JSON NOT NULL,
    total_pool DECIMAL(20, 8) NOT NULL DEFAULT 0,
    status ENUM('open', 'closed', 'resolved', 'cancelled') NOT NULL DEFAULT 'open',
    winning_option VARCHAR(100),
    resolution_note TEXT,
    resolved_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closes_at TIMESTAMP,
    resolved_at TIMESTAMP,
    
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_creator (creator_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom bet entries table
CREATE TABLE custom_bet_entries (
    id VARCHAR(36) PRIMARY KEY,
    bet_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    option_selected VARCHAR(100) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    potential_payout DECIMAL(20, 8) NOT NULL DEFAULT 0,
    actual_payout DECIMAL(20, 8) DEFAULT 0,
    status ENUM('active', 'won', 'lost', 'refunded') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (bet_id) REFERENCES custom_bets(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_bet_entries (bet_id),
    INDEX idx_user_entries (user_id),
    UNIQUE KEY unique_user_bet (bet_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- System settings table
CREATE TABLE settings (
    id VARCHAR(36) PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    setting_type ENUM('boolean', 'number', 'string', 'json') NOT NULL DEFAULT 'string',
    description TEXT,
    updated_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Autobet sessions table
CREATE TABLE autobet_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    game_type ENUM('flip', 'dice', 'limbo', 'crash', 'mines', 'keno', 'plinko') NOT NULL,
    config JSON NOT NULL,
    status ENUM('active', 'completed', 'stopped', 'error') NOT NULL DEFAULT 'active',
    total_bets INT NOT NULL DEFAULT 0,
    total_wagered DECIMAL(20, 8) NOT NULL DEFAULT 0,
    total_profit DECIMAL(20, 8) NOT NULL DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stopped_at TIMESTAMP,
    stop_reason VARCHAR(100),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_autobet (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;