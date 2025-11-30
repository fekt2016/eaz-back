const ActivityLog = require('../../models/activityLog/activityLogModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/**
 * Get paginated activity logs
 * GET /api/v1/logs
 */
exports.getActivityLogs = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  // Build filter
  const filter = {};

  // Role filter
  if (req.query.role) {
    filter.role = req.query.role;
  }

  // Platform filter
  if (req.query.platform) {
    filter.platform = req.query.platform;
  }

  // Activity type filter
  if (req.query.activityType) {
    filter.activityType = req.query.activityType;
  }

  // Risk level filter
  if (req.query.riskLevel) {
    filter.riskLevel = req.query.riskLevel;
  }

  // Date range filter
  if (req.query.startDate || req.query.endDate) {
    filter.timestamp = {};
    if (req.query.startDate) {
      filter.timestamp.$gte = new Date(req.query.startDate);
    }
    if (req.query.endDate) {
      filter.timestamp.$lte = new Date(req.query.endDate);
    }
  }

  // Search filter (action, description, ipAddress, or userAgent)
  if (req.query.search) {
    filter.$or = [
      { action: { $regex: req.query.search, $options: 'i' } },
      { description: { $regex: req.query.search, $options: 'i' } },
      { ipAddress: { $regex: req.query.search, $options: 'i' } },
      { userAgent: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  // User filter
  if (req.query.userId) {
    filter.userId = req.query.userId;
  }

  // Execute query
  const logs = await ActivityLog.find(filter)
    .populate({
      path: 'userId',
      select: 'name email phone shopName',
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Get total count
  const total = await ActivityLog.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: logs.length,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    data: {
      logs,
    },
  });
});

/**
 * Get single activity log
 * GET /api/v1/logs/:id
 */
exports.getActivityLog = catchAsync(async (req, res, next) => {
  const log = await ActivityLog.findById(req.params.id).populate({
    path: 'userId',
    select: 'name email phone shopName',
  });

  if (!log) {
    return next(new AppError('Activity log not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      log,
    },
  });
});

/**
 * Delete single activity log
 * DELETE /api/v1/logs/:id
 */
exports.deleteActivityLog = catchAsync(async (req, res, next) => {
  const log = await ActivityLog.findByIdAndDelete(req.params.id);

  if (!log) {
    return next(new AppError('Activity log not found', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

/**
 * Delete all activity logs
 * DELETE /api/v1/logs
 */
exports.deleteAllActivityLogs = catchAsync(async (req, res, next) => {
  const result = await ActivityLog.deleteMany({});

  res.status(200).json({
    status: 'success',
    message: `Deleted ${result.deletedCount} activity logs`,
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

/**
 * Delete logs older than specified days
 * DELETE /api/v1/logs/cleanup?days=30
 */
exports.cleanupOldLogs = catchAsync(async (req, res, next) => {
  const days = parseInt(req.query.days) || 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const result = await ActivityLog.deleteMany({
    timestamp: { $lt: cutoffDate },
  });

  res.status(200).json({
    status: 'success',
    message: `Deleted ${result.deletedCount} logs older than ${days} days`,
    data: {
      deletedCount: result.deletedCount,
      cutoffDate,
    },
  });
});

/**
 * Get activity statistics
 * GET /api/v1/logs/stats
 */
exports.getActivityStats = catchAsync(async (req, res, next) => {
  const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

  const filter = {
    timestamp: { $gte: startDate, $lte: endDate },
  };

  // Total logs
  const totalLogs = await ActivityLog.countDocuments(filter);

  // Logs by role
  const logsByRole = await ActivityLog.aggregate([
    { $match: filter },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);

  // Logs by platform
  const logsByPlatform = await ActivityLog.aggregate([
    { $match: filter },
    { $group: { _id: '$platform', count: { $sum: 1 } } },
  ]);

  // Top actions
  const topActions = await ActivityLog.aggregate([
    { $match: filter },
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Logs by day
  const logsByDay = await ActivityLog.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      period: {
        startDate,
        endDate,
      },
      totalLogs,
      logsByRole,
      logsByPlatform,
      topActions,
      logsByDay,
    },
  });
});

/**
 * Get suspicious activity logs (high/critical risk)
 * GET /api/v1/logs/suspicious
 */
exports.getSuspiciousActivity = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  // Build filter for suspicious activities
  const filter = {
    riskLevel: { $in: ['high', 'critical'] },
  };

  // Role filter
  if (req.query.role) {
    filter.role = req.query.role;
  }

  // Activity type filter
  if (req.query.activityType) {
    filter.activityType = req.query.activityType;
  }

  // Date range filter
  if (req.query.startDate || req.query.endDate) {
    filter.timestamp = {};
    if (req.query.startDate) {
      filter.timestamp.$gte = new Date(req.query.startDate);
    }
    if (req.query.endDate) {
      filter.timestamp.$lte = new Date(req.query.endDate);
    }
  }

  // User filter
  if (req.query.userId) {
    filter.userId = req.query.userId;
  }

  // Execute query
  const logs = await ActivityLog.find(filter)
    .populate({
      path: 'userId',
      select: 'name email phone shopName',
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Get total count
  const total = await ActivityLog.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: logs.length,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    data: {
      logs,
    },
  });
});

/**
 * Get IP and device history for a user
 * GET /api/v1/logs/user/:userId/history
 */
exports.getUserSecurityHistory = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 100;

  // Get all login activities for this user
  const loginLogs = await ActivityLog.find({
    userId,
    activityType: 'LOGIN',
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('ipAddress userAgent location riskLevel timestamp platform')
    .lean();

  // Get unique IPs
  const uniqueIps = [...new Set(loginLogs.map(log => log.ipAddress).filter(Boolean))];
  
  // Get unique devices
  const uniqueDevices = [...new Set(loginLogs.map(log => log.userAgent).filter(Boolean))];

  // Get risk level counts
  const riskCounts = loginLogs.reduce((acc, log) => {
    acc[log.riskLevel] = (acc[log.riskLevel] || 0) + 1;
    return acc;
  }, {});

  res.status(200).json({
    status: 'success',
    data: {
      loginHistory: loginLogs,
      uniqueIps,
      uniqueDevices,
      riskCounts,
      totalLogins: loginLogs.length,
    },
  });
});

