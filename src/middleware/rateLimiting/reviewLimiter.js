/**
 * Rate Limiter for Review Submission
 * Prevents review spam and abuse
 * SECURITY: Mandatory for abuse prevention
 */

const rateLimit = require('express-rate-limit');

const isProduction = process.env.NODE_ENV === 'production';

// Rate limiter for review creation
// Allow 5 reviews per hour per user (reasonable limit for legitimate use)
exports.reviewSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isProduction ? 5 : 20, // 5 in production, 20 in development
  message: {
    status: 'error',
    message: 'Too many review submissions. Please try again later. Maximum 5 reviews per hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests (including failed ones)
  keyGenerator: (req) => {
    // Use user ID for per-user rate limiting
    return req.user ? req.user.id : req.ip;
  },
});

module.exports = exports;

