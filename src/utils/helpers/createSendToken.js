const jwt = require('jsonwebtoken');
const logger = require('../logger');
const { generateDeviceId } = require('./deviceUtils');

const signToken = (id, role, deviceId = null) => {
  // Default to 90 days if JWT_EXPIRES_IN is not set
  const expiresIn = process.env.JWT_EXPIRES_IN || '90d';
  const payload = { id, role };
  if (deviceId) {
    payload.deviceId = deviceId;
  }
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn,
  });
};

/**
 * Create and send token (legacy function - use createDeviceSession for new device sessions)
 * @param {Object} user - User object
 * @param {Number} statusCode - HTTP status code
 * @param {Object} res - Express response object
 * @param {String} redirectTo - Optional redirect path
 * @param {String} cookieName - Cookie name (default: 'jwt')
 * @param {Object} req - Express request object (optional, for device session creation)
 * @param {String} platform - Platform name (optional)
 */
exports.createSendToken = async (user, statusCode, res, redirectTo = null, cookieName = 'jwt', req = null, platform = null) => {
  // If req is provided, create device session
  let deviceId = null;
  let refreshToken = null;

  if (req) {
    try {
      const { createDeviceSession } = require('./createDeviceSession');
      logger.info('[createSendToken] Creating device session for user:', user._id, 'platform:', platform);
      const sessionData = await createDeviceSession(req, user, platform);
      deviceId = sessionData.deviceId;
      refreshToken = sessionData.refreshToken;
      logger.info('[createSendToken] Device session created:', deviceId);
    } catch (error) {
      logger.error('[createSendToken] ❌ Error creating device session:', error.message);
      logger.error('[createSendToken] Error stack:', error.stack);
      // Continue without device session if error occurs
    }
  }

  const token = signToken(user._id, user.role, deviceId);
  const isProduction = process.env.NODE_ENV === 'production';

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction, // true in production, false in development
    // CRITICAL: For cross-origin requests (seller.saiisai.com -> api.saiisai.com)
    // sameSite must be 'none' when secure is true
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site in production, 'lax' for same-site in dev
    path: '/', // Available on all paths
    expires: new Date(
      Date.now() +
      (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000, // 90 days default
    ),
    // Set domain for production to allow cookie sharing across subdomains
    // CRITICAL: Default to .saiisai.com so JWT is shared across all subdomains
    // (seller.saiisai.com, admin.saiisai.com, saiisai.com).
    // Without this, the cookie is scoped only to api.saiisai.com and
    // the seller/admin apps won't include it in cross-origin requests.
    ...(isProduction && { domain: process.env.COOKIE_DOMAIN || '.saiisai.com' }),
  };

  // Debug logging for cookie configuration (production only, non-sensitive)
  if (isProduction) {
    logger.info('[createSendToken] Cookie configuration', {
      cookieName,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      domain: cookieOptions.domain || 'not set',
      hasCookieDomainEnv: !!process.env.COOKIE_DOMAIN,
      cookieDomainEnv: process.env.COOKIE_DOMAIN || '.saiisai.com (default)',
    });
  }

  res.cookie(cookieName, token, cookieOptions);

  // Generate CSRF token on successful authentication
  const { generateCSRFToken } = require('../../middleware/csrf/csrfProtection');
  generateCSRFToken(res);

  // SECURITY FIX #9: Initialize session activity tracking
  if (user && typeof user.lastActivity !== 'undefined') {
    user.lastActivity = Date.now();
  }

  user.password = undefined;

  // SECURITY: Token is ONLY in HTTP-only cookie, NOT in JSON response
  // This prevents XSS attacks from stealing tokens
  const response = {
    status: 'success',
    message: 'Authentication successful',
    data: {
      user,
    },
  };

  // Add deviceId and refreshToken if device session was created (non-sensitive metadata)
  if (deviceId) {
    response.deviceId = deviceId;
  }
  if (refreshToken) {
    // Note: refreshToken is also stored in device session, not exposed to client
    // Only include if needed for client-side session management (consider removing)
    // response.refreshToken = refreshToken;
  }

  // Add redirectTo if provided
  if (redirectTo) {
    response.redirectTo = redirectTo;
  }

  res.status(statusCode).json(response);
};
