const rateLimit = require('express-rate-limit');

/**
 * SECURITY FIX #26: Rate limit wallet operations to prevent abuse
 */

// Rate limiter for wallet top-up operations
exports.walletTopupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 10 : 30, // 10 in production, 30 in dev
    message: {
        error: 'Too many wallet top-up attempts. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for wallet adjustment operations (admin only)  
exports.walletAdjustLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 50, // Higher limit since it's admin-only
    message: {
        error: 'Too many wallet adjustment attempts. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
