const validator = require('validator');
const { getNumberSetting } = require("../services/settingsService");
console.log("✅ USING VALIDATION FILE:", __filename);
/**
 * Validate email format
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  return validator.isEmail(email);
}

/**
 * Validate password strength
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { valid: false, message: 'Password is too long' };
  }

  // Check for at least one number, one uppercase, one lowercase
  const hasNumber = /\d/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);

  if (!hasNumber || !hasUpper || !hasLower) {
    return { 
      valid: false, 
      message: 'Password must contain at least one number, one uppercase and one lowercase letter' 
    };
  }

  return { valid: true };
}

/**
 * Validate username
 */
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: 'Username is required' };
  }

  if (username.length < 3) {
    return { valid: false, message: 'Username must be at least 3 characters long' };
  }

  if (username.length > 20) {
    return { valid: false, message: 'Username is too long (max 20 characters)' };
  }

  // Only allow alphanumeric and underscore
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, message: 'Username can only contain letters, numbers, and underscores' };
  }

  return { valid: true };
}

/**
 * Validate bet amount
 */
function validateBetAmount(amount, minBetArg, maxBetArg) {
  // If caller passed explicit min/max, use them; otherwise read from system_settings
  const minBet =
    typeof minBetArg === "number"
      ? minBetArg
      : getNumberSetting("min_bet_amount", 0.00000001);

  const maxBet =
    typeof maxBetArg === "number"
      ? maxBetArg
      : getNumberSetting("max_bet_amount", 1000);

  if (typeof amount !== "number" || isNaN(amount)) {
    return { valid: false, message: "Invalid bet amount" };
  }

  if (amount <= 0) {
    return { valid: false, message: "Bet amount must be positive" };
  }

  if (amount < minBet) {
    return { valid: false, message: `Minimum bet is ${minBet}` };
  }

  if (amount > maxBet) {
    return { valid: false, message: `Maximum bet is ${maxBet}` };
  }

  const decimalPlaces = (amount.toString().split(".")[1] || "").length;
  if (decimalPlaces > 8) {
    return { valid: false, message: "Too many decimal places (max 8)" };
  }

  return { valid: true };
}

/**
 * Validate multiplier
 */
function validateMultiplier(multiplier, min = 1.01, max = 1000000) {
  if (typeof multiplier !== 'number' || isNaN(multiplier)) {
    return { valid: false, message: 'Invalid multiplier' };
  }

  if (multiplier < min) {
    return { valid: false, message: `Minimum multiplier is ${min}` };
  }

  if (multiplier > max) {
    return { valid: false, message: `Maximum multiplier is ${max}` };
  }

  return { valid: true };
}

/**
 * Sanitize string input
 */
function sanitizeString(str, maxLength = 1000) {
  if (typeof str !== 'string') {
    return '';
  }

  // Remove null bytes and control characters
  let sanitized = str.replace(/\0/g, '').replace(/[\x00-\x1F\x7F]/g, '');
  
  // Trim and limit length
  sanitized = sanitized.trim().substring(0, maxLength);
  
  return sanitized;
}

/**
 * Validate request body middleware
 */
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // Check required
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip further validation if field is optional and not provided
      if (!rules.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type validation
      if (rules.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rules.type) {
          errors.push(`${field} must be a ${rules.type}`);
          continue;
        }
      }

      // Custom validator
      if (rules.validator) {
        const result = rules.validator(value);
        if (result !== true) {
          errors.push(result);
        }
      }

      // Min/Max for numbers
      if (rules.type === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        }
      }

      // Length for strings
      if (rules.type === 'string') {
        if (rules.minLength !== undefined && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }
        if (rules.maxLength !== undefined && value.length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
        }
      }

      // Enum validation
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    next();
  };
}

module.exports = {
  validateEmail,
  validatePassword,
  validateUsername,
  validateBetAmount,
  validateMultiplier,
  sanitizeString,
  validateBody
};