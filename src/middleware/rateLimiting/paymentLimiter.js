const rateLimit = require('express-rate-limit');

// SECURITY FIX #13: Rate limit payment verification to prevent abuse
exports.paymentVerificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 5 : 20, // 5 in production, 20 in dev
    message: {
        error: 'Too many payment verification attempts. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Only count failed attempts
});

// SECURITY FIX #13: Rate limit payment initialization
exports.paymentInitLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: process.env.NODE_ENV === 'production' ? 10 : 30, // 10 in production, 30 in dev
    message: {
        error: 'Too many payment initialization attempts. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
