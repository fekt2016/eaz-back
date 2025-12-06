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

// SECURITY FIX #4: OTP rate limiter - ALWAYS ENABLED
exports.otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 3 : 10, // 3 in production, 10 in development
  message: {
    error: 'Too many OTP requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
