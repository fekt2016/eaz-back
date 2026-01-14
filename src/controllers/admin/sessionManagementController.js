const DeviceSession = require('../../models/user/deviceSessionModel');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const User = require('../../models/user/userModel');
const Seller = require('../../models/user/sellerModel');
const Admin = require('../../models/user/adminModel');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const { parseUserAgent } = require('../../utils/helpers/deviceUtils');
const { safeFs, safePath } = require('../../utils/safePath');

/**
 * Get all sessions with filters (Admin only)
 */
exports.getAllSessions = catchAsync(async (req, res, next) => {
  const {
    userId,
    status,
    deviceType,
    suspicious,
    platform,
    page = 1,
    limit = 50,
  } = req.query;

  console.log('[getAllSessions] Query params:', { userId, status, deviceType, suspicious, platform, page, limit });

  // Build query
  const query = {};

  if (userId) {
    query.userId = userId;
  }

  if (status === 'active') {
    query.isActive = true;
  } else if (status === 'inactive') {
    query.isActive = false;
  }

  if (deviceType) {
    query.deviceType = deviceType;
  }

  if (platform) {
    query.platform = platform;
  }

  console.log('[getAllSessions] MongoDB query:', JSON.stringify(query));

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get total count first
  const total = await DeviceSession.countDocuments(query);
  console.log('[getAllSessions] Total sessions found:', total);

  // Get sessions
  let sessions = await DeviceSession.find(query)
    .sort({ lastActivity: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  console.log('[getAllSessions] Sessions retrieved:', sessions.length);

  // Filter suspicious sessions if requested
  if (suspicious === 'true') {
    // A session is suspicious if it has a new IP, new user-agent, or new device
    // This is a simplified check - in production, you might want more sophisticated logic
    sessions = sessions.filter((session) => {
      // Check if this is the only session for this user (new device)
      // This is a simplified check
      return true; // For now, return all - implement more sophisticated logic as needed
    });
  }

  // Populate user information
  const sessionsWithUsers = await Promise.all(
    sessions.map(async (session) => {
      let user;
      if (session.userModel === 'User') {
        user = await User.findById(session.userId).select('name email phone');
      } else if (session.userModel === 'Seller') {
        user = await Seller.findById(session.userId).select('name email shopName');
      } else if (session.userModel === 'Admin') {
        user = await Admin.findById(session.userId).select('name email');
      }

      const uaInfo = parseUserAgent(session.userAgent);
      return {
        sessionId: session._id,
        deviceId: session.deviceId,
        user: user || { id: session.userId },
        userModel: session.userModel,
        deviceType: session.deviceType,
        browser: uaInfo.browser,
        os: uaInfo.os,
        device: uaInfo.device,
        ipAddress: session.ipAddress,
        location: session.location || 'Unknown',
        loginTime: session.loginTime,
        lastActivity: session.lastActivity,
        isActive: session.isActive,
        platform: session.platform,
        expiresAt: session.expiresAt,
      };
    }),
  );

  console.log('[getAllSessions] Returning sessions:', {
    count: sessionsWithUsers.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  });

  res.status(200).json({
    status: 'success',
    results: sessionsWithUsers.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    data: {
      sessions: sessionsWithUsers,
      total, // Also include total in data for frontend compatibility
    },
  });
});

/**
 * Force logout a specific device (Admin only)
 */
exports.forceLogoutDevice = catchAsync(async (req, res, next) => {
  const { deviceId } = req.params;

  if (!deviceId) {
    return next(new AppError('Device ID is required', 400));
  }

  // Find and deactivate session
  const session = await DeviceSession.findOne({ deviceId });

  if (!session) {
    return next(new AppError('Device session not found', 404));
  }

  // Get the token from the session if available (for blacklisting)
  // Note: We can't get the actual token, but we can deactivate the session
  session.isActive = false;
  await session.save();

  // Log admin action
  console.log(`[Admin] Force logged out device: ${deviceId} for user: ${session.userId}`);

  res.status(200).json({
    status: 'success',
    message: 'Device logged out successfully',
    data: {
      deviceId,
      userId: session.userId,
    },
  });
});

/**
 * Force logout all sessions for a specific user (Admin only)
 */
exports.forceLogoutUser = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  // Deactivate all sessions for this user
  const result = await DeviceSession.deactivateAll(userId);

  // Invalidate all tokens for this user
  await TokenBlacklist.invalidateAllSessions(userId);

  console.log(`[Admin] Force logged out all devices for user: ${userId}`);

  res.status(200).json({
    status: 'success',
    message: `All sessions logged out for user ${userId}`,
    data: {
      userId,
      sessionsDeactivated: result.modifiedCount,
    },
  });
});

/**
 * Get sessions for a specific user (Admin only)
 */
exports.getUserSessions = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { status, platform } = req.query;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  const query = { userId };

  if (status === 'active') {
    query.isActive = true;
  } else if (status === 'inactive') {
    query.isActive = false;
  }

  if (platform) {
    query.platform = platform;
  }

  const sessions = await DeviceSession.find(query)
    .sort({ lastActivity: -1 });

  // Get user info
  let user;
  const firstSession = sessions[0];
  if (firstSession) {
    if (firstSession.userModel === 'User') {
      user = await User.findById(userId).select('name email phone');
    } else if (firstSession.userModel === 'Seller') {
      user = await Seller.findById(userId).select('name email shopName');
    } else if (firstSession.userModel === 'Admin') {
      user = await Admin.findById(userId).select('name email');
    }
  }

  const sessionsWithInfo = sessions.map((session) => {
    const uaInfo = parseUserAgent(session.userAgent);
    return {
      sessionId: session._id,
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
      platform: session.platform,
      expiresAt: session.expiresAt,
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: user || { id: userId },
      sessions: sessionsWithInfo,
      count: sessionsWithInfo.length,
    },
  });
});

/**
 * Get suspicious logins (Admin only)
 */
exports.getSuspiciousLogins = catchAsync(async (req, res, next) => {
  // Get sessions with multiple IPs or new devices
  // This is a simplified implementation
  const sessions = await DeviceSession.find({ isActive: true })
    .sort({ loginTime: -1 })
    .limit(100);

  // Group by user to find suspicious patterns
  const userSessions = {};
  sessions.forEach((session) => {
    if (!userSessions[session.userId]) {
      userSessions[session.userId] = [];
    }
    userSessions[session.userId].push(session);
  });

  // Find users with multiple IPs or devices
  const suspicious = [];
  for (const [userId, userSess] of Object.entries(userSessions)) {
    const uniqueIPs = new Set(userSess.map((s) => s.ipAddress));
    const uniqueDevices = new Set(userSess.map((s) => s.deviceId));

    if (uniqueIPs.size > 3 || uniqueDevices.size > 5) {
      suspicious.push({
        userId,
        ipCount: uniqueIPs.size,
        deviceCount: uniqueDevices.size,
        sessions: userSess.length,
      });
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      suspicious,
      count: suspicious.length,
    },
  });
});

/**
 * Get cron cleanup logs (Admin only)
 */
exports.getCleanupLogs = catchAsync(async (req, res, next) => {
  // USE SAFE VERSIONS - never crashes
  const logFile = safePath.joinSafe(__dirname, '../../../logs/cron.log');

  if (!logFile) {
    return res.status(200).json({
      status: 'success',
      data: {
        logs: [],
        message: 'Failed to resolve log file path',
      },
    });
  }

  if (!safeFs.existsSyncSafe(logFile, { label: 'cron log file' })) {
    return res.status(200).json({
      status: 'success',
      data: {
        logs: [],
        message: 'No cleanup logs found',
      },
    });
  }

  const logContent = safeFs.readFileSyncSafe(logFile, 'utf8', { label: 'cron log file' });
  if (!logContent) {
    return res.status(200).json({
      status: 'success',
      data: {
        logs: [],
        message: 'Failed to read log file',
      },
    });
  }

  const logs = logContent.split('\n').filter((line) => line.trim());

  // Get last 100 lines
  const recentLogs = logs.slice(-100).reverse();

  res.status(200).json({
    status: 'success',
    data: {
      logs: recentLogs,
      count: recentLogs.length,
    },
  });
});

