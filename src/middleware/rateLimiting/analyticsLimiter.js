const rateLimit = require('express-rate-limit');

const isProduction = process.env.NODE_ENV === 'production';

// Public analytics ingestion limiter to reduce event flooding and poisoning.
exports.analyticsIngestionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 120 : 1000,
  message: {
    status: 'fail',
    message: 'Too many analytics events. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

