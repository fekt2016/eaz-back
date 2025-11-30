const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const PlatformStats = require('../../models/platform/platformStatsModel');
const Order = require('../../models/order/orderModel');
const Seller = require('../../models/user/sellerModel');

/**
 * Get platform statistics
 * GET /api/v1/admin/stats
 */
exports.getPlatformStats = catchAsync(async (req, res, next) => {
  // Get or create platform stats
  const platformStats = await PlatformStats.getStats();

  // Recalculate totalRevenue from all orders in database
  // This ensures totalRevenue always reflects the sum of all orders
  const allOrders = await Order.find({
    revenueAdded: true, // Only count orders where revenue was added
  }).select('revenueAmount totalPrice');
  
  const calculatedTotalRevenue = allOrders.reduce((sum, order) => {
    // Use revenueAmount if available, otherwise use totalPrice
    const orderRevenue = order.revenueAmount || order.totalPrice || 0;
    return sum + orderRevenue;
  }, 0);

  // Update platformStats with calculated revenue (sync with database)
  if (platformStats.totalRevenue !== calculatedTotalRevenue) {
    console.log(`[getPlatformStats] Syncing revenue: ${platformStats.totalRevenue} → ${calculatedTotalRevenue}`);
    platformStats.totalRevenue = calculatedTotalRevenue;
    platformStats.lastUpdated = new Date();
    await platformStats.save();
  }

  // Get current order counts
  const totalOrders = await Order.countDocuments();
  const totalPendingOrders = await Order.countDocuments({
    currentStatus: { $in: ['pending_payment', 'payment_completed', 'confirmed', 'processing', 'preparing', 'ready_for_dispatch', 'out_for_delivery'] },
  });
  const totalDeliveredOrders = await Order.countDocuments({
    currentStatus: 'delivered',
  });

  // Calculate today's revenue (orders delivered today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOrders = await Order.find({
    currentStatus: 'delivered',
    revenueAdded: true,
    updatedAt: { $gte: today },
  });
  const todayRevenue = todayOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);

  // Calculate this month's revenue
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthOrders = await Order.find({
    currentStatus: 'delivered',
    revenueAdded: true,
    updatedAt: { $gte: startOfMonth },
  });
  const thisMonthRevenue = monthOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);

  // Get last 30 days revenue data for graph
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const last30DaysOrders = await Order.find({
    currentStatus: 'delivered',
    revenueAdded: true,
    updatedAt: { $gte: thirtyDaysAgo },
  }).select('totalPrice updatedAt');

  // Group by date (use updatedAt which is when order was marked delivered and revenue was added)
  const revenueByDate = {};
  last30DaysOrders.forEach((order) => {
    const dateStr = new Date(order.updatedAt).toISOString().split('T')[0];
    if (!revenueByDate[dateStr]) {
      revenueByDate[dateStr] = { date: dateStr, revenue: 0, orders: 0 };
    }
    revenueByDate[dateStr].revenue += order.totalPrice || 0;
    revenueByDate[dateStr].orders += 1;
  });

  // Convert to array and fill missing dates with 0
  const revenueGraphData = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().split('T')[0];
    
    revenueGraphData.push({
      date: dateStr,
      revenue: revenueByDate[dateStr]?.revenue || 0,
      orders: revenueByDate[dateStr]?.orders || 0,
    });
  }

  // Calculate last 30 days total revenue
  const last30DaysRevenue = revenueGraphData.reduce((sum, day) => sum + day.revenue, 0);

  res.status(200).json({
    status: 'success',
    data: {
      totalRevenue: calculatedTotalRevenue, // Use calculated revenue from database
      totalOrders,
      totalDeliveredOrders,
      totalProductsSold: platformStats.totalProductsSold || 0,
      totalPendingOrders,
      todayRevenue,
      thisMonthRevenue,
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

