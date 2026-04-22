const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../../utils/rateLimitKey');

const isProduction = process.env.NODE_ENV === 'production';

exports.supportTicketCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 8 : 40,
  message: {
    status: 'fail',
    message: 'Too many ticket submissions. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

exports.supportTicketReplyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 20 : 80,
  message: {
    status: 'fail',
    message: 'Too many support replies. Please slow down and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

