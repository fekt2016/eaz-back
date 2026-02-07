const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Seller = require('../../models/user/sellerModel');
const User = require('../../models/user/userModel');
const Product = require('../../models/product/productModel');
const OrderItem = require('../../models/order/OrderItemModel');
const Transaction = require('../../models/transaction/transactionModel');
const ActivityLog = require('../../models/activityLog/activityLogModel');
const Cart = require('../../models/product/cartModel');
const TaxCollection = require('../../models/tax/taxCollectionModel');
const PlatformStats = require('../../models/platform/platformStatsModel');
const mongoose = require('mongoose');

/**
 * Get KPI Overview Cards
 * GET /admin/analytics/kpi
 */
exports.getKPICards = catchAsync(async (req, res, next) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const last7Days = new Date(today);
  last7Days.setDate(last7Days.getDate() - 7);
  const last8Days = new Date(today);
  last8Days.setDate(last8Days.getDate() - 8);
  const last14Days = new Date(today);
  last14Days.setDate(last14Days.getDate() - 14);

  // Total Revenue (all time)
  const totalRevenue = await PlatformStats.getStats();
  const allTimeRevenue = totalRevenue.totalRevenue || 0;

  // Revenue Today
  const todayOrders = await Order.find({
    paymentStatus: { $in: ['paid', 'completed'] },
    createdAt: { $gte: today },
  });
  const revenueToday = todayOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);

  // Revenue Yesterday (for comparison)
  const yesterdayOrders = await Order.find({
    paymentStatus: { $in: ['paid', 'completed'] },
    createdAt: { $gte: yesterday, $lt: today },
  });
  const revenueYesterday = yesterdayOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);
  const revenueTodayChange = revenueYesterday > 0 
    ? ((revenueToday - revenueYesterday) / revenueYesterday * 100).toFixed(1)
    : revenueToday > 0 ? 100 : 0;

  // Revenue Last 7 Days
  const last7DaysOrders = await Order.find({
    paymentStatus: { $in: ['paid', 'completed'] },
    createdAt: { $gte: last7Days },
  });
  const revenueLast7Days = last7DaysOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);

  // Revenue Previous 7 Days (for comparison)
  const previous7DaysOrders = await Order.find({
    paymentStatus: { $in: ['paid', 'completed'] },
    createdAt: { $gte: last14Days, $lt: last7Days },
  });
  const revenuePrevious7Days = previous7DaysOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);
  const revenue7DaysChange = revenuePrevious7Days > 0
    ? ((revenueLast7Days - revenuePrevious7Days) / revenuePrevious7Days * 100).toFixed(1)
    : revenueLast7Days > 0 ? 100 : 0;

  // Total Orders
  const totalOrders = await Order.countDocuments();
  const totalOrdersPending = await Order.countDocuments({ orderStatus: 'pending' });
  const totalOrdersDelivered = await Order.countDocuments({ orderStatus: 'delievered' });

  // Active Sellers
  const activeSellers = await Seller.countDocuments({ status: 'active', active: true });

  // New Users Today
  const newUsersToday = await User.countDocuments({
    createdAt: { $gte: today },
    role: 'user',
  });

  res.status(200).json({
    status: 'success',
    data: {
      totalRevenue: {
        value: allTimeRevenue,
        change: null,
        label: 'Total Revenue (All Time)',
      },
      revenueToday: {
        value: revenueToday,
        change: parseFloat(revenueTodayChange),
        label: 'Revenue Today',
      },
      revenueLast7Days: {
        value: revenueLast7Days,
        change: parseFloat(revenue7DaysChange),
        label: 'Revenue Last 7 Days',
      },
      totalOrders: {
        value: totalOrders,
        pending: totalOrdersPending,
        delivered: totalOrdersDelivered,
        label: 'Total Orders',
      },
      activeSellers: {
        value: activeSellers,
        change: null,
        label: 'Active Sellers',
      },
      newUsersToday: {
        value: newUsersToday,
        change: null,
        label: 'New Users Today',
      },
    },
  });
});

/**
 * Get Revenue Analytics
 * GET /admin/analytics/revenue?range=7|30|90|365
 */
exports.getRevenueAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Revenue timeline (daily)
  const revenueTimeline = await Order.aggregate([
    {
      $match: {
        paymentStatus: { $in: ['paid', 'completed'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        revenue: { $sum: '$totalPrice' },
        orders: { $sum: 1 },
        vat: { $sum: '$totalVAT' },
        nhil: { $sum: '$totalNHIL' },
        getfund: { $sum: '$totalGETFund' },
        covidLevy: { $sum: '$totalCovidLevy' },
        basePrice: { $sum: '$totalBasePrice' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Platform commission timeline
  const commissionTimeline = await SellerOrder.aggregate([
    {
      $match: {
        status: { $in: ['delivered', 'paid'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        commission: {
          $sum: {
            $multiply: [
              { $add: ['$totalBasePrice', '$shippingCost'] },
              { $ifNull: ['$commissionRate', 0] },
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Withholding tax collected timeline
  const withholdingTimeline = await TaxCollection.aggregate([
    {
      $match: {
        dateCollected: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$dateCollected' },
        },
        withholdingTax: { $sum: '$amount' },
        individual: {
          $sum: {
            $cond: [{ $eq: ['$taxCategory', 'individual'] }, '$amount', 0],
          },
        },
        company: {
          $sum: {
            $cond: [{ $eq: ['$taxCategory', 'company'] }, '$amount', 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Total summary
  const totalRevenue = revenueTimeline.reduce((sum, day) => sum + (day.revenue || 0), 0);
  const totalVAT = revenueTimeline.reduce((sum, day) => sum + (day.vat || 0), 0);
  const totalNHIL = revenueTimeline.reduce((sum, day) => sum + (day.nhil || 0), 0);
  const totalGETFund = revenueTimeline.reduce((sum, day) => sum + (day.getfund || 0), 0);
  const totalCovidLevy = revenueTimeline.reduce((sum, day) => sum + (day.covidLevy || 0), 0);
  const totalCommission = commissionTimeline.reduce((sum, day) => sum + (day.commission || 0), 0);
  const totalWithholding = withholdingTimeline.reduce((sum, day) => sum + (day.withholdingTax || 0), 0);

  res.status(200).json({
    status: 'success',
    data: {
      range,
      timeline: revenueTimeline.map(day => ({
        date: day._id,
        revenue: day.revenue || 0,
        orders: day.orders || 0,
        vat: day.vat || 0,
        nhil: day.nhil || 0,
        getfund: day.getfund || 0,
        covidLevy: day.covidLevy || 0,
        basePrice: day.basePrice || 0,
      })),
      commissionTimeline: commissionTimeline.map(day => ({
        date: day._id,
        commission: day.commission || 0,
      })),
      withholdingTimeline: withholdingTimeline.map(day => ({
        date: day._id,
        withholdingTax: day.withholdingTax || 0,
        individual: day.individual || 0,
        company: day.company || 0,
      })),
      summary: {
        totalRevenue,
        totalVAT,
        totalNHIL,
        totalGETFund,
        totalCovidLevy,
        totalCommission,
        totalWithholding,
        totalTax: totalVAT + totalNHIL + totalGETFund + totalCovidLevy,
      },
    },
  });
});

/**
 * Get Orders Analytics
 * GET /admin/analytics/orders?range=7|30|90|365
 */
exports.getOrdersAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Orders timeline
  const ordersTimeline = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        total: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'pending'] }, 1, 0] },
        },
        shipped: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'shipped'] }, 1, 0] },
        },
        delivered: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delievered'] }, 1, 0] },
        },
        cancelled: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0] },
        },
        paid: {
          $sum: { $cond: [{ $in: ['$paymentStatus', ['paid', 'completed']] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Order status breakdown
  const statusBreakdown = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$orderStatus',
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      range,
      timeline: ordersTimeline.map(day => ({
        date: day._id,
        total: day.total || 0,
        pending: day.pending || 0,
        shipped: day.shipped || 0,
        delivered: day.delivered || 0,
        cancelled: day.cancelled || 0,
        paid: day.paid || 0,
      })),
      statusBreakdown: statusBreakdown.reduce((acc, item) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
    },
  });
});

/**
 * Get Top Sellers Performance
 * GET /admin/analytics/sellers/top
 */
exports.getTopSellers = catchAsync(async (req, res, next) => {
  const limit = parseInt(req.query.limit) || 10;

  // Top sellers by revenue
  const topSellersByRevenue = await SellerOrder.aggregate([
    {
      $match: {
        status: { $in: ['delivered', 'paid'] },
      },
    },
    {
      $group: {
        _id: '$seller',
        totalRevenue: { $sum: '$totalBasePrice' },
        totalOrders: { $sum: 1 },
        totalShipping: { $sum: '$shippingCost' },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'sellers',
        localField: '_id',
        foreignField: '_id',
        as: 'sellerInfo',
      },
    },
    { $unwind: '$sellerInfo' },
    {
      $project: {
        sellerId: '$_id',
        sellerName: '$sellerInfo.name',
        shopName: '$sellerInfo.shopName',
        email: '$sellerInfo.email',
        avatar: '$sellerInfo.avatar',
        totalRevenue: 1,
        totalOrders: 1,
        totalShipping: 1,
        balance: '$sellerInfo.balance',
        lockedBalance: '$sellerInfo.lockedBalance',
        pendingBalance: '$sellerInfo.pendingBalance',
      },
    },
  ]);

  // Top sellers by orders
  const topSellersByOrders = await SellerOrder.aggregate([
    {
      $match: {
        status: { $in: ['delivered', 'paid'] },
      },
    },
    {
      $group: {
        _id: '$seller',
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalBasePrice' },
      },
    },
    { $sort: { totalOrders: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'sellers',
        localField: '_id',
        foreignField: '_id',
        as: 'sellerInfo',
      },
    },
    { $unwind: '$sellerInfo' },
    {
      $project: {
        sellerId: '$_id',
        sellerName: '$sellerInfo.name',
        shopName: '$sellerInfo.shopName',
        email: '$sellerInfo.email',
        totalOrders: 1,
        totalRevenue: 1,
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      byRevenue: topSellersByRevenue,
      byOrders: topSellersByOrders,
    },
  });
});

/**
 * Get Top Products Performance
 * GET /admin/analytics/products/top
 */
exports.getTopProducts = catchAsync(async (req, res, next) => {
  const limit = parseInt(req.query.limit) || 10;

  // Best selling products
  const bestSelling = await OrderItem.aggregate([
    {
      $match: {
        order: { $exists: true },
      },
    },
    {
      $group: {
        _id: '$product',
        totalSold: { $sum: '$quantity' },
        totalRevenue: { $sum: { $multiply: ['$price', '$quantity'] } },
        totalOrders: { $addToSet: '$order' },
      },
    },
    {
      $project: {
        totalSold: 1,
        totalRevenue: 1,
        totalOrders: { $size: '$totalOrders' },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $project: {
        productId: '$_id',
        productName: '$productInfo.name',
        productImage: '$productInfo.images.0',
        price: '$productInfo.price',
        stock: '$productInfo.stock',
        totalSold: 1,
        totalRevenue: 1,
        totalOrders: 1,
      },
    },
  ]);

  // Most viewed products (from ActivityLog if available)
  const mostViewed = await Product.find()
    .sort('-views')
    .limit(limit)
    .select('name images price stock views')
    .lean();

  // Low inventory products
  const lowInventory = await Product.find({
    stock: { $lte: 10 },
    active: true,
  })
    .sort('stock')
    .limit(limit)
    .select('name images price stock')
    .lean();

  res.status(200).json({
    status: 'success',
    data: {
      bestSelling,
      mostViewed,
      lowInventory,
    },
  });
});

/**
 * Get Customer Analytics
 * GET /admin/analytics/customers
 */
exports.getCustomerAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Total customers
  const totalCustomers = await User.countDocuments({ role: 'user' });

  // New customers per day
  const newCustomersTimeline = await User.aggregate([
    {
      $match: {
        role: 'user',
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Repeat customers (customers with more than 1 order)
  const repeatCustomers = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$user',
        orderCount: { $sum: 1 },
        totalSpent: { $sum: '$totalPrice' },
      },
    },
    {
      $match: {
        orderCount: { $gt: 1 },
      },
    },
    { $count: 'repeatCustomers' },
  ]);

  // Average order value
  const avgOrderValue = await Order.aggregate([
    {
      $match: {
        paymentStatus: { $in: ['paid', 'completed'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        avgOrderValue: { $avg: '$totalPrice' },
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalPrice' },
      },
    },
  ]);

  // High LTV customers
  const highLTVCustomers = await Order.aggregate([
    {
      $match: {
        paymentStatus: { $in: ['paid', 'completed'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$user',
        totalSpent: { $sum: '$totalPrice' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalSpent: -1 } },
    { $limit: 20 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userInfo',
      },
    },
    { $unwind: '$userInfo' },
    {
      $project: {
        userId: '$_id',
        name: '$userInfo.name',
        email: '$userInfo.email',
        totalSpent: 1,
        orderCount: 1,
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      totalCustomers,
      newCustomersTimeline: newCustomersTimeline.map(day => ({
        date: day._id,
        count: day.count || 0,
      })),
      repeatCustomers: repeatCustomers[0]?.repeatCustomers || 0,
      avgOrderValue: avgOrderValue[0]?.avgOrderValue || 0,
      totalOrders: avgOrderValue[0]?.totalOrders || 0,
      totalRevenue: avgOrderValue[0]?.totalRevenue || 0,
      highLTVCustomers,
    },
  });
});

/**
 * Get Order Status Analytics
 * GET /admin/analytics/order-status
 */
exports.getOrderStatusAnalytics = catchAsync(async (req, res, next) => {
  const statusBreakdown = await Order.aggregate([
    {
      $group: {
        _id: '$orderStatus',
        count: { $sum: 1 },
      },
    },
  ]);

  const paymentStatusBreakdown = await Order.aggregate([
    {
      $group: {
        _id: '$paymentStatus',
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      orderStatus: statusBreakdown.reduce((acc, item) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      paymentStatus: paymentStatusBreakdown.reduce((acc, item) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
    },
  });
});

/**
 * Get Tax & Financial Analytics
 * GET /admin/analytics/tax
 */
exports.getTaxAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Tax breakdown from orders
  const taxBreakdown = await Order.aggregate([
    {
      $match: {
        paymentStatus: { $in: ['paid', 'completed'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalVAT: { $sum: '$totalVAT' },
        totalNHIL: { $sum: '$totalNHIL' },
        totalGETFund: { $sum: '$totalGETFund' },
        totalCovidLevy: { $sum: '$totalCovidLevy' },
        totalRevenue: { $sum: '$totalPrice' },
        totalBasePrice: { $sum: '$totalBasePrice' },
      },
    },
  ]);

  // Withholding tax breakdown
  const withholdingBreakdown = await TaxCollection.aggregate([
    {
      $match: {
        dateCollected: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$taxCategory',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  // Platform commission
  const commissionBreakdown = await SellerOrder.aggregate([
    {
      $match: {
        status: { $in: ['delivered', 'paid'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalCommission: {
          $sum: {
            $multiply: [
              { $add: ['$totalBasePrice', '$shippingCost'] },
              { $ifNull: ['$commissionRate', 0] },
            ],
          },
        },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      range,
      taxBreakdown: taxBreakdown[0] || {
        totalVAT: 0,
        totalNHIL: 0,
        totalGETFund: 0,
        totalCovidLevy: 0,
        totalRevenue: 0,
        totalBasePrice: 0,
      },
      withholdingBreakdown: withholdingBreakdown.reduce((acc, item) => {
        acc[item._id || 'unknown'] = {
          total: item.total,
          count: item.count,
        };
        return acc;
      }, {}),
      totalCommission: commissionBreakdown[0]?.totalCommission || 0,
    },
  });
});

/**
 * Get Traffic & Conversion Analytics
 * GET /admin/analytics/traffic
 */
exports.getTrafficAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Page views from ActivityLog
  const pageViews = await ActivityLog.aggregate([
    {
      $match: {
        action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
        },
        views: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        date: '$_id',
        views: 1,
        uniqueVisitors: { $size: '$uniqueUsers' },
      },
    },
    { $sort: { date: 1 } },
  ]);

  // Orders (conversions)
  const orders = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        orders: { $sum: 1 },
        completed: {
          $sum: {
            $cond: [{ $in: ['$paymentStatus', ['paid', 'completed']] }, 1, 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Device breakdown
  const deviceBreakdown = await ActivityLog.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate },
        userAgent: { $exists: true },
      },
    },
    {
      $group: {
        _id: {
          $cond: [
            { $regexMatch: { input: '$userAgent', regex: /mobile|android|iphone/i } },
            'mobile',
            'desktop',
          ],
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Calculate conversion rate
  const totalViews = pageViews.reduce((sum, day) => sum + (day.views || 0), 0);
  const totalOrders = orders.reduce((sum, day) => sum + (day.completed || 0), 0);
  const conversionRate = totalViews > 0 ? (totalOrders / totalViews * 100).toFixed(2) : 0;

  res.status(200).json({
    status: 'success',
    data: {
      range,
      pageViews,
      orders: orders.map(day => ({
        date: day._id,
        orders: day.orders || 0,
        completed: day.completed || 0,
      })),
      deviceBreakdown: deviceBreakdown.reduce((acc, item) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      conversionRate: parseFloat(conversionRate),
      totalViews,
      totalOrders,
    },
  });
});

/**
 * Get Cart & Checkout Analytics
 * GET /admin/analytics/carts
 */
exports.getCartAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Active carts
  const activeCarts = await Cart.countDocuments({
    updatedAt: { $gte: startDate },
  });

  // Abandoned carts (carts older than 24 hours without order)
  const abandonedCarts = await Cart.aggregate([
    {
      $match: {
        updatedAt: { $gte: startDate },
        updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'user',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $match: {
        orders: { $size: 0 },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalValue: { $sum: '$total' },
      },
    },
  ]);

  // Average cart value
  const avgCartValue = await Cart.aggregate([
    {
      $match: {
        updatedAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        avgValue: { $avg: '$total' },
        totalCarts: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      range,
      activeCarts,
      abandonedCarts: abandonedCarts[0]?.count || 0,
      abandonedCartValue: abandonedCarts[0]?.totalValue || 0,
      abandonmentRate: activeCarts > 0
        ? ((abandonedCarts[0]?.count || 0) / activeCarts * 100).toFixed(2)
        : 0,
      avgCartValue: avgCartValue[0]?.avgValue || 0,
      totalCarts: avgCartValue[0]?.totalCarts || 0,
    },
  });
});

/**
 * Get Fraud & Suspicious Activity Analytics
 * GET /admin/analytics/fraud
 */
exports.getFraudAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Suspicious activities from ActivityLog
  const suspiciousActivities = await ActivityLog.find({
    riskLevel: { $in: ['high', 'critical'] },
    timestamp: { $gte: startDate },
  })
    .populate('userId', 'name email')
    .sort('-timestamp')
    .limit(50)
    .lean();

  // Failed login attempts
  const failedLogins = await ActivityLog.countDocuments({
    activityType: 'FAILED_LOGIN',
    timestamp: { $gte: startDate },
  });

  // IP change events
  const ipChanges = await ActivityLog.countDocuments({
    activityType: 'IP_CHANGE',
    timestamp: { $gte: startDate },
  });

  // Device change events
  const deviceChanges = await ActivityLog.countDocuments({
    activityType: 'DEVICE_CHANGE',
    timestamp: { $gte: startDate },
  });

  // Multiple IP logins (users with >3 IPs in 24h)
  const multipleIPLogins = await ActivityLog.aggregate([
    {
      $match: {
        activityType: 'LOGIN',
        timestamp: { $gte: startDate },
        ipAddress: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        },
        uniqueIPs: { $addToSet: '$ipAddress' },
      },
    },
    {
      $project: {
        userId: '$_id.userId',
        date: '$_id.date',
        ipCount: { $size: '$uniqueIPs' },
      },
    },
    {
      $match: {
        ipCount: { $gt: 3 },
      },
    },
    { $count: 'count' },
  ]);

  // Risk level breakdown
  const riskBreakdown = await ActivityLog.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate },
        riskLevel: { $exists: true },
      },
    },
    {
      $group: {
        _id: '$riskLevel',
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      range,
      suspiciousActivities,
      failedLogins,
      ipChanges,
      deviceChanges,
      multipleIPLogins: multipleIPLogins[0]?.count || 0,
      riskBreakdown: riskBreakdown.reduce((acc, item) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
    },
  });
});

/**
 * Get Inventory Analytics
 * GET /admin/analytics/inventory
 */
exports.getInventoryAnalytics = catchAsync(async (req, res, next) => {
  // Low stock products
  const lowStock = await Product.find({
    stock: { $lte: 10 },
    active: true,
  })
    .sort('stock')
    .limit(50)
    .select('name images price stock category')
    .lean();

  // Out of stock products
  const outOfStock = await Product.find({
    stock: { $lte: 0 },
    active: true,
  })
    .countDocuments();

  // Inventory turnover (products sold vs stock)
  const inventoryTurnover = await OrderItem.aggregate([
    {
      $group: {
        _id: '$product',
        totalSold: { $sum: '$quantity' },
      },
    },
    { $limit: 100 },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $project: {
        productId: '$_id',
        productName: '$productInfo.name',
        stock: '$productInfo.stock',
        totalSold: 1,
        turnoverRate: {
          $cond: [
            { $gt: ['$productInfo.stock', 0] },
            { $divide: ['$totalSold', '$productInfo.stock'] },
            0,
          ],
        },
      },
    },
    { $sort: { turnoverRate: -1 } },
    { $limit: 20 },
  ]);

  // Stock levels summary
  const stockSummary = await Product.aggregate([
    {
      $match: {
        active: true,
      },
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        lowStock: {
          $sum: { $cond: [{ $lte: ['$stock', 10] }, 1, 0] },
        },
        outOfStock: {
          $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] },
        },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      lowStock,
      outOfStock,
      inventoryTurnover,
      stockSummary: stockSummary[0] || {
        totalProducts: 0,
        totalStock: 0,
        lowStock: 0,
        outOfStock: 0,
      },
    },
  });
});

/**
 * Record Product View
 * POST /api/v1/analytics/views
 */
exports.recordView = catchAsync(async (req, res, next) => {
  const { productId, sessionId } = req.body;

  if (!productId) {
    return next(new AppError('Product ID is required', 400));
  }

  // Increment product views count (Product schema uses totalViews)
  await Product.findByIdAndUpdate(productId, {
    $inc: { totalViews: 1 },
  });

  // Log activity using the activity log service (handles all required fields)
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
  
  // Determine role and userId - handle both authenticated and anonymous users
  let userId = null;
  let role = 'buyer';
  
  if (req.user) {
    userId = req.user.id || req.user._id;
    if (req.user.role === 'seller') {
      role = 'seller';
    } else if (req.user.role === 'admin') {
      role = 'admin';
    } else {
      role = 'buyer';
    }
  }
  
  // Get product name for description (optional, don't fail if it doesn't exist)
  let productName = 'Unknown Product';
  try {
    const product = await Product.findById(productId).select('name').lean();
    if (product && product.name) {
      productName = product.name;
    }
  } catch (err) {
    // Ignore error, use default name
  }

  // Only log activity if we have a userId (for authenticated users)
  // Anonymous users can still record views, but we skip activity logging for them
  if (userId) {
    logActivityAsync({
      userId,
      role,
      action: 'VIEW_PRODUCT',
      description: `${role === 'seller' ? 'Seller' : role === 'admin' ? 'Admin' : 'User'} viewed product: ${productName}`,
      req,
      metadata: {
        productId: productId.toString(),
        sessionId: sessionId || null,
      },
      activityType: 'OTHER',
      riskLevel: 'low',
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'View recorded successfully',
  });
});

/**
 * Get Seller Product Views
 * GET /api/v1/analytics/seller/:sellerId/views
 * Uses Product.totalViews (incremented on every view, including anonymous).
 */
exports.getSellerProductViews = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;

  const sellerProducts = await Product.find({ seller: sellerId })
    .select('_id name totalViews')
    .lean();

  const views = sellerProducts.map((p) => ({
    productId: p._id.toString(),
    productName: p.name || 'Unknown',
    views: p.totalViews || 0,
  })).sort((a, b) => (b.views || 0) - (a.views || 0));

  const totalViews = views.reduce((sum, item) => sum + (item.views || 0), 0);

  res.status(200).json({
    status: 'success',
    data: {
      views,
      totalViews,
      range: 30,
    },
  });
});
