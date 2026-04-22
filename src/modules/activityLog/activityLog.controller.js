const ActivityLog = require('../../models/activityLog/activityLogModel');
const ScreenViewEvent = require('../../models/analytics/screenViewEventModel');
const User = require('../../models/user/userModel');
const Seller = require('../../models/user/sellerModel');
const Admin = require('../../models/user/adminModel');
const logger = require('../../utils/logger');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

const buildActivityLogFilter = (query = {}) => {
  const filter = {};

  if (query.role) {
    filter.role = query.role;
  }

  if (query.platform) {
    filter.platform = query.platform;
  }

  if (query.activityType) {
    filter.activityType = query.activityType;
  }

  if (query.riskLevel) {
    filter.riskLevel = query.riskLevel;
  }

  if (query.startDate || query.endDate) {
    filter.timestamp = {};
    if (query.startDate) {
      filter.timestamp.$gte = new Date(query.startDate);
    }
    if (query.endDate) {
      filter.timestamp.$lte = new Date(query.endDate);
    }
  }

  if (query.search) {
    filter.$or = [
      { action: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
      { ipAddress: { $regex: query.search, $options: 'i' } },
      { userAgent: { $regex: query.search, $options: 'i' } },
    ];
  }

  if (query.userId) {
    filter.userId = query.userId;
  }

  return filter;
};

const SCREEN_VIEW_PREFIX = 'Viewed screen: ';
const SCREEN_VIEW_PREFIX_LENGTH = SCREEN_VIEW_PREFIX.length;

/**
 * Get paginated activity logs
 * GET /api/v1/logs
 */
exports.getActivityLogs = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const filter = buildActivityLogFilter(req.query);

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
 * Get homepage experiment analytics from activity logs
 * GET /api/v1/logs/stats/homepage-experiments
 */
exports.getHomepageExperimentStats = catchAsync(async (req, res, next) => {
  // Preferred source: dedicated screen view events (includes anonymous traffic).
  const requestedRole =
    typeof req.query.role === 'string' && req.query.role.trim()
      ? req.query.role.trim().toLowerCase()
      : null;
  const screenFilter = {
    screen: { $regex: '^home(?::|$)', $options: 'i' },
  };
  if (req.query.platform) {
    screenFilter.platform = req.query.platform;
  }
  if (req.query.startDate || req.query.endDate) {
    screenFilter.viewedAt = {};
    if (req.query.startDate) {
      screenFilter.viewedAt.$gte = new Date(req.query.startDate);
    }
    if (req.query.endDate) {
      screenFilter.viewedAt.$lte = new Date(req.query.endDate);
    }
  }
  if (req.query.search) {
    screenFilter.screen = {
      $regex: req.query.search,
      $options: 'i',
    };
  }

  const screenResults = await ScreenViewEvent.aggregate([
    { $match: screenFilter },
    {
      $addFields: {
        __parts: { $split: ['$screen', ':'] },
        actorRole: {
          $cond: [
            {
              $and: [
                { $ne: ['$role', null] },
                { $ne: [{ $toLower: '$role' }, 'guest'] },
              ],
            },
            { $toLower: '$role' },
            {
              $switch: {
                branches: [
                  { case: { $eq: ['$platform', 'eazseller'] }, then: 'seller' },
                  { case: { $eq: ['$platform', 'eazadmin'] }, then: 'admin' },
                ],
                default: 'buyer',
              },
            },
          ],
        },
      },
    },
    ...(requestedRole
      ? [
          {
            $match: {
              $expr: { $eq: ['$actorRole', requestedRole] },
            },
          },
        ]
      : []),
    {
      $match: {
        $expr: {
          $eq: [{ $toLower: { $arrayElemAt: ['$__parts', 0] } }, 'home'],
        },
      },
    },
    {
      $project: {
        eventName: {
          $toLower: {
            $ifNull: [{ $arrayElemAt: ['$__parts', 1] }, 'unknown'],
          },
        },
        variant: {
          $toUpper: {
            $ifNull: [{ $arrayElemAt: ['$__parts', 2] }, 'UNKNOWN'],
          },
        },
        actorRole: 1,
        dateKey: {
          $dateToString: { format: '%Y-%m-%d', date: '$viewedAt' },
        },
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalEvents: { $sum: 1 },
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
        ],
        byVariant: [
          {
            $group: {
              _id: '$variant',
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byDay: [
          {
            $group: {
              _id: '$dateKey',
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byRole: [
          {
            $group: {
              _id: '$actorRole',
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const screenAggregate = screenResults[0] || {};
  const screenTotals = screenAggregate.totals?.[0] || {
    totalEvents: 0,
    impressions: 0,
    interactions: 0,
  };

  // Fallback source: ActivityLog (legacy, authenticated-only path).
  const filter = buildActivityLogFilter(req.query);
  if (requestedRole) {
    filter.role = requestedRole;
  }
  filter.$or = [
    { description: { $regex: '^Viewed screen:\\s*home(?::|$)', $options: 'i' } },
    { 'metadata.screen': { $regex: '^home(?::|$)', $options: 'i' } },
  ];

  const results = await ActivityLog.aggregate([
    { $match: filter },
    {
      $addFields: {
        __screen: {
          $trim: {
            input: {
              $ifNull: [
                '$metadata.screen',
                {
                  $substrCP: [
                    '$description',
                    SCREEN_VIEW_PREFIX_LENGTH,
                    { $strLenCP: '$description' },
                  ],
                },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        __parts: { $split: ['$__screen', ':'] },
        actorRole: {
          $cond: [
            {
              $and: [
                { $ne: ['$role', null] },
                { $ne: ['$role', ''] },
                { $ne: [{ $toLower: '$role' }, 'guest'] },
              ],
            },
            { $toLower: '$role' },
            {
              $switch: {
                branches: [
                  { case: { $eq: ['$platform', 'eazseller'] }, then: 'seller' },
                  { case: { $eq: ['$platform', 'eazadmin'] }, then: 'admin' },
                ],
                default: 'buyer',
              },
            },
          ],
        },
      },
    },
    {
      $match: {
        $expr: {
          $eq: [{ $toLower: { $arrayElemAt: ['$__parts', 0] } }, 'home'],
        },
      },
    },
    {
      $project: {
        eventName: {
          $toLower: {
            $ifNull: [{ $arrayElemAt: ['$__parts', 1] }, 'unknown'],
          },
        },
        variant: {
          $toUpper: {
            $ifNull: [{ $arrayElemAt: ['$__parts', 2] }, 'UNKNOWN'],
          },
        },
        actorRole: 1,
        dateKey: {
          $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
        },
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalEvents: { $sum: 1 },
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
        ],
        byVariant: [
          {
            $group: {
              _id: '$variant',
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byDay: [
          {
            $group: {
              _id: '$dateKey',
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byRole: [
          {
            $group: {
              _id: '$actorRole',
              impressions: {
                $sum: {
                  $cond: [{ $eq: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
              interactions: {
                $sum: {
                  $cond: [{ $ne: ['$eventName', 'variant_seen'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const aggregate = results[0] || {};
  const totals = aggregate.totals?.[0] || {
    totalEvents: 0,
    impressions: 0,
    interactions: 0,
  };

  const useScreenSource = (screenTotals.totalEvents || 0) > 0;
  const selectedAggregate = useScreenSource ? screenAggregate : aggregate;
  const selectedTotals = useScreenSource ? screenTotals : totals;
  let selectedByRole = Array.isArray(selectedAggregate.byRole)
    ? selectedAggregate.byRole
    : [];
  if (selectedByRole.length === 0 && (selectedTotals.totalEvents || 0) > 0) {
    const inferredRole = requestedRole
      || (req.query.platform === 'eazseller'
        ? 'seller'
        : req.query.platform === 'eazadmin'
          ? 'admin'
          : 'buyer');
    selectedByRole = [
      {
        _id: inferredRole,
        impressions: selectedTotals.impressions || 0,
        interactions: selectedTotals.interactions || 0,
      },
    ];
  }

  if (process.env.NODE_ENV !== 'production') {
    logger.info(
      '[HomepageExperimentStats] source=%s total=%d impressions=%d interactions=%d byRole=%j',
      useScreenSource ? 'screen_events' : 'activity_log',
      selectedTotals.totalEvents || 0,
      selectedTotals.impressions || 0,
      selectedTotals.interactions || 0,
      selectedByRole
    );
  }

  const ctr =
    selectedTotals.impressions > 0
      ? (selectedTotals.interactions / selectedTotals.impressions) * 100
      : 0;

  res.status(200).json({
    status: 'success',
    data: {
      totalEvents: selectedTotals.totalEvents || 0,
      impressions: selectedTotals.impressions || 0,
      interactions: selectedTotals.interactions || 0,
      ctr,
      byVariant: (selectedAggregate.byVariant || []).map((item) => ({
        variant: item._id || 'UNKNOWN',
        impressions: item.impressions || 0,
        interactions: item.interactions || 0,
      })),
      byDay: (selectedAggregate.byDay || []).map((item) => ({
        date: item._id,
        impressions: item.impressions || 0,
        interactions: item.interactions || 0,
      })),
      byRole: selectedByRole.map((item) => ({
        role: item._id || 'guest',
        impressions: item.impressions || 0,
        interactions: item.interactions || 0,
      })),
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

  const loginMatch = {
    ...filter,
    $or: [{ action: 'LOGIN' }, { activityType: 'LOGIN' }],
  };

  const totalLogins = await ActivityLog.countDocuments(loginMatch);

  const loginByRoleRaw = await ActivityLog.aggregate([
    { $match: loginMatch },
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        users: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        _id: 1,
        count: 1,
        uniqueUsers: { $size: '$users' },
      },
    },
  ]);

  const loginRoleMap = loginByRoleRaw.reduce((acc, row) => {
    const role = row?._id || 'unknown';
    acc[role] = {
      count: row?.count || 0,
      uniqueUsers: row?.uniqueUsers || 0,
    };
    return acc;
  }, {});

  const buyerLogins = loginRoleMap.buyer?.count || 0;
  const sellerLogins = loginRoleMap.seller?.count || 0;
  const adminLogins = loginRoleMap.admin?.count || 0;

  // Fallback source: role-specific account lastLogin timestamps.
  // This keeps buyer/seller/admin login cards useful even when
  // historical ActivityLog LOGIN events are sparse.
  const lastLoginFilter = {
    lastLogin: { $gte: startDate, $lte: endDate },
  };
  const [
    buyerLastLoginUsers,
    sellerLastLoginUsers,
    adminLastLoginUsers,
  ] = await Promise.all([
    User.countDocuments(lastLoginFilter),
    Seller.countDocuments(lastLoginFilter),
    Admin.countDocuments(lastLoginFilter),
  ]);

  const buyerEffectiveLogins = Math.max(buyerLogins, buyerLastLoginUsers);
  const sellerEffectiveLogins = Math.max(sellerLogins, sellerLastLoginUsers);
  const adminEffectiveLogins = Math.max(adminLogins, adminLastLoginUsers);
  const totalEffectiveLogins =
    buyerEffectiveLogins + sellerEffectiveLogins + adminEffectiveLogins;

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
      loginStats: {
        totalLogins: totalEffectiveLogins || totalLogins,
        buyerLogins: buyerEffectiveLogins,
        sellerLogins: sellerEffectiveLogins,
        adminLogins: adminEffectiveLogins,
        buyerUniqueUsers: Math.max(
          loginRoleMap.buyer?.uniqueUsers || 0,
          buyerLastLoginUsers
        ),
        sellerUniqueUsers: Math.max(
          loginRoleMap.seller?.uniqueUsers || 0,
          sellerLastLoginUsers
        ),
        adminUniqueUsers: Math.max(
          loginRoleMap.admin?.uniqueUsers || 0,
          adminLastLoginUsers
        ),
        buyerSharePct:
          totalEffectiveLogins > 0
            ? (buyerEffectiveLogins / totalEffectiveLogins) * 100
            : 0,
        sellerSharePct:
          totalEffectiveLogins > 0
            ? (sellerEffectiveLogins / totalEffectiveLogins) * 100
            : 0,
        adminSharePct:
          totalEffectiveLogins > 0
            ? (adminEffectiveLogins / totalEffectiveLogins) * 100
            : 0,
      },
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

