const DeviceSession = require('../../models/user/deviceSessionModel');
const AppError = require('../../utils/errors/appError');
const { getIpAddress } = require('../../utils/helpers/deviceUtils');
const catchAsync = require('../../utils/helpers/catchAsync');
const logger = require('../../utils/logger');

/**
 * Middleware to track session activity on every protected route
 * Updates lastActivity and IP address if changed
 * DISABLED in development mode for performance
 */
exports.trackSessionActivity = catchAsync(async (req, res, next) => {
  // Skip tracking in development mode
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // Skip if no user (shouldn't happen if middleware is placed correctly)
  if (!req.user) {
    return next();
  }

  // Get deviceId from JWT payload
  const decoded = req.user._id ? null : req.user; // If req.user is already decoded token
  let deviceId;

  // Try to get deviceId from different sources
  if (req.user.deviceId) {
    deviceId = req.user.deviceId;
  } else if (req.headers['x-device-id']) {
    deviceId = req.headers['x-device-id'];
  } else if (decoded && decoded.deviceId) {
    deviceId = decoded.deviceId;
  } else {
    // If no deviceId, try to find active session for this user
    // This handles cases where deviceId might not be in token
    const activeSession = await DeviceSession.findOne({
      userId: req.user._id || req.user.id,
      isActive: true,
    }).sort({ lastActivity: -1 });

    if (!activeSession) {
      return next(
        new AppError('No active session found. Please log in again.', 401),
      );
    }

    deviceId = activeSession.deviceId;
  }

  if (!deviceId) {
    return next(
      new AppError('Device session not found. Please log in again.', 401),
    );
  }

  // Find the device session
  const session = await DeviceSession.findOne({
    userId: req.user._id || req.user.id,
    deviceId,
    isActive: true,
  });

  if (!session) {
    return next(
      new AppError('Session not found or inactive. Please log in again.', 401),
    );
  }

  // Check if session is expired
  if (session.expiresAt < new Date()) {
    session.isActive = false;
    await session.save();
    return next(
      new AppError('Session expired. Please log in again.', 401),
    );
  }

  // Check if session is inactive (30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (session.lastActivity < thirtyDaysAgo) {
    session.isActive = false;
    await session.save();
    return next(
      new AppError('Session inactive. Please log in again.', 401),
    );
  }

  // Update last activity
  const currentIp = getIpAddress(req);
  session.lastActivity = new Date();

  // Update IP if changed
  if (session.ipAddress !== currentIp) {
    session.ipAddress = currentIp;
    
    // Update location when IP changes
    try {
      const { getIpLocation } = require('../../services/securityMonitor');
      const newLocation = await getIpLocation(currentIp);
      if (newLocation && newLocation !== 'Unknown Location' && newLocation !== 'Location Unavailable') {
        session.location = newLocation;
        logger.info(`[trackSessionActivity] Location updated: ${newLocation}`);
      }
    } catch (locationError) {
      logger.error('[trackSessionActivity] Error updating location:', locationError.message);
    }
  }

  // Update location if it's missing or "Unknown"
  if (!session.location || session.location === 'Unknown' || session.location === 'Unknown Location') {
    try {
      const { getIpLocation } = require('../../services/securityMonitor');
      const detectedLocation = await getIpLocation(session.ipAddress);
      if (detectedLocation && detectedLocation !== 'Unknown Location' && detectedLocation !== 'Location Unavailable') {
        session.location = detectedLocation;
        logger.info(`[trackSessionActivity] Location detected and updated: ${detectedLocation}`);
      }
    } catch (locationError) {
      logger.error('[trackSessionActivity] Error detecting location:', locationError.message);
    }
  }

  // Save session (without triggering hooks unnecessarily)
  await session.save({ validateBeforeSave: false });

  // Attach session info to request for use in controllers
  req.deviceSession = session;

  next();
});

