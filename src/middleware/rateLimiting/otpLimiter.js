const rateLimit = require('express-rate-limit');

// Only apply rate limiting in production
const isProduction = process.env.NODE_ENV === 'production';

// Middleware that skips rate limiting in development
const skipRateLimit = (req, res, next) => {
  if (!isProduction) {
    return next(); // Skip rate limiting in development
  }
  // In production, this will be replaced by the actual rate limiter
};

exports.resetLimiter = isProduction
  ? rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // limit each IP to 5 reset attempts per windowMs
      message: {
        error: 'Too many reset attempts, please try again later.',
      },
    })
  : skipRateLimit;

exports.otpLimiter = isProduction
  ? rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 3, // limit each IP to 3 OTP requests per windowMs
      message: {
        error: 'Too many OTP requests, please try again later.',
      },
    })
  : skipRateLimit;
