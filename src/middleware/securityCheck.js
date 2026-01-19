const securityMonitor = require('../services/securityMonitor');
const catchAsync = require('../utils/helpers/catchAsync');
const AppError = require('../utils/errors/appError');
const TokenBlacklist = require('../models/user/tokenBlackListModal');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Middleware to check for critical security risks and force logout
 * Should be used after authentication middleware
 */
exports.checkCriticalRisk = catchAsync(async (req, res, next) => {
  // Only check authenticated users
  if (!req.user) {
    return next();
  }

  const role = req.user.role === 'admin' ? 'admin' : req.user.role === 'seller' ? 'seller' : 'buyer';

  // Check if critical risk requires force logout
  const logoutCheck = await securityMonitor.forceLogoutIfCritical(req.user, role);

  if (logoutCheck.shouldLogout) {
    // SECURITY: Cookie-only authentication - extract token ONLY from cookies
    const cookieName = role === 'admin' ? 'admin_jwt' : role === 'seller' ? 'seller_jwt' : 'main_jwt';
    const token = req.cookies?.[cookieName];

    // Blacklist the token
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        await TokenBlacklist.create({
          token,
          userId: req.user._id || req.user.id,
          role,
          expiresAt: new Date(decoded.exp * 1000),
          reason: 'Critical security risk detected',
        });
      } catch (error) {
        logger.error('[SecurityCheck] Error blacklisting token:', error);
      }
    }

    // Clear cookies
    const cookieName = role === 'admin' ? 'admin_jwt' : role === 'seller' ? 'seller_jwt' : 'main_jwt';
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return next(
      new AppError(
        'Your session was terminated due to suspicious activity. Please log in again.',
        401
      )
    );
  }

  next();
});

