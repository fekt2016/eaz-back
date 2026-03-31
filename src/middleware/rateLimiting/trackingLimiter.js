const rateLimit = require('express-rate-limit');

// SECURITY: Rate limit public tracking lookups to reduce brute-force enumeration.
exports.trackingNumberLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV === 'production' ? 20 : 200,
  message: {
    error: 'Too many tracking attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

