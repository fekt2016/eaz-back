const jwt = require('jsonwebtoken');
const DeviceSession = require('../../models/user/deviceSessionModel');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const {
  generateDeviceId,
  detectDeviceType,
  getIpAddress,
  getUserAgent,
  getPlatform,
  isSuspiciousDevice,
} = require('./deviceUtils');
const sendEmail = require('../email/emailService');

/**
 * Create device session and generate tokens with deviceId
 */
exports.createDeviceSession = async (req, user, platform = null) => {
  // Generate device ID
  const deviceId = generateDeviceId();

  // Get device information
  const ipAddress = getIpAddress(req);
  const userAgent = getUserAgent(req);
  const deviceType = detectDeviceType(userAgent);
  const detectedPlatform = platform || getPlatform(req);
  
  // Get location from IP address
  let location = 'Unknown';
  try {
    const { getIpLocation } = require('../../services/securityMonitor');
    location = await getIpLocation(ipAddress);
    console.log('[createDeviceSession] Location detected:', location);
  } catch (locationError) {
    console.error('[createDeviceSession] Error detecting location:', locationError.message);
    location = 'Location Unavailable';
  }

  // Determine user model type
  let userModel = 'User';
  if (user.constructor.modelName === 'Seller') {
    userModel = 'Seller';
  } else if (user.constructor.modelName === 'Admin') {
    userModel = 'Admin';
  }

  // Check device limit (this will work even if collection doesn't exist yet)
  // Only enforce device limit in production
  let deviceLimit;
  if (process.env.NODE_ENV === 'production') {
    try {
      deviceLimit = await DeviceSession.checkDeviceLimit(
        user._id,
        user.role || 'buyer',
        detectedPlatform,
      );
      console.log('[createDeviceSession] Device limit check:', deviceLimit);
    } catch (limitError) {
      console.error('[createDeviceSession] Error checking device limit:', limitError.message);
      // If collection doesn't exist, assume within limit
      deviceLimit = { withinLimit: true, currentCount: 0, limit: 5 };
    }

    if (!deviceLimit.withinLimit) {
      throw new Error(
        `Too many devices. Please logout another device first. Maximum allowed: ${deviceLimit.limit}`,
      );
    }
  } else {
    // In development, skip device limit check
    console.log('[createDeviceSession] Development mode - skipping device limit check');
    deviceLimit = { withinLimit: true, currentCount: 0, limit: 999 };
  }

  // Check if device is suspicious (this will work even if collection doesn't exist yet)
  let suspicious = false;
  try {
    suspicious = await isSuspiciousDevice(
      user._id,
      ipAddress,
      userAgent,
      deviceId,
      DeviceSession,
    );
    console.log('[createDeviceSession] Suspicious device check:', suspicious);
  } catch (suspiciousError) {
    console.error('[createDeviceSession] Error checking suspicious device:', suspiciousError.message);
    // If error, assume not suspicious
    suspicious = false;
  }

  // Generate tokens
  const expiresIn = process.env.JWT_EXPIRES_IN || '90d';
  const accessToken = jwt.sign(
    { id: user._id, role: user.role, deviceId },
    process.env.JWT_SECRET,
    { expiresIn },
  );

  // Generate refresh token (longer expiry)
  const refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '180d';
  const refreshToken = jwt.sign(
    { id: user._id, role: user.role, deviceId, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: refreshTokenExpiresIn },
  );

  // Calculate expiry date (90 days from now)
  const expiresAt = new Date(
    Date.now() + (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000,
  );

  // Create device session
  console.log('[createDeviceSession] Creating device session with data:', {
    userId: user._id,
    userModel,
    deviceId,
    ipAddress,
    deviceType,
    platform: detectedPlatform,
  });

  let deviceSession;
  try {
    deviceSession = await DeviceSession.create({
      userId: user._id,
      userModel,
      deviceId,
      ipAddress,
      userAgent,
      deviceType,
      location, // Set detected location
      loginTime: new Date(),
      lastActivity: new Date(),
      refreshToken, // Will be hashed by pre-save hook
      isActive: true,
      expiresAt,
      platform: detectedPlatform,
    });
    console.log('[createDeviceSession] ✅ Device session created successfully:', deviceSession._id);
  } catch (createError) {
    console.error('[createDeviceSession] ❌ Error creating DeviceSession document:', createError.message);
    console.error('[createDeviceSession] Error details:', {
      name: createError.name,
      code: createError.code,
      errors: createError.errors,
      stack: createError.stack,
    });
    throw createError;
  }

  // Send suspicious device email if needed
  if (suspicious) {
    try {
      await sendEmail({
        email: user.email,
        subject: 'New Device Login Detected - EazShop',
        message: `A new device has logged into your EazShop account.\n\nDevice: ${deviceType}\nIP Address: ${ipAddress}\nTime: ${new Date().toLocaleString()}\n\nIf this wasn't you, please change your password immediately.`,
      });
    } catch (emailError) {
      console.error('Failed to send suspicious device email:', emailError);
    }
  }

  return {
    accessToken,
    refreshToken,
    deviceId,
    deviceSession,
    suspicious,
  };
};

/**
 * Blacklist tokens and deactivate device session
 */
exports.logoutDevice = async (req, deviceId = null) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.eazmain_jwt || req.cookies?.eazseller_jwt || req.cookies?.eazadmin_jwt;
  const userId = req.user?._id || req.user?.id;

  if (!userId) {
    return;
  }

  // Get deviceId from token or request
  let targetDeviceId = deviceId;
  if (!targetDeviceId && token) {
    try {
      const decoded = jwt.decode(token);
      targetDeviceId = decoded?.deviceId;
    } catch (error) {
      console.error('Error decoding token:', error);
    }
  }

  // Find and deactivate device session
  if (targetDeviceId) {
    const session = await DeviceSession.findOne({
      userId,
      deviceId: targetDeviceId,
    });

    if (session) {
      session.isActive = false;
      await session.save();
    }
  }

  // Blacklist tokens
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded) {
        console.log('[logoutDevice] Blacklisting token for user:', userId);
        await TokenBlacklist.blacklistToken(
          token,
          userId,
          decoded.role || 'customer',
          'logout',
        );
        console.log('[logoutDevice] ✅ Token blacklisted successfully');
      }
    } catch (error) {
      console.error('[logoutDevice] ❌ Error blacklisting token:', error.message);
      console.error('[logoutDevice] Error stack:', error.stack);
    }
  }
};

/**
 * Logout all devices except current
 */
exports.logoutOtherDevices = async (req) => {
  const userId = req.user?._id || req.user?.id;
  const currentDeviceId = req.user?.deviceId || req.headers['x-device-id'];

  if (!userId || !currentDeviceId) {
    throw new Error('User ID or device ID not found');
  }

  // Get all other active sessions
  const otherSessions = await DeviceSession.find({
    userId,
    deviceId: { $ne: currentDeviceId },
    isActive: true,
  });

  // Deactivate all other sessions
  await DeviceSession.deactivateOthers(userId, currentDeviceId);

  // Blacklist refresh tokens from other sessions
  // Note: We can't blacklist access tokens we don't have, but we've deactivated sessions
  // The refresh tokens are already hashed in the database

  return otherSessions.length;
};

/**
 * Logout all devices
 */
exports.logoutAllDevices = async (req) => {
  const userId = req.user?._id || req.user?.id;

  if (!userId) {
    throw new Error('User ID not found');
  }

  // Deactivate all sessions
  await DeviceSession.deactivateAll(userId);

  // Blacklist current token
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.eazmain_jwt || req.cookies?.eazseller_jwt || req.cookies?.eazadmin_jwt;
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded) {
        await TokenBlacklist.blacklistToken(
          token,
          userId,
          decoded.role || 'customer',
          'security',
        );
      }
    } catch (error) {
      console.error('Error blacklisting token:', error);
    }
  }

  return true;
};

