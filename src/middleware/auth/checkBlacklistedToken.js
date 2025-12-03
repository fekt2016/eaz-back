const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const AppError = require('../../utils/errors/appError');
const { extractToken } = require('../../utils/helpers/routeUtils');
const catchAsync = require('../../utils/helpers/catchAsync');

/**
 * Middleware to check if token is blacklisted
 * Should run before token verification
 */
exports.checkBlacklistedToken = catchAsync(async (req, res, next) => {
  // Extract token from request
  const token = extractToken(req);

  if (!token) {
    return next(); // Let other middleware handle missing token
  }

  // Check if token is blacklisted
  const isBlacklisted = await TokenBlacklist.isBlacklisted(token);

  if (isBlacklisted) {
    return next(
      new AppError('Your session has expired. Please log in again.', 401),
    );
  }

  next();
});

