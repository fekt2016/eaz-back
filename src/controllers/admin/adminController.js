const mongoose = require('mongoose');
const Admin = require('../../models/user/adminModel');
const ActivityLog = require('../../models/activityLog/activityLogModel');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const handleFactory = require('../shared/handleFactory');

exports.getMe = catchAsync(async (req, res, next) => {
  try {
    // Use lean() to avoid building full Mongoose documents – this keeps
    // /admin/me fast and reduces memory/CPU under heavy load.
    const data = await Admin.findById(req.user.id)
      .populate('createdBy', 'name email role')
      .lean();
    if (!data) return next(new AppError('User with the ID does not exits', 404));
    return res.status(200).json({
      status: 'success',
      data: {
        data,
      },
    });
  } catch (error) {
    // Defensive guard so this endpoint never hangs and contributes to timeouts.
    return next(new AppError('Failed to fetch admin data', 500));
  }
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  const admin = await Admin.findByIdAndUpdate(req.user.id, { active: false });

  if (!admin) return next(new AppError('User with the ID does not exits', 404));

  res.status(204).json({data: null, status: 'success'});
});

/**
 * GET /api/v1/admin/me/activity-analytics
 * Logged-in admin/support_agent: analytics from ActivityLog rows for this account
 * on the admin panel (eazadmin) only — not other users' data.
 */
exports.getMyActivityAnalytics = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new AppError('Invalid session', 400));
  }
  const oid = new mongoose.Types.ObjectId(userId);

  const now = new Date();
  const d7 = new Date(now);
  d7.setDate(d7.getDate() - 7);
  d7.setHours(0, 0, 0, 0);
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);
  d30.setHours(0, 0, 0, 0);
  const d14 = new Date(now);
  d14.setDate(d14.getDate() - 14);
  d14.setHours(0, 0, 0, 0);

  const baseMatch = {
    userId: oid,
    userModel: 'Admin',
    platform: 'eazadmin',
  };

  const [agg] = await ActivityLog.aggregate([
    { $match: baseMatch },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalAllTime: { $sum: 1 },
              last7Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', d7] }, 1, 0] },
              },
              last30Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', d30] }, 1, 0] },
              },
            },
          },
        ],
        byActivityType: [
          { $match: { timestamp: { $gte: d30 } } },
          { $group: { _id: '$activityType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        byAction: [
          { $match: { timestamp: { $gte: d30 } } },
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 12 },
        ],
        byDay: [
          { $match: { timestamp: { $gte: d14 } } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        recent: [
          { $sort: { timestamp: -1 } },
          { $limit: 20 },
          {
            $project: {
              action: 1,
              description: 1,
              activityType: 1,
              timestamp: 1,
              ipAddress: 1,
              riskLevel: 1,
            },
          },
        ],
      },
    },
  ]);

  const totals = agg.totals?.[0] || {
    totalAllTime: 0,
    last7Days: 0,
    last30Days: 0,
  };

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalAllTime: totals.totalAllTime || 0,
        last7Days: totals.last7Days || 0,
        last30Days: totals.last30Days || 0,
      },
      byActivityType: (agg.byActivityType || []).map((x) => ({
        activityType: x._id || 'OTHER',
        count: x.count,
      })),
      byAction: (agg.byAction || []).map((x) => ({
        action: x._id || 'UNKNOWN',
        count: x.count,
      })),
      activityByDay: (agg.byDay || []).map((x) => ({
        date: x._id,
        count: x.count,
      })),
      recent: agg.recent || [],
    },
  });
});

exports.getAllAdmins = handleFactory.getAll(Admin);
exports.updateAdmin = handleFactory.updateOne(Admin);
exports.getAdmin = handleFactory.getOne(Admin);
exports.updateMe = handleFactory.updateOne(Admin);
exports.deleteAdmin = handleFactory.deleteOne(Admin);
