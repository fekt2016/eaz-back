/**
 * SECURITY FIX #11 (Phase 3 Enhancement): Secure Logging Utility
 * Masks sensitive data in logs and provides structured logging
 */

/**
 * Mask sensitive data in strings
 * @param {string} value - Value to mask
 * @param {number} visibleChars - Number of characters to show at start/end
 * @returns {string} Masked value
 */
const maskSensitive = (value, visibleChars = 2) => {
  if (!value || typeof value !== 'string') {
    return '***';
  }
  
  if (value.length <= visibleChars * 2) {
    return '***';
  }
  
  const start = value.substring(0, visibleChars);
  const end = value.substring(value.length - visibleChars);
  const masked = '*'.repeat(Math.min(value.length - (visibleChars * 2), 10));
  
  return `${start}${masked}${end}`;
};

/**
 * Mask email address (show first 2 chars and domain)
 * @param {string} email - Email to mask
 * @returns {string} Masked email
 */
const maskEmail = (email) => {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return '***@***';
  }
  
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }
  
  return `${localPart.substring(0, 2)}***@${domain}`;
};

/**
 * Mask phone number (show last 4 digits only)
 * @param {string} phone - Phone to mask
 * @returns {string} Masked phone
 */
const maskPhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return '***';
  }
  
  if (phone.length <= 4) {
    return '***';
  }
  
  return `***${phone.substring(phone.length - 4)}`;
};

/**
 * Secure logger that masks sensitive data
 */
exports.secureLog = {
  /**
   * Log info message (masks sensitive data)
   */
  info: (message, data = {}) => {
    const sanitizedData = exports.sanitizeLogData(data);
    console.log(`[INFO] ${message}`, sanitizedData);
  },
  
  /**
   * Log warning message (masks sensitive data)
   */
  warn: (message, data = {}) => {
    const sanitizedData = exports.sanitizeLogData(data);
    console.warn(`[WARN] ${message}`, sanitizedData);
  },
  
  /**
   * Log error message (masks sensitive data)
   */
  error: (message, error = {}) => {
    const sanitizedData = exports.sanitizeLogData(error);
    console.error(`[ERROR] ${message}`, sanitizedData);
  },
  
  /**
   * Log debug message (only in development, masks sensitive data)
   */
  debug: (message, data = {}) => {
    if (process.env.NODE_ENV === 'development') {
      const sanitizedData = exports.sanitizeLogData(data);
      console.debug(`[DEBUG] ${message}`, sanitizedData);
    }
  },
};

/**
 * Sanitize log data by masking sensitive fields
 * @param {object} data - Data object to sanitize
 * @returns {object} Sanitized data
 */
exports.sanitizeLogData = (data) => {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'password',
    'otp',
    'token',
    'resetToken',
    'resetPasswordToken',
    'accessToken',
    'refreshToken',
    'apiKey',
    'secret',
    'secretKey',
    'privateKey',
    'creditCard',
    'cardNumber',
    'cvv',
    'pin',
  ];
  
  const sanitized = { ...data };
  
  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();
    
    // Check if field name contains sensitive keywords
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      sanitized[key] = maskSensitive(String(value));
    } else if (lowerKey.includes('email')) {
      sanitized[key] = maskEmail(String(value));
    } else if (lowerKey.includes('phone')) {
      sanitized[key] = maskPhone(String(value));
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = exports.sanitizeLogData(value);
    }
  }
  
  return sanitized;
};

/**
 * Log OTP generation (development only, masked)
 */
exports.logOtpGeneration = (userId, loginId, otpType) => {
  if (process.env.NODE_ENV === 'development') {
    exports.secureLog.debug('OTP generated', {
      userId,
      loginId: loginId?.includes('@') ? maskEmail(loginId) : maskPhone(loginId),
      otpType,
      // OTP value is NEVER logged, even in development
    });
  }
};

/**
 * Log authentication event (masks sensitive data)
 */
exports.logAuthEvent = (event, data) => {
  const sanitized = exports.sanitizeLogData(data);
  exports.secureLog.info(`[Auth] ${event}`, sanitized);
};

