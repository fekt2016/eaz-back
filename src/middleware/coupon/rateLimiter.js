/**
 * Rate Limiter for Coupon Validation
 * Prevents brute force coupon code guessing
 */

const rateLimit = require('express-rate-limit');

// Limit coupon validation attempts
exports.couponValidationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 validation attempts per window
  message: {
    status: 'error',
    message: 'Too many coupon validation attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
});

// Stricter limit for coupon application
exports.couponApplicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 applications per hour
  message: {
    status: 'error',
    message: 'Too many coupon applications. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = exports;

