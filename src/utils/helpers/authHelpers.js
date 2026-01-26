const jwt = require('jsonwebtoken');
const validator = require('validator');
const { createDeviceSession } = require('./createDeviceSession');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

/**
 * Normalize email to lowercase
 * @param {string} email - Email address
 * @returns {string} Normalized email or null
 */
const normalizeEmail = (email) => {
  if (!email) return null;
  return validator.isEmail(email) ? email.toLowerCase().trim() : null;
};

/**
 * Normalize phone number (digits only)
 * @param {string} phone - Phone number
 * @returns {string} Normalized phone or null
 */
const normalizePhone = (phone) => {
  if (!phone) return null;
  return phone.replace(/\D/g, '');
};

/**
 * Get cookie name based on role
 * @param {string} role - User role: 'buyer' | 'seller' | 'admin'
 * @returns {string} Cookie name
 */
const getCookieName = (role) => {
  const cookieMap = {
    buyer: 'main_jwt',
    seller: 'seller_jwt',
    admin: 'admin_jwt',
  };
  return cookieMap[role] || 'main_jwt';
};

/**
 * Get platform name based on role
 * @param {string} role - User role
 * @returns {string} Platform name
 */
const getPlatform = (role) => {
  const platformMap = {
    buyer: 'eazmain',
    seller: 'eazseller',
    admin: 'eazadmin',
  };
  return platformMap[role] || 'eazmain';
};

/**
 * Create JWT token with deviceId
 * @param {string} id - User ID
 * @param {string} role - User role
 * @param {string} deviceId - Device ID (optional)
 * @returns {string} JWT token
 */
const signToken = (id, role, deviceId = null) => {
  // SECURITY NOTE: 90-day JWT expiry is INTENTIONAL for DEVELOPMENT
  // This should be reduced to 1-7 days in production
  const expiresIn = process.env.JWT_EXPIRES_IN || '90d';
  const payload = { id, role };
  if (deviceId) {
    payload.deviceId = deviceId;
  }
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Set JWT cookie with consistent options
 * @param {Object} res - Express response object
 * @param {string} role - User role
 * @param {string} token - JWT token
 */
const setAuthCookie = (res, role, token) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = getCookieName(role);
  
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction, // true in production, false in development
    // CRITICAL: For cross-origin requests (seller.saiisai.com -> api.saiisai.com)
    // sameSite must be 'none' when secure is true
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site in production, 'lax' for same-site in dev
    path: '/',
    expires: new Date(
      Date.now() + (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000
    ), // 90 days default (DEV ONLY)
    // Set domain for production to allow cookie sharing across subdomains
    // IMPORTANT: Use .saiisai.com (with leading dot) to share cookies across all subdomains
    // Only set in production, leave undefined in development (localhost)
    ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  };

  res.cookie(cookieName, token, cookieOptions);
  
  // Debug logging for cookie configuration (production only, non-sensitive)
  if (isProduction) {
    const logger = require('../logger');
    logger.info('[setAuthCookie] Cookie set', {
      cookieName,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      domain: cookieOptions.domain || 'not set',
      hasCookieDomainEnv: !!process.env.COOKIE_DOMAIN,
      cookieDomainEnv: process.env.COOKIE_DOMAIN || 'not set',
    });
  }
};

/**
 * Clear JWT cookie
 * @param {Object} res - Express response object
 * @param {string} role - User role
 */
const clearAuthCookie = (res, role) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = getCookieName(role);
  
  res.cookie(cookieName, 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000), // Expire immediately (10 seconds)
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  });
};

/**
 * Create safe user payload (no sensitive data)
 * @param {Object} user - User/Seller/Admin model instance
 * @param {string} role - User role
 * @returns {Object} Safe user payload
 */
const createSafeUserPayload = (user, role) => {
  const basePayload = {
    id: user._id,
    email: user.email,
    role: user.role || role,
    lastLogin: user.lastLogin,
  };

  // Add role-specific fields
  if (role === 'buyer') {
    return {
      ...basePayload,
      name: user.name,
      phone: user.phone,
      emailVerified: user.emailVerified || false,
      phoneVerified: user.phoneVerified || false,
      isVerified: user.emailVerified || user.phoneVerified || false,
    };
  } else if (role === 'seller') {
    return {
      ...basePayload,
      name: user.name,
      phone: user.phone,
      shopName: user.shopName,
      status: user.status,
      emailVerified: user.verification?.emailVerified || false,
      isVerified: user.verification?.emailVerified || false,
    };
  } else if (role === 'admin') {
    return {
      ...basePayload,
      name: user.name,
    };
  }

  return basePayload;
};

/**
 * Standardized login flow helper
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} user - User/Seller/Admin model instance
 * @param {string} role - User role
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Login result
 */
const handleSuccessfulLogin = async (req, res, user, role, options = {}) => {
  const { skipDeviceSession = false } = options;

  // Create device session
  let sessionData = null;
  if (!skipDeviceSession) {
    try {
      const platform = getPlatform(role);
      sessionData = await createDeviceSession(req, user, platform);
    } catch (deviceError) {
      if (process.env.NODE_ENV === 'production' && deviceError.message?.includes('Too many devices')) {
        throw deviceError;
      }
      // Continue without device session in dev
      console.error('[Auth Helper] Device session creation failed:', deviceError.message);
    }
  }

  // Create JWT token
  const token = signToken(user._id, user.role || role, sessionData?.deviceId);

  // Set cookie
  setAuthCookie(res, role, token);

  // Generate CSRF token on successful authentication
  const { generateCSRFToken } = require('../../middleware/csrf/csrfProtection');
  generateCSRFToken(res);

  // Update last login and last activity
  user.lastLogin = new Date();
  user.lastActivity = Date.now(); // SECURITY FIX #9: Initialize session activity
  await user.save({ validateBeforeSave: false });

  // Create safe user payload
  const safePayload = createSafeUserPayload(user, role);

  // Log activity
  try {
    logActivityAsync({
      userId: user._id,
      role: role,
      action: 'LOGIN',
      description: `${role} logged in with email and password`,
      req,
    });
  } catch (logError) {
    console.error('[Auth Helper] Activity log error:', logError.message);
    // Don't block login if logging fails
  }

  // Build response
  const response = {
    status: 'success',
    message: 'Login successful',
    user: safePayload,
  };

  // Add device session info if created
  if (sessionData) {
    response.deviceId = sessionData.deviceId;
    // refreshToken is stored in device session, not exposed to client
    if (sessionData.suspicious) {
      response.warning = 'New device detected. Please verify this is you.';
    }
  }

  return response;
};

module.exports = {
  normalizeEmail,
  normalizePhone,
  getCookieName,
  getPlatform,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  createSafeUserPayload,
  handleSuccessfulLogin,
};

