const rateLimit = require('express-rate-limit');

// SECURITY: Always enable rate limiting, but with different limits for dev vs production
const isProduction = process.env.NODE_ENV === 'production';

// SECURITY FIX #4: Reset password rate limiter - ALWAYS ENABLED
exports.resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 10, // 5 in production, 10 in development
  message: {
    error: 'Too many reset attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY FIX #4 & #6: OTP rate limiter - ALWAYS ENABLED
// Requirements: 5 requests per hour for OTP endpoints
exports.otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour (as per security requirements)
  max: isProduction ? 5 : 10, // 5 in production (as per requirements), 10 in development
  message: {
    error: 'Too many OTP requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP address for rate limiting
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// SECURITY: Financial action rate limiter — prevents rapid-fire withdrawal/cancel/reverse attempts
exports.financialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 20, // 5 financial actions per 15 min in production
  message: {
    error: 'Too many financial requests. Please slow down and try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit per seller (authenticated user) rather than just IP
    return req.user?.id || req.ip || req.connection.remoteAddress;
  },
});

// SECURITY: Withdrawal creation limiter — stricter limit for creating new withdrawals
exports.withdrawalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isProduction ? 3 : 10, // 3 withdrawal requests per hour in production
  message: {
    error: 'Too many withdrawal requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id || req.ip || req.connection.remoteAddress;
  },
});
