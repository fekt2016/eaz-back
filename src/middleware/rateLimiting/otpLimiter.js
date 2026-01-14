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
