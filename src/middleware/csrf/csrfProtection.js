/**
 * SECURITY FIX #7: CSRF Protection Middleware
 * Protects all authenticated state-changing operations from CSRF attacks
 * 
 * Implementation:
 * 1. CSRF token is generated on login/signup and stored in a cookie (httpOnly: false)
 * 2. Frontend must read token from cookie and send it in X-CSRF-Token header
 * 3. Middleware validates token by comparing header value with cookie value
 */

const crypto = require('crypto');
const AppError = require('../../utils/errors/appError');
const { isPublicRoute } = require('../../utils/helpers/routeUtils');

/**
 * Generate a CSRF token and set it in a cookie
 * This should be called after successful authentication (login/signup)
 * @param {Object} res - Express response object
 * @returns {string} The generated CSRF token
 */
exports.generateCSRFToken = (res) => {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  // CSRF token cookie must be readable by JavaScript (httpOnly: false)
  // This allows the frontend to read it and send it in the X-CSRF-Token header
  const cookieOptions = {
    httpOnly: false, // Must be readable by JavaScript
    secure: isProduction, // HTTPS only in production
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site in production, 'lax' for same-site in dev
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // Set domain for production if needed
    ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  };

  res.cookie('csrf-token', csrfToken, cookieOptions);
  
  return csrfToken;
};

/**
 * Conditional CSRF protection middleware
 * Only applies CSRF protection to authenticated, state-changing routes
 */
exports.csrfProtection = (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();

  // Skip CSRF for public routes (login, signup, etc.)
  if (isPublicRoute(fullPath, method)) {
    return next();
  }

  // Skip CSRF for read-only operations
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  // Skip CSRF for webhook endpoints (they use signature verification instead)
  if (fullPath.includes('/webhook')) {
    return next();
  }

  // Allow logout endpoints without CSRF token.
  // CSRF risk here is limited to forced logout, which is acceptable, and
  // avoids blocking users from logging out if the CSRF token is missing.
  if (fullPath === '/api/v1/users/logout') {
    return next();
  }

  // Get token from header
  const tokenFromHeader = req.headers['x-csrf-token'];
  
  // Get token from cookie
  const tokenFromCookie = req.cookies['csrf-token'];

  // Both token and cookie must be present
  if (!tokenFromHeader || !tokenFromCookie) {
    // Log security event
    console.warn('[Security] CSRF token validation failed - missing token:', {
      ip: req.ip,
      path: fullPath,
      method: method,
      hasHeaderToken: !!tokenFromHeader,
      hasCookieToken: !!tokenFromCookie,
      userAgent: req.headers['user-agent'],
      origin: req.headers['origin'],
      referer: req.headers['referer'],
    });
    
    return res.status(403).json({
      status: 'error',
      message: 'Invalid security token. Please refresh the page and try again.',
    });
  }

  // Tokens must match
  if (tokenFromHeader !== tokenFromCookie) {
    // Log security event
    console.warn('[Security] CSRF token validation failed - token mismatch:', {
      ip: req.ip,
      path: fullPath,
      method: method,
      userAgent: req.headers['user-agent'],
      origin: req.headers['origin'],
      referer: req.headers['referer'],
    });
    
    return res.status(403).json({
      status: 'error',
      message: 'Invalid security token. Please refresh the page and try again.',
    });
  }

  // Validation passed
  next();
};

/**
 * Get CSRF token endpoint
 * Frontend should call this to get CSRF token after authentication
 * Returns the token from the cookie (frontend can also read it directly from the cookie)
 */
exports.getCsrfToken = (req, res) => {
  try {
    // Get token from cookie (frontend can also read it directly)
    const token = req.cookies['csrf-token'];
    
    if (!token) {
      // Token not found - user may need to re-authenticate
      console.warn('[CSRF] Token not available in cookie');
      return res.status(404).json({
        status: 'error',
        message: 'CSRF token not found. Please log in again.',
      });
    }
    
    res.status(200).json({
      status: 'success',
      csrfToken: token,
    });
  } catch (error) {
    console.error('[CSRF] Error getting CSRF token:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get CSRF token',
    });
  }
};

/**
 * Clear CSRF token cookie (e.g., on logout)
 * @param {Object} res - Express response object
 */
exports.clearCSRFToken = (res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.clearCookie('csrf-token', {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  });
};

