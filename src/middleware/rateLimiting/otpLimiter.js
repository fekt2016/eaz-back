const rateLimit = require('express-rate-limit');

exports.resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 reset attempts per windowMs
  message: {
    error: 'Too many reset attempts, please try again later.',
  },
});
exports.otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 OTP requests per windowMs
  message: {
    error: 'Too many OTP requests, please try again later.',
  },
});
