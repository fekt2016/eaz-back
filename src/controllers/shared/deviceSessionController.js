const DeviceSession = require('../../models/user/deviceSessionModel');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const { parseUserAgent } = require('../../utils/helpers/deviceUtils');
const { logoutDevice, logoutOtherDevices, logoutAllDevices } = require('../../utils/helpers/createDeviceSession');
const jwt = require('jsonwebtoken');

/**
 * Get all active device sessions for the current user
 * Returns devices from all platforms (saysay, eazmainapp, eazmain, etc.)
 */
exports.getMyDevices = catchAsync(async (req, res, next) => {
  const userId = req.user._id || req.user.id;
  const requestedPlatform = req.headers['x-platform'] || 'eazmain';

  // CRITICAL: Query for all active sessions regardless of platform
  // This ensures users can see all their devices (mobile, web, etc.)
  // If you want platform-specific filtering, pass null to findActiveSessions
  const sessions = await DeviceSession.findActiveSessions(userId, null);
  
  // Log for debugging
  console.log(`[getMyDevices] Found ${sessions.length} active sessions for user ${userId} (requested platform: ${requestedPlatform})`);

  const devices = sessions.map((session) => {
    const uaInfo = parseUserAgent(session.userAgent);
    return {
      deviceId: session.deviceId,
      deviceType: session.deviceType,
      browser: uaInfo.browser,
      os: uaInfo.os,
      device: uaInfo.device,
      ipAddress: session.ipAddress,
      location: session.location || 'Unknown',
      loginTime: session.loginTime,
      lastActivity: session.lastActivity,
      isActive: session.isActive,
      isCurrentDevice: session.deviceId === req.user.deviceId || session.deviceId === req.headers['x-device-id'],
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      devices,
      count: devices.length,
    },
  });
});

/**
 * Logout a specific device
 */
exports.logoutDevice = catchAsync(async (req, res, next) => {
  const { deviceId } = req.params;
  const userId = req.user._id || req.user.id;

  if (!deviceId) {
    return next(new AppError('Device ID is required', 400));
  }

  // Find the device session
  const session = await DeviceSession.findOne({
    userId,
    deviceId,
  });

  if (!session) {
    return next(new AppError('Device session not found', 404));
  }

  // Deactivate session
  session.isActive = false;
  await session.save();

  // Try to blacklist tokens if we have them
  // Note: We can't blacklist access tokens we don't have, but we've deactivated the session
  // The refresh token is already hashed in the database

  res.status(200).json({
    status: 'success',
    message: 'Device logged out successfully',
  });
});

/**
 * Logout all other devices except current
 */
exports.logoutOthers = catchAsync(async (req, res, next) => {
  try {
    const count = await logoutOtherDevices(req);
    res.status(200).json({
      status: 'success',
      message: `Logged out ${count} other device(s)`,
      count,
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to logout other devices', 400));
  }
});

/**
 * Logout all devices (including current)
 */
exports.logoutAll = catchAsync(async (req, res, next) => {
  try {
    await logoutAllDevices(req);

    // Clear JWT cookie - use path when available so admin/seller logout clear correct cookie
    const isProduction = process.env.NODE_ENV === 'production';
    const path = req.path || '';
    let cookieName = 'main_jwt';
    if (path.includes('/admin/')) {
      cookieName = 'admin_jwt';
    } else if (path.includes('/seller/')) {
      cookieName = 'seller_jwt';
    } else {
      cookieName = req.headers['x-platform'] === 'eazseller' ? 'seller_jwt' :
                  req.headers['x-platform'] === 'eazadmin' ? 'admin_jwt' : 'main_jwt';
    }

    res.cookie(cookieName, 'loggedout', {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.status(200).json({
      status: 'success',
      message: 'All devices logged out successfully',
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to logout all devices', 400));
  }
});

