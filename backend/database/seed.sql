-- Casino Platform Seed Data
-- Run this after schema.sql to insert initial data

-- Insert default settings
INSERT INTO settings (id, setting_key, setting_value, setting_type, description) VALUES
    (UUID(), 'signup_enabled', 'true', 'boolean', 'Whether new user registration is enabled'),
    (UUID(), 'game_flip_enabled', 'true', 'boolean', 'Whether the Flip game is enabled'),
    (UUID(), 'game_dice_enabled', 'true', 'boolean', 'Whether the Dice game is enabled'),
    (UUID(), 'game_limbo_enabled', 'true', 'boolean', 'Whether the Limbo game is enabled'),
    (UUID(), 'game_crash_enabled', 'true', 'boolean', 'Whether the Crash game is enabled'),
    (UUID(), 'game_mines_enabled', 'true', 'boolean', 'Whether the Mines game is enabled'),
    (UUID(), 'game_roulette_enabled', 'true', 'boolean', 'Whether the Roulette game is enabled'),
    (UUID(), 'game_blackjack_enabled', 'true', 'boolean', 'Whether the Blackjack game is enabled'),
    (UUID(), 'game_keno_enabled', 'true', 'boolean', 'Whether the Keno game is enabled'),
    (UUID(), 'game_plinko_enabled', 'true', 'boolean', 'Whether the Plinko game is enabled'),
    (UUID(), 'stocks_enabled', 'true', 'boolean', 'Whether stock betting is enabled'),
    (UUID(), 'custom_bets_enabled', 'true', 'boolean', 'Whether custom bets are enabled'),
    (UUID(), 'min_bet_amount', '0.00000001', 'number', 'Minimum bet amount allowed'),
    (UUID(), 'max_bet_amount', '1000.00000000', 'number', 'Maximum bet amount allowed'),
    (UUID(), 'starting_balance', '100.00000000', 'number', 'Starting balance for new users'),
    (UUID(), 'stock_payout_multiplier', '1.85', 'number', 'Payout multiplier for winning stock bets'),
    (UUID(), 'autobet_min_delay_ms', '500', 'number', 'Minimum delay between autobet rounds in milliseconds');