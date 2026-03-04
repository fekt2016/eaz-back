const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const PlatformStats = require('../../models/platform/platformStatsModel');
const Order = require('../../models/order/orderModel');
const Seller = require('../../models/user/sellerModel');
const logger = require('../../utils/logger');

/**
 * Get platform statistics
 * GET /api/v1/admin/stats
 */
exports.getPlatformStats = catchAsync(async (req, res, next) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  // Single efficient aggregation for all platform stats
  const stats = await Order.aggregate([
    {
      $facet: {
        // 1. Total Cumulative Revenue (all orders ever delivered/revenue added)
        overall: [
          { $match: { revenueAdded: true } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: { $ifNull: ['$revenueAmount', '$totalPrice'] } },
            },
          },
        ],
        // 2. Focused Metrics (Today, Month, and specific counts)
        metrics: [
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              pendingOrders: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        '$currentStatus',
                        [
                          'pending_payment',
                          'payment_completed',
                          'confirmed',
                          'processing',
                          'preparing',
                          'ready_for_dispatch',
                          'out_for_delivery',
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              deliveredOrdersCount: {
                $sum: { $cond: [{ $eq: ['$currentStatus', 'delivered'] }, 1, 0] },
              },
              todayRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$currentStatus', 'delivered'] },
                        { $eq: ['$revenueAdded', true] },
                        { $gte: ['$updatedAt', today] },
                      ],
                    },
                    { $ifNull: ['$revenueAmount', '$totalPrice'] },
                    0,
                  ],
                },
              },
              thisMonthRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$currentStatus', 'delivered'] },
                        { $eq: ['$revenueAdded', true] },
                        { $gte: ['$updatedAt', startOfMonth] },
                      ],
                    },
                    { $ifNull: ['$revenueAmount', '$totalPrice'] },
                    0,
                  ],
                },
              },
            },
          },
        ],
        // 3. Last 30 Days Graph Data
        graph: [
          {
            $match: {
              currentStatus: 'delivered',
              revenueAdded: true,
              updatedAt: { $gte: thirtyDaysAgo },
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
              revenue: { $sum: { $ifNull: ['$revenueAmount', '$totalPrice'] } },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const result = stats[0] || {};
  const overall = result.overall?.[0] || { totalRevenue: 0 };
  const metrics = result.metrics?.[0] || {
    totalOrders: 0,
    pendingOrders: 0,
    deliveredOrdersCount: 0,
    todayRevenue: 0,
    thisMonthRevenue: 0,
  };
  const rawGraph = result.graph || [];

  // Convert graph data to map for easy lookup
  const graphMap = rawGraph.reduce((acc, day) => {
    acc[day._id] = day;
    return acc;
  }, {});

  // Fill in missing dates for the last 30 days
  const revenueGraphData = [];
  let last30DaysRevenue = 0;

  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dayData = graphMap[dateStr] || { date: dateStr, revenue: 0, orders: 0 };
    revenueGraphData.push({
      date: dateStr,
      revenue: dayData.revenue,
      orders: dayData.orders,
    });
    last30DaysRevenue += dayData.revenue;
  }

  // Get/Update PlatformStats document for persistent caching if needed
  const platformStats = await PlatformStats.getStats();
  if (platformStats.totalRevenue !== overall.totalRevenue) {
    platformStats.totalRevenue = overall.totalRevenue;
    platformStats.lastUpdated = new Date();
    await platformStats.save();
  }

  res.status(200).json({
    status: 'success',
    data: {
      totalRevenue: overall.totalRevenue,
      totalOrders: metrics.totalOrders,
      totalDeliveredOrders: metrics.deliveredOrdersCount,
      totalProductsSold: platformStats.totalProductsSold || 0,
      totalPendingOrders: metrics.pendingOrders,
      todayRevenue: metrics.todayRevenue,
      thisMonthRevenue: metrics.thisMonthRevenue,
      last30DaysRevenue,
      revenueGraphData,
      lastUpdated: platformStats.lastUpdated,
    },
  });
});


exports.resetRevenue = catchAsync(async (req, res, next) => {
  // Reset Admin Revenue
  const platformStats = await PlatformStats.getStats();

  const oldAdminRevenue = platformStats.totalRevenue || 0;
  const oldTotalOrders = platformStats.totalOrders || 0;
  const oldDeliveredOrders = platformStats.totalDeliveredOrders || 0;
  const oldProductsSold = platformStats.totalProductsSold || 0;
  const oldPendingOrders = platformStats.totalPendingOrders || 0;

  platformStats.totalRevenue = 0;
  platformStats.totalOrders = 0;
  platformStats.totalDeliveredOrders = 0;
  platformStats.totalProductsSold = 0;
  platformStats.totalPendingOrders = 0;
  platformStats.dailyRevenue = []; // Clear daily revenue tracking
  platformStats.lastUpdated = new Date();

  await platformStats.save();

  // Reset All Seller Balances
  const sellers = await Seller.find({});

  let totalSellers = 0;
  let totalBalanceReset = 0;
  let totalLockedReset = 0;
  let totalPendingReset = 0;

  for (const seller of sellers) {
    const oldBalance = seller.balance || 0;
    const oldLocked = seller.lockedBalance || 0;
    const oldPending = seller.pendingBalance || 0;

    seller.balance = 0;
    seller.lockedBalance = 0;
    seller.pendingBalance = 0;
    seller.withdrawableBalance = 0;

    await seller.save();

    totalSellers++;
    totalBalanceReset += oldBalance;
    totalLockedReset += oldLocked;
    totalPendingReset += oldPending;
  }

  // Log activity
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
  logActivityAsync({
    userId: req.user.id,
    role: 'admin',
    action: 'RESET_REVENUE',
    description: `Admin reset all revenue: Admin GH₵${oldAdminRevenue.toFixed(2)}, ${totalSellers} sellers GH₵${totalBalanceReset.toFixed(2)}`,
    req,
    metadata: {
      oldAdminRevenue,
      totalSellers,
      totalBalanceReset,
      totalLockedReset,
      totalPendingReset,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Revenue and seller balances reset successfully',
    data: {
      admin: {
        revenueReset: oldAdminRevenue,
        ordersReset: oldTotalOrders,
        deliveredOrdersReset: oldDeliveredOrders,
        productsSoldReset: oldProductsSold,
        pendingOrdersReset: oldPendingOrders,
      },
      sellers: {
        totalSellers,
        totalBalanceReset,
        totalLockedReset,
        totalPendingReset,
      },
    },
  });
});


exports.resetRevenueOnly = catchAsync(async (req, res, next) => {
  // Reset Admin Revenue Only
  const platformStats = await PlatformStats.getStats();

  const oldAdminRevenue = platformStats.totalRevenue || 0;

  platformStats.totalRevenue = 0;
  platformStats.lastUpdated = new Date();

  await platformStats.save();

  // Log activity
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
  logActivityAsync({
    userId: req.user.id,
    role: 'admin',
    action: 'RESET_ADMIN_REVENUE_ONLY',
    description: `Admin reset total revenue: GH₵${oldAdminRevenue.toFixed(2)} → GH₵0.00`,
    req,
    metadata: {
      oldAdminRevenue,
      newRevenue: 0,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Admin total revenue reset successfully',
    data: {
      oldRevenue: oldAdminRevenue,
      newRevenue: 0,
    },
  });
});

