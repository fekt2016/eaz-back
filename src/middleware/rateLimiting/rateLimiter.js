const rateLimit = require('express-rate-limit');

exports.dataExportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1,
  message: 'You can only request one data export per day',
  skip: (req) => req.user.role === 'admin', // Admins bypass limit
});

exports.dataDownloadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1,
  message: 'You can only request one data download per day',
  skip: (req) => req.user.role === 'admin', // Admins bypass limit
});
