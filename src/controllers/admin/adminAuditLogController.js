const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const AdminActionLog = require('../../models/admin/adminActionLogModel');
const Admin = require('../../models/user/adminModel');


exports.getAdminAuditLogs = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    actionType,
    adminId,
    role,
    sellerId,
    withdrawalId,
    startDate,
    endDate,
    search,
  } = req.query;

  // Build query
  const query = {};

  if (actionType) {
    query.actionType = actionType;
  }

  if (adminId) {
    query.adminId = adminId;
  }

  if (role) {
    query.role = role;
  }

  if (sellerId) {
    query.sellerId = sellerId;
  }

  if (withdrawalId) {
    query.withdrawalId = withdrawalId;
  }

  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) {
      query.timestamp.$gte = new Date(startDate);
    }
    if (endDate) {
      query.timestamp.$lte = new Date(endDate);
    }
  }

  // Search in admin name or email
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get logs with populated seller info
  const logs = await AdminActionLog.find(query)
    .populate({
      path: 'sellerId',
      select: 'name shopName email',
    })
    .populate({
      path: 'adminId',
      select: 'name email role',
    })
    .sort('-timestamp')
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  const total = await AdminActionLog.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: logs.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / parseInt(limit)),
    data: {
      logs,
    },
  });
});

/**
 * Get a single audit log by ID
 * GET /api/v1/admin/audit-logs/:id
 */
exports.getAdminAuditLog = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const log = await AdminActionLog.findById(id)
    .populate({
      path: 'sellerId',
      select: 'name shopName email',
    })
    .populate({
      path: 'adminId',
      select: 'name email role',
    })
    .lean();

  if (!log) {
    return next(new AppError('Audit log not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      log,
    },
  });
});

/**
 * Clear audit logs (only superadmin)
 * PUT /api/v1/admin/audit-logs/clear
 * This should be protected by restrictTo('superadmin') middleware
 */
exports.clearAuditLogs = catchAsync(async (req, res, next) => {
  // This is a dangerous operation - only superadmin can do this
  // In production, you might want to archive logs instead of deleting
  const { confirm } = req.body;

  if (confirm !== 'DELETE_ALL_LOGS') {
    return next(new AppError('Confirmation required. Send confirm: "DELETE_ALL_LOGS"', 400));
  }

  const result = await AdminActionLog.deleteMany({});

  res.status(200).json({
    status: 'success',
    message: `Deleted ${result.deletedCount} audit log entries`,
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

/**
 * Get audit statistics
 * GET /api/v1/admin/audit-logs/stats
 */
exports.getAuditStats = catchAsync(async (req, res, next) => {
  const stats = await AdminActionLog.aggregate([
    {
      $group: {
        _id: '$actionType',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amountRequested' },
      },
    },
  ]);

  const roleStats = await AdminActionLog.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
      },
    },
  ]);

  const totalLogs = await AdminActionLog.countDocuments();

  res.status(200).json({
    status: 'success',
    data: {
      totalLogs,
      actionTypeStats: stats,
      roleStats: roleStats,
    },
  });
});

