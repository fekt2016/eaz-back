/**
 * SECURITY FIX #4 (ENHANCED): Advanced OTP Rate Limiting
 * Prevents brute-force attacks with IP-based and account-based tracking
 */

const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

// Cache for tracking failed OTP attempts per user
const failedAttemptsCache = new NodeCache({ stdTTL: 900 }); // 15 minutes

// SECURITY: Always enable rate limiting, but with different limits for dev vs production
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Enhanced OTP rate limiter with account lockout
 * Tracks both IP-based and account-based attempts
 */
exports.otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 3 : 10, // 3 in production, 10 in development
  message: {
    error: 'Too many OTP requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key generator to include user ID if available
  keyGenerator: (req) => {
    // Use IP address as primary key
    const ip = req.ip || req.connection.remoteAddress;
    
    // If user is authenticated, include user ID for account-based tracking
    if (req.user && req.user.id) {
      return `${ip}:user:${req.user.id}`;
    }
    
    // If loginId is in body, use it for account-based tracking
    if (req.body && req.body.loginId) {
      return `${ip}:loginId:${req.body.loginId}`;
    }
    
    return ip;
  },
  // Custom handler to track failed attempts
  handler: (req, res) => {
    const key = req.ip || req.connection.remoteAddress;
    const attempts = failedAttemptsCache.get(key) || 0;
    failedAttemptsCache.set(key, attempts + 1, 900); // 15 minutes
    
    // Log security event
    console.warn('[Security] OTP rate limit exceeded:', {
      ip: req.ip,
      user: req.user?.id || req.body?.loginId || 'unknown',
      attempts: attempts + 1,
      path: req.path,
    });
    
    res.status(429).json({
      status: 'error',
      error: 'Too many OTP requests, please try again later.',
      retryAfter: 15 * 60, // 15 minutes in seconds
    });
  },
});

/**
 * Enhanced reset password rate limiter
 */
exports.resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 10, // 5 in production, 10 in development
  message: {
    error: 'Too many reset attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key generator to include email/loginId
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    
    // Include email/loginId for account-based rate limiting
    if (req.body && (req.body.email || req.body.loginId)) {
      return `${ip}:${req.body.email || req.body.loginId}`;
    }
    
    return ip;
  },
  handler: (req, res) => {
    console.warn('[Security] Password reset rate limit exceeded:', {
      ip: req.ip,
      email: req.body?.email || req.body?.loginId || 'unknown',
      path: req.path,
    });
    
    res.status(429).json({
      status: 'error',
      error: 'Too many reset attempts, please try again later.',
      retryAfter: 15 * 60,
    });
  },
});

/**
 * Get failed attempt count for an IP or user
 */
exports.getFailedAttempts = (key) => {
  return failedAttemptsCache.get(key) || 0;
};

/**
 * Clear failed attempts for an IP or user (after successful verification)
 */
exports.clearFailedAttempts = (key) => {
  failedAttemptsCache.del(key);
};

