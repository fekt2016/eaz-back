const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const logger = require('../../utils/logger');
const { extractToken, verifyToken, findUserByToken } = require('../../utils/helpers/routeUtils');

/**
 * Optional Authentication Middleware
 * Validates token if present and sets req.user, but doesn't require authentication
 * Useful for public routes that need to know if user is authenticated (e.g., to show admin-only data)
 */
exports.optionalAuth = catchAsync(async (req, res, next) => {
  // SECURITY: Cookie-only authentication - tokens MUST be in HTTP-only cookies
  // Extract token ONLY from cookies
  const fullPath = req.originalUrl.split('?')[0];
  const isAdminRoute = fullPath.startsWith('/api/v1/admin');
  const isSellerRoute = fullPath.startsWith('/api/v1/seller');
  
  // For shared routes (like /product), check all possible cookies
  // This allows admins to access shared routes using admin_jwt cookie
  let token = null;
  let cookieName = null;
  
  if (isAdminRoute) {
    cookieName = 'admin_jwt';
    token = req.cookies?.[cookieName];
  } else if (isSellerRoute) {
    cookieName = 'seller_jwt';
    token = req.cookies?.[cookieName];
  } else {
    // For shared routes, try all cookies in priority order: admin_jwt, seller_jwt, main_jwt
    // This ensures admins can access shared routes (like /product) with their admin_jwt cookie
    token = req.cookies?.['admin_jwt'] || req.cookies?.['seller_jwt'] || req.cookies?.['main_jwt'];
    cookieName = req.cookies?.['admin_jwt'] ? 'admin_jwt' :
                 req.cookies?.['seller_jwt'] ? 'seller_jwt' :
                 'main_jwt';
  }
  
  // If no token found, continue without authentication (public access)
  if (!token) {
    return next();
  }
  
  // Check if token is blacklisted
  const isBlacklisted = await TokenBlacklist.isBlacklisted(token);
  if (isBlacklisted) {
    // Token is blacklisted, but don't fail - just don't set req.user
    return next();
  }
  
  // Verify token (fullPath already declared above)
  const { decoded, error } = await verifyToken(token, fullPath);
  
  // If token is invalid, continue without authentication (don't fail)
  if (error || !decoded) {
    return next();
  }
  
  // Find user
  const currentUser = await findUserByToken(decoded);
  if (!currentUser) {
    // User not found, but don't fail - just don't set req.user
    return next();
  }
  
  // Check password change timestamp
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    // Password changed, but don't fail - just don't set req.user
    return next();
  }
  
  // Attach user to request
  req.user = currentUser;
  if (decoded.deviceId) {
    req.user.deviceId = decoded.deviceId;
  }
  
  logger.info(`[OptionalAuth] Authenticated as ${currentUser.role}: ${currentUser.email || currentUser.phone}`);
  next();
});


