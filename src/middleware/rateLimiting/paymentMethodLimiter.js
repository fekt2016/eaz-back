/**
 * Rate Limiter for Payment Method Operations
 * Prevents abuse and spam of payment method creation/verification
 * SECURITY: Mandatory for fraud prevention
 */

const rateLimit = require('express-rate-limit');

const isProduction = process.env.NODE_ENV === 'production';

// Rate limiter for payment method creation
// Max 3 payment methods per day, 5 total per seller
exports.paymentMethodCreationLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: isProduction ? 3 : 10, // 3 in production, 10 in development
  message: {
    status: 'error',
    message: 'Too many payment method creation attempts. Maximum 3 payment methods per day. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
  keyGenerator: (req) => {
    // Use user ID for per-user rate limiting
    return req.user ? req.user.id : req.ip;
  },
});

// Rate limiter for verification requests
// Max 2 verification requests per day (after rejection)
exports.verificationRequestLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: isProduction ? 2 : 5, // 2 in production, 5 in development
  message: {
    status: 'error',
    message: 'Too many verification requests. Maximum 2 requests per day. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    return req.user ? req.user.id : req.ip;
  },
});

// Rate limiter for payment method updates
// Max 5 updates per hour
exports.paymentMethodUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isProduction ? 5 : 20, // 5 in production, 20 in development
  message: {
    status: 'error',
    message: 'Too many update attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    return req.user ? req.user.id : req.ip;
  },
});

module.exports = exports;
