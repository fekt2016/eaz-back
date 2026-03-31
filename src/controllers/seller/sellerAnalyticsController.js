const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const SellerOrder = require('../../models/order/sellerOrderModel');
const OrderItem = require('../../models/order/OrderItemModel');
const Order = require('../../models/order/orderModel');
const Product = require('../../models/product/productModel');
const ActivityLog = require('../../models/activityLog/activityLogModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const TaxCollection = require('../../models/tax/taxCollectionModel');
const Seller = require('../../models/user/sellerModel');
const mongoose = require('mongoose');

const getPeriodWindow = (period) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (period) {
    case '7d':
      start.setDate(start.getDate() - 6);
      return { startDate: start, isAllTime: false };
    case '30d':
      start.setDate(start.getDate() - 29);
      return { startDate: start, isAllTime: false };
    case '90d':
      start.setDate(start.getDate() - 89);
      return { startDate: start, isAllTime: false };
    case 'all':
    default:
      return { startDate: null, isAllTime: true };
  }
};

/**
 * Unified seller analytics payload for mobile dashboards.
 * GET /seller/analytics?period=7d|30d|90d|all
 */
exports.getSellerAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user?._id || req.user?.id;
  if (!sellerId) {
    return next(new AppError('Seller identity is required', 401));
  }

  const period = String(req.query.period || '7d');
  const { startDate, isAllTime } = getPeriodWindow(period);
  const sellerObjectId = new mongoose.Types.ObjectId(sellerId);

  const sellerOrderMatch = { seller: sellerObjectId };
  const productMatch = { seller: sellerObjectId };
  const activityMatchBase = {};
  if (!isAllTime && startDate) {
    sellerOrderMatch.createdAt = { $gte: startDate };
    productMatch.updatedAt = { $gte: startDate };
    activityMatchBase.timestamp = { $gte: startDate };
  }

  const orderRows = await SellerOrder.find(sellerOrderMatch)
    .select('status total subtotal totalBasePrice createdAt order items')
    .populate({
      path: 'order',
      select: 'paymentStatus',
    })
    .lean();

  const deliveredLike = new Set([
    'delivered',
    'delievered',
    'completed',
    'payment_completed',
  ]);
  const payableLike = new Set(['paid', 'completed', 'payment_completed']);

  const resolveSellerOrderAmount = (row) => {
    const totalBasePrice = Number(row?.totalBasePrice || 0);
    const total = Number(row?.total || 0);
    const subtotal = Number(row?.subtotal || 0);
    if (totalBasePrice > 0) return totalBasePrice;
    if (total > 0) return total;
    if (subtotal > 0) return subtotal;
    return 0;
  };

  const currentRevenueTotal = orderRows.reduce((sum, row) => {
    const status = String(row?.status || '').toLowerCase();
    const paymentStatus = String(row?.order?.paymentStatus || '').toLowerCase();
    if (!deliveredLike.has(status) && !payableLike.has(paymentStatus)) {
      return sum;
    }
    return sum + resolveSellerOrderAmount(row);
  }, 0);

  let previousRevenueTotal = 0;
  let previousOrdersTotal = 0;
  let previousViewsTotal = 0;
  let previousConversionRate = 0;

  if (!isAllTime && startDate) {
    const now = new Date();
    const rangeMs = now.getTime() - startDate.getTime();
    const previousEnd = new Date(startDate);
    const previousStart = new Date(startDate.getTime() - rangeMs);

    const previousOrderRows = await SellerOrder.find({
      seller: sellerObjectId,
      createdAt: { $gte: previousStart, $lt: previousEnd },
    })
      .select('status total subtotal order')
      .populate({
        path: 'order',
        select: 'paymentStatus',
      })
      .lean();

    previousOrdersTotal = previousOrderRows.length;
    previousRevenueTotal = previousOrderRows.reduce((sum, row) => {
      const status = String(row?.status || '').toLowerCase();
      const paymentStatus = String(row?.order?.paymentStatus || '').toLowerCase();
      if (!deliveredLike.has(status) && !payableLike.has(paymentStatus)) {
        return sum;
      }
      return sum + resolveSellerOrderAmount(row);
    }, 0);
  }

  const ordersTotal = orderRows.length;

  const productIds = await Product.find({ seller: sellerObjectId })
    .select('_id totalViews views')
    .lean();
  const productIdStrings = productIds.map((p) => String(p._id));

  const viewsFromProducts = productIds.reduce(
    (sum, p) => sum + Number(p?.totalViews || p?.views || 0),
    0
  );

  let viewsFromActivity = 0;
  let uniqueVisitors = 0;
  let chartData = [];
  if (productIdStrings.length > 0) {
    const activityMatch = {
      ...activityMatchBase,
      action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
      $or: [
        { 'metadata.productId': { $in: productIdStrings } },
        { 'metadata.product._id': { $in: productIdStrings } },
      ],
    };

    const viewsAgg = await ActivityLog.aggregate([
      { $match: activityMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          visitors: { $addToSet: '$userId' },
        },
      },
    ]);

    viewsFromActivity = Number(viewsAgg[0]?.total || 0);
    uniqueVisitors = Array.isArray(viewsAgg[0]?.visitors)
      ? viewsAgg[0].visitors.filter(Boolean).length
      : 0;

    chartData = await SellerOrder.aggregate([
      { $match: sellerOrderMatch },
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'orderInfo',
        },
      },
      {
        $project: {
          createdAt: 1,
          total: 1,
          subtotal: 1,
          status: 1,
          paymentStatus: {
            $toLower: {
              $ifNull: [{ $arrayElemAt: ['$orderInfo.paymentStatus', 0] }, ''],
            },
          },
        },
      },
      {
        $addFields: {
          normalizedStatus: { $toLower: '$status' },
        },
      },
      {
        $match: {
          $or: [
            {
              normalizedStatus: {
                $in: ['delivered', 'delievered', 'completed', 'payment_completed'],
              },
            },
            { paymentStatus: { $in: ['paid', 'completed', 'payment_completed'] } },
          ],
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          amount: {
            $sum: {
              $ifNull: [
                '$totalBasePrice',
                {
                  $ifNull: [
                    '$total',
                    '$subtotal',
                  ],
                },
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          amount: 1,
        },
      },
    ]);
  }

  let revenueTotalFinal = currentRevenueTotal;
  if (revenueTotalFinal <= 0 && orderRows.length > 0) {
    // Fallback from SellerOrder.items -> OrderItems snapshot prices.
    const sellerOrderItemsRevenue = await SellerOrder.aggregate([
      { $match: sellerOrderMatch },
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'orderInfo',
        },
      },
      {
        $project: {
          items: 1,
          status: { $toLower: '$status' },
          paymentStatus: {
            $toLower: {
              $ifNull: [{ $arrayElemAt: ['$orderInfo.paymentStatus', 0] }, ''],
            },
          },
        },
      },
      {
        $match: {
          $or: [
            {
              status: {
                $in: ['delivered', 'delievered', 'completed', 'payment_completed'],
              },
            },
            { paymentStatus: { $in: ['paid', 'completed', 'payment_completed'] } },
          ],
        },
      },
      { $unwind: { path: '$items', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'orderitems',
          localField: 'items',
          foreignField: '_id',
          as: 'itemInfo',
        },
      },
      { $unwind: { path: '$itemInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $multiply: [
                { $ifNull: ['$itemInfo.quantity', 0] },
                {
                  $ifNull: [
                    '$itemInfo.basePrice',
                    { $ifNull: ['$itemInfo.priceExVat', '$itemInfo.price'] },
                  ],
                },
              ],
            },
          },
        },
      },
    ]);
    revenueTotalFinal = Number(sellerOrderItemsRevenue[0]?.total || 0);
  }

  if (revenueTotalFinal <= 0) {
    // Legacy fallback: sum seller revenue from OrderItems when SellerOrder totals are blank.
    const revenueFallback = await OrderItem.aggregate([
      {
        $match: {
          sellerId: sellerObjectId,
          ...(isAllTime ? {} : { createdAt: { $gte: startDate } }),
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $multiply: [
                { $ifNull: ['$quantity', 0] },
                { $ifNull: ['$basePrice', { $ifNull: ['$priceExVat', '$price'] }] },
              ],
            },
          },
        },
      },
    ]);
    revenueTotalFinal = Number(revenueFallback[0]?.total || 0);
  }

  const viewsTotal = Math.max(viewsFromActivity, viewsFromProducts, 0);
  const conversionRate = viewsTotal > 0 ? (ordersTotal / viewsTotal) * 100 : 0;

  if (!isAllTime && startDate && productIdStrings.length > 0) {
    const now = new Date();
    const rangeMs = now.getTime() - startDate.getTime();
    const previousEnd = new Date(startDate);
    const previousStart = new Date(startDate.getTime() - rangeMs);
    const previousActivityMatch = {
      action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
      timestamp: { $gte: previousStart, $lt: previousEnd },
      $or: [
        { 'metadata.productId': { $in: productIdStrings } },
        { 'metadata.product._id': { $in: productIdStrings } },
      ],
    };
    const previousViewsAgg = await ActivityLog.aggregate([
      { $match: previousActivityMatch },
      { $group: { _id: null, total: { $sum: 1 } } },
    ]);
    previousViewsTotal = Number(previousViewsAgg[0]?.total || 0);
    previousConversionRate =
      previousViewsTotal > 0 ? (previousOrdersTotal / previousViewsTotal) * 100 : 0;
  }

  const calcTrend = (current, previous) => {
    if (!previous || previous <= 0) return current > 0 ? 100 : 0;
    return Number((((current - previous) / previous) * 100).toFixed(2));
  };

  const topProducts = await OrderItem.aggregate([
    {
      $match: {
        sellerId: sellerObjectId,
      },
    },
    ...(isAllTime
      ? []
      : [
          {
            $match: {
              createdAt: { $gte: startDate },
            },
          },
        ]),
    {
      $group: {
        _id: '$product',
        unitsSold: { $sum: '$quantity' },
        revenue: {
          $sum: { $multiply: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$price', 0] }] },
        },
      },
    },
    { $sort: { unitsSold: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        name: '$productInfo.name',
        images: '$productInfo.images',
        unitsSold: 1,
        revenue: 1,
      },
    },
  ]);

  const orderStatusBreakdown = orderRows.reduce(
    (acc, row) => {
      const status = String(row?.status || '').toLowerCase();
      if (status === 'delivered' || status === 'completed') acc.delivered += 1;
      else if (status === 'confirmed') acc.confirmed += 1;
      else if (status === 'shipped') acc.shipped += 1;
      else if (status === 'cancelled' || status === 'returned' || status === 'refunded') {
        acc.cancelled += 1;
      } else acc.pending += 1;
      return acc;
    },
    { delivered: 0, confirmed: 0, shipped: 0, pending: 0, cancelled: 0 }
  );

  res.status(200).json({
    status: 'success',
    data: {
      revenue: {
        total: Number(revenueTotalFinal.toFixed(2)),
        trend: calcTrend(revenueTotalFinal, previousRevenueTotal),
        chartData,
      },
      orders: {
        total: ordersTotal,
        trend: calcTrend(ordersTotal, previousOrdersTotal),
      },
      views: {
        total: viewsTotal,
        unique: uniqueVisitors,
        trend: calcTrend(viewsTotal, previousViewsTotal),
      },
      conversion: {
        rate: Number(conversionRate.toFixed(2)),
        trend: calcTrend(conversionRate, previousConversionRate),
      },
      topProducts,
      orderStatusBreakdown,
      avgSession: null,
    },
  });
});

/**
 * Get Seller KPI Cards
 * GET /seller/analytics/kpi
 */
exports.getSellerKPICards = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const last14Days = new Date(today);
  last14Days.setDate(last14Days.getDate() - 14);
  // Single aggregation for all revenue metrics
  const revenueStats = await SellerOrder.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        createdAt: { $gte: last14Days },
      },
    },
    {
      $group: {
        _id: null,
        revenueToday: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$createdAt', today] },
                  { $in: ['$status', ['delivered', 'paid']] },
                ],
              },
              { $ifNull: ['$totalBasePrice', 0] },
              0,
            ],
          },
        },
        revenueYesterday: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$createdAt', yesterday] },
                  { $lt: ['$createdAt', today] },
                  { $in: ['$status', ['delivered', 'paid']] },
                ],
              },
              { $ifNull: ['$totalBasePrice', 0] },
              0,
            ],
          },
        },
        revenueThisWeek: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$createdAt', lastWeek] },
                  { $in: ['$status', ['delivered', 'paid']] },
                ],
              },
              { $ifNull: ['$totalBasePrice', 0] },
              0,
            ],
          },
        },
        revenuePreviousWeek: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$createdAt', last14Days] },
                  { $lt: ['$createdAt', lastWeek] },
                  { $in: ['$status', ['delivered', 'paid']] },
                ],
              },
              { $ifNull: ['$totalBasePrice', 0] },
              0,
            ],
          },
        },
        ordersToday: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', today] }, 1, 0],
          },
        },
      },
    },
  ]);

  console.log(`[getSellerKPICards] Raw Aggregation Result: ${JSON.stringify(revenueStats)}`);

  const stats = revenueStats[0] || {
    revenueToday: 0,
    revenueYesterday: 0,
    revenueThisWeek: 0,
    revenuePreviousWeek: 0,
    ordersToday: 0,
  };

  // Remaining counts (still efficient via countDocuments with indexes)
  const pendingOrders = await SellerOrder.countDocuments({
    seller: sellerId,
    status: { $in: ['pending', 'confirmed', 'processing'] },
  });

  const totalProductsLive = await Product.countDocuments({
    seller: sellerId,
    active: true,
  });

  const seller = await Seller.findById(sellerId).select('balance lockedBalance pendingBalance withdrawableBalance');
  const availableBalance = seller?.withdrawableBalance || (seller?.balance || 0) - (seller?.lockedBalance || 0) - (seller?.pendingBalance || 0);

  const revenueTodayChange = stats.revenueYesterday > 0
    ? (((stats.revenueToday - stats.revenueYesterday) / stats.revenueYesterday) * 100).toFixed(1)
    : stats.revenueToday > 0 ? 100 : 0;

  const revenueWeekChange = stats.revenuePreviousWeek > 0
    ? (((stats.revenueThisWeek - stats.revenuePreviousWeek) / stats.revenuePreviousWeek) * 100).toFixed(1)
    : stats.revenueThisWeek > 0 ? 100 : 0;

  res.status(200).json({
    status: 'success',
    data: {
      revenueToday: {
        value: stats.revenueToday,
        change: parseFloat(revenueTodayChange),
        label: "Today's Revenue",
      },
      revenueThisWeek: {
        value: stats.revenueThisWeek,
        change: parseFloat(revenueWeekChange),
        label: "This Week's Revenue",
      },
      ordersToday: {
        value: stats.ordersToday,
        change: null,
        label: 'Total Orders Today',
      },
      pendingOrders: {
        value: pendingOrders,
        change: null,
        label: 'Pending Orders',
      },
      totalProductsLive: {
        value: totalProductsLive,
        change: null,
        label: 'Total Products Live',
      },
      availableBalance: {
        value: availableBalance,
        change: null,
        label: 'Available Balance',
      },
    },
  });
});

/**
 * Get Seller Revenue Analytics
 * GET /seller/analytics/revenue?range=7|30|90|365
 */
exports.getSellerRevenueAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user?._id || req.user?.id;
  if (!sellerId) {
    return next(new AppError('Seller identity is required', 401));
  }
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  const sellerObjectId = new mongoose.Types.ObjectId(String(sellerId));

  // Daily revenue: align with seller dashboard / mobile — count seller orders that are
  // delivered OR whose parent order is paid (SellerOrder has no "paid" lifecycle status).
  const revenueTimeline = await SellerOrder.aggregate([
    {
      $match: {
        seller: sellerObjectId,
        createdAt: { $gte: startDate },
        status: { $nin: ['cancelled', 'returned'] },
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'order',
        foreignField: '_id',
        as: 'orderDoc',
      },
    },
    { $unwind: { path: '$orderDoc', preserveNullAndEmptyArrays: true } },
    {
      $match: {
        $or: [
          { status: 'delivered' },
          {
            'orderDoc.paymentStatus': {
              $in: ['paid', 'completed', 'payment_completed'],
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        revenue: {
          $sum: {
            $cond: [
              { $gt: ['$totalBasePrice', 0] },
              '$totalBasePrice',
              { $ifNull: ['$subtotal', 0] },
            ],
          },
        },
        orders: { $sum: 1 },
        shipping: { $sum: '$shippingCost' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Withholding Tax Deducted
  const withholdingTax = await TaxCollection.aggregate([
    {
      $match: {
        sellerId: sellerObjectId,
        dateCollected: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
      },
    },
  ]);

  // Total Payouts
  const payouts = await PaymentRequest.aggregate([
    {
      $match: {
        seller: sellerObjectId,
        status: { $in: ['paid', 'approved'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amountPaidToSeller' },
      },
    },
  ]);

  const totalRevenue = revenueTimeline.reduce((sum, day) => sum + (day.revenue || 0), 0);
  const totalWithholding = withholdingTax[0]?.total || 0;
  const totalPayouts = payouts[0]?.total || 0;
  const netRevenue = totalRevenue - totalWithholding;

  res.status(200).json({
    status: 'success',
    data: {
      range,
      dailyRevenue: revenueTimeline.map(day => ({
        date: day._id,
        amount: day.revenue || 0,
        orders: day.orders || 0,
        shipping: day.shipping || 0,
      })),
      summary: {
        totalRevenue,
        withholdingDeducted: totalWithholding,
        payoutTotal: totalPayouts,
        netRevenue,
      },
    },
  });
});

/**
 * Get Seller Order Status Analytics
 * GET /seller/analytics/orders/status
 */
exports.getSellerOrderStatusAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user?._id || req.user?.id;
  if (!sellerId) {
    return next(new AppError('Seller identity is required', 401));
  }

  const statusBreakdown = await SellerOrder.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  let totalOrders = await SellerOrder.countDocuments({ seller: sellerId });
  let normalizedBreakdown = statusBreakdown;

  // Fallback for legacy data where SellerOrder rows may be missing
  // but orders still exist via OrderItem -> Product(seller) -> Order.
  if (totalOrders === 0) {
    const fallback = await OrderItem.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productInfo',
        },
      },
      { $unwind: '$productInfo' },
      {
        $match: {
          'productInfo.seller': new mongoose.Types.ObjectId(sellerId),
        },
      },
      {
        $group: {
          _id: '$order',
        },
      },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: '_id',
          as: 'orderInfo',
        },
      },
      { $unwind: '$orderInfo' },
      {
        $group: {
          _id: {
            $ifNull: ['$orderInfo.currentStatus', '$orderInfo.status'],
          },
          count: { $sum: 1 },
        },
      },
    ]);

    normalizedBreakdown = fallback;
    totalOrders = fallback.reduce((sum, item) => sum + (item.count || 0), 0);
  }

  // Second fallback: use OrderItem.sellerId directly (more reliable for legacy rows)
  if (totalOrders === 0) {
    const directFallback = await OrderItem.aggregate([
      {
        $match: {
          sellerId: new mongoose.Types.ObjectId(sellerId),
        },
      },
      {
        $group: {
          _id: '$order',
        },
      },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: '_id',
          as: 'orderInfo',
        },
      },
      { $unwind: '$orderInfo' },
      {
        $group: {
          _id: {
            $ifNull: ['$orderInfo.currentStatus', '$orderInfo.status'],
          },
          count: { $sum: 1 },
        },
      },
    ]);

    normalizedBreakdown = directFallback;
    totalOrders = directFallback.reduce((sum, item) => sum + (item.count || 0), 0);
  }

  const statusData = normalizedBreakdown.reduce((acc, item) => {
    acc[item._id || 'unknown'] = {
      count: item.count,
      percentage: totalOrders > 0 ? ((item.count / totalOrders) * 100).toFixed(1) : 0,
    };
    return acc;
  }, {});

  res.status(200).json({
    status: 'success',
    data: {
      statusBreakdown: statusData,
      totalOrders,
    },
  });
});

/**
 * Get Seller Top Products
 * GET /seller/analytics/products/top
 */
exports.getSellerTopProducts = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const limit = parseInt(req.query.limit) || 10;

  // Top Selling Products
  const topSelling = await OrderItem.aggregate([
    {
      $lookup: {
        from: 'sellerorders',
        localField: 'order',
        foreignField: 'order',
        as: 'sellerOrders',
      },
    },
    {
      $match: {
        'sellerOrders.seller': new mongoose.Types.ObjectId(sellerId),
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
        productImage: '$productInfo.imageCover',
        price: '$productInfo.price',
        stock: '$productInfo.stock',
        views: '$productInfo.views',
        totalSold: 1,
        totalRevenue: 1,
        totalOrders: 1,
        conversionRate: {
          $cond: [
            { $gt: ['$productInfo.views', 0] },
            { $multiply: [{ $divide: [{ $size: '$totalOrders' }, '$productInfo.views'] }, 100] },
            0,
          ],
        },
      },
    },
  ]);

  // Highest Viewed Products
  const highestViewed = await Product.find({
    seller: sellerId,
    active: true,
  })
    .sort('-views')
    .limit(limit)
    .select('name imageCover price stock views')
    .lean();

  // Low Stock Products
  const lowStock = await Product.find({
    seller: sellerId,
    stock: { $lte: 10, $gt: 0 },
    active: true,
  })
    .sort('stock')
    .limit(limit)
    .select('name imageCover price stock')
    .lean();

  // Out of Stock Products
  const outOfStock = await Product.find({
    seller: sellerId,
    stock: { $lte: 0 },
    active: true,
  })
    .limit(limit)
    .select('name imageCover price stock')
    .lean();

  // Most Wishlisted Products
  const mostWishlisted = await Product.find({
    seller: sellerId,
    active: true,
  })
    .sort('-wishlistCount')
    .limit(limit)
    .select('name imageCover price stock wishlistCount')
    .lean();

  res.status(200).json({
    status: 'success',
    data: {
      topSellingProducts: topSelling,
      highestViewedProducts: highestViewed,
      lowStockProducts: lowStock,
      outOfStockProducts: outOfStock,
      mostWishlistedProducts: mostWishlisted,
    },
  });
});

/**
 * Get Seller Traffic Analytics
 * GET /seller/analytics/traffic
 */
exports.getSellerTrafficAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const sellerIdStr = String(sellerId);
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Get seller's product IDs
  const sellerProducts = await Product.find({ seller: sellerId }).select('_id').lean();
  const productIds = sellerProducts.map(p => p._id);
  const productIdStrings = productIds.map(id => id.toString());

  if (productIdStrings.length === 0) {
    // Even if seller has no products yet, buyers may still view seller profile page.
    const sellerPageVisitorAgg = await ActivityLog.aggregate([
      {
        $match: {
          action: 'VIEW_PAGE',
          role: 'buyer',
          timestamp: { $gte: startDate },
          $or: [
            { 'metadata.sellerId': sellerIdStr },
            { 'metadata.seller._id': sellerIdStr },
          ],
        },
      },
      {
        $group: {
          _id: null,
          visitorIds: { $addToSet: '$userId' },
          views: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          uniqueVisitors: {
            $size: {
              $filter: {
                input: '$visitorIds',
                as: 'visitor',
                cond: { $ne: ['$$visitor', null] },
              },
            },
          },
          views: 1,
        },
      },
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        range,
        productViews: [],
        sellerPageViews: Number(sellerPageVisitorAgg[0]?.views || 0),
        uniqueVisitors: Number(sellerPageVisitorAgg[0]?.uniqueVisitors || 0),
        addToCartEvents: 0,
        orders: [],
        mostVisitedProducts: [],
        conversionRate: 0,
        totalViews: Number(sellerPageVisitorAgg[0]?.views || 0),
        totalOrders: 0,
      },
    });
  }

  // Product page views
  const productViews = await ActivityLog.aggregate([
    {
      $match: {
        action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
        role: 'buyer',
        timestamp: { $gte: startDate },
        $or: [
          { 'metadata.productId': { $in: productIdStrings } },
          { 'metadata.product._id': { $in: productIdStrings } },
        ],
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
        },
        views: { $sum: 1 },
        uniqueVisitors: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        date: '$_id',
        views: 1,
        uniqueVisitors: { $size: '$uniqueVisitors' },
      },
    },
    { $sort: { date: 1 } },
  ]);

  // Add to cart events
  const addToCartEvents = await ActivityLog.countDocuments({
    action: 'ADD_TO_CART',
    timestamp: { $gte: startDate },
    $or: [{ 'metadata.productId': { $in: productIdStrings } }],
  });

  // Orders (conversions)
  const orders = await SellerOrder.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Most visited product pages
  const mostVisitedProducts = await ActivityLog.aggregate([
    {
      $match: {
        action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
        role: 'buyer',
        timestamp: { $gte: startDate },
        $or: [
          { 'metadata.productId': { $in: productIdStrings } },
          { 'metadata.product._id': { $in: productIdStrings } },
        ],
      },
    },
    {
      $group: {
        _id: {
          $ifNull: ['$metadata.productId', '$metadata.product._id'],
        },
        views: { $sum: 1 },
      },
    },
    { $sort: { views: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        productId: '$_id',
        productName: '$productInfo.name',
        productImage: '$productInfo.imageCover',
        views: 1,
      },
    },
  ]);

  // Distinct buyer visitors across BOTH product pages and seller page.
  const uniqueBuyerVisitorsAgg = await ActivityLog.aggregate([
    {
      $match: {
        action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
        role: 'buyer',
        timestamp: { $gte: startDate },
        $or: [
          { 'metadata.productId': { $in: productIdStrings } },
          { 'metadata.product._id': { $in: productIdStrings } },
          { 'metadata.sellerId': sellerIdStr },
          { 'metadata.seller._id': sellerIdStr },
        ],
      },
    },
    {
      $group: {
        _id: null,
        visitorIds: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        _id: 0,
        uniqueVisitors: {
          $size: {
            $filter: {
              input: '$visitorIds',
              as: 'visitor',
              cond: { $ne: ['$$visitor', null] },
            },
          },
        },
      },
    },
  ]);

  const sellerPageViews = await ActivityLog.countDocuments({
    action: 'VIEW_PAGE',
    role: 'buyer',
    timestamp: { $gte: startDate },
    $or: [
      { 'metadata.sellerId': sellerIdStr },
      { 'metadata.seller._id': sellerIdStr },
    ],
  });

  const totalViews = productViews.reduce((sum, day) => sum + (day.views || 0), 0);
  const totalViewsWithSellerPage = totalViews + sellerPageViews;
  const uniqueVisitors = Number(uniqueBuyerVisitorsAgg[0]?.uniqueVisitors || 0);
  const totalOrders = orders.reduce((sum, day) => sum + (day.orders || 0), 0);
  const conversionRate =
    totalViewsWithSellerPage > 0
      ? (totalOrders / totalViewsWithSellerPage * 100).toFixed(2)
      : 0;

  res.status(200).json({
    status: 'success',
    data: {
      range,
      productViews,
      sellerPageViews,
      uniqueVisitors,
      addToCartEvents,
      orders: orders.map(day => ({
        date: day._id,
        orders: day.orders || 0,
      })),
      mostVisitedProducts,
      conversionRate: parseFloat(conversionRate),
      totalViews: totalViewsWithSellerPage,
      totalOrders,
    },
  });
});

/**
 * Get Seller Payout Analytics
 * GET /seller/analytics/payouts
 */
exports.getSellerPayoutAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Total Withdrawn
  const totalWithdrawn = await PaymentRequest.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['paid', 'approved'] },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amountPaidToSeller' },
      },
    },
  ]);

  // Pending Withdrawal
  const pendingWithdrawal = await PaymentRequest.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['pending', 'awaiting_paystack_otp'] },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amountRequested' },
      },
    },
  ]);

  // Withholding Tax Deducted
  const withholdingTax = await TaxCollection.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
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
  ]);

  // Payout Timeline
  const payoutTimeline = await PaymentRequest.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['paid', 'approved'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        totalPayout: { $sum: '$amountPaidToSeller' },
        withholdingTax: { $sum: '$withholdingTax' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Last 10 Payouts
  const lastPayouts = await PaymentRequest.find({
    seller: sellerId,
    status: { $in: ['paid', 'approved', 'pending', 'awaiting_paystack_otp'] },
  })
    .sort('-createdAt')
    .limit(10)
    .select('amountRequested amountPaidToSeller withholdingTax withholdingTaxRate status createdAt')
    .lean();

  // Get seller balance info
  const seller = await Seller.findById(sellerId);
  const availableBalance = seller?.withdrawableBalance || seller?.balance - (seller?.lockedBalance || 0) - (seller?.pendingBalance || 0) || 0;

  res.status(200).json({
    status: 'success',
    data: {
      totalWithdrawn: totalWithdrawn[0]?.total || 0,
      pendingWithdrawal: pendingWithdrawal[0]?.total || 0,
      withholdingTaxDeducted: withholdingTax[0]?.total || 0,
      withholdingBreakdown: {
        individual: withholdingTax[0]?.individual || 0,
        company: withholdingTax[0]?.company || 0,
      },
      payoutTimeline: payoutTimeline.map(day => ({
        date: day._id,
        totalPayout: day.totalPayout || 0,
        withholdingTax: day.withholdingTax || 0,
        count: day.count || 0,
      })),
      lastPayouts: lastPayouts.map(payout => ({
        amountRequested: payout.amountRequested || 0,
        amountPaid: payout.amountPaidToSeller || 0,
        withholdingTax: payout.withholdingTax || 0,
        withholdingRate: payout.withholdingTaxRate || 0,
        status: payout.status,
        date: payout.createdAt,
      })),
      availableBalance,
      totalBalance: seller?.balance || 0,
      lockedBalance: seller?.lockedBalance || 0,
      pendingBalance: seller?.pendingBalance || 0,
    },
  });
});

/**
 * Get Seller Tax Analytics
 * GET /seller/analytics/tax
 */
exports.getSellerTaxAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Tax breakdown from seller orders
  const taxBreakdown = await SellerOrder.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['delivered', 'paid'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalVAT: { $sum: '$totalVAT' },
        totalNHIL: { $sum: '$totalNHIL' },
        totalGETFund: { $sum: '$totalGETFund' },
        totalBasePrice: { $sum: '$totalBasePrice' },
        totalRevenue: { $sum: '$total' },
      },
    },
  ]);

  // Withholding tax
  const withholdingTax = await TaxCollection.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
        dateCollected: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
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
  ]);

  const breakdown = taxBreakdown[0] || {
    totalVAT: 0,
    totalNHIL: 0,
    totalGETFund: 0,
    totalBasePrice: 0,
    totalRevenue: 0,
  };

  res.status(200).json({
    status: 'success',
    data: {
      range,
      taxBreakdown: {
        totalVAT: breakdown.totalVAT,
        totalNHIL: breakdown.totalNHIL,
        totalGETFund: breakdown.totalGETFund,
        totalTax: breakdown.totalVAT + breakdown.totalNHIL + breakdown.totalGETFund,
      },
      withholdingTax: {
        total: withholdingTax[0]?.total || 0,
        individual: withholdingTax[0]?.individual || 0,
        company: withholdingTax[0]?.company || 0,
      },
      sellerRevenue: {
        totalBasePrice: breakdown.totalBasePrice,
        totalRevenue: breakdown.totalRevenue,
        netRevenue: breakdown.totalBasePrice - (withholdingTax[0]?.total || 0),
      },
    },
  });
});

/**
 * Get Seller Inventory Analytics
 * GET /seller/analytics/inventory
 */
exports.getSellerInventoryAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);

  // Low Stock Products
  const lowStock = await Product.find({
    seller: sellerId,
    stock: { $lte: 10, $gt: 0 },
    active: true,
  })
    .sort('stock')
    .limit(50)
    .select('name imageCover price stock category')
    .lean();

  // Out of Stock Products
  const outOfStock = await Product.find({
    seller: sellerId,
    stock: { $lte: 0 },
    active: true,
  })
    .select('name imageCover price stock category')
    .lean();

  // Inventory Summary
  const inventorySummary = await Product.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        active: true,
      },
    },
    {
      $group: {
        _id: null,
        totalSKUs: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        inventoryValue: { $sum: { $multiply: ['$price', '$stock'] } },
        lowStock: {
          $sum: { $cond: [{ $lte: ['$stock', 10] }, 1, 0] },
        },
        outOfStock: {
          $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] },
        },
      },
    },
  ]);

  // Items Added This Week
  const itemsAddedThisWeek = await Product.countDocuments({
    seller: sellerId,
    createdAt: { $gte: lastWeek },
  });

  // Items Updated This Week
  const itemsUpdatedThisWeek = await Product.countDocuments({
    seller: sellerId,
    updatedAt: { $gte: lastWeek },
    createdAt: { $lt: lastWeek },
  });

  res.status(200).json({
    status: 'success',
    data: {
      lowStockProducts: lowStock,
      outOfStockProducts: outOfStock,
      inventorySummary: inventorySummary[0] || {
        totalSKUs: 0,
        totalStock: 0,
        inventoryValue: 0,
        lowStock: 0,
        outOfStock: 0,
      },
      itemsAddedThisWeek,
      itemsUpdatedThisWeek,
    },
  });
});

/**
 * Get Seller Refund Analytics
 * GET /seller/analytics/refunds
 */
exports.getSellerRefundAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Get seller orders with refunds
  const refundedOrders = await SellerOrder.find({
    seller: sellerId,
    status: 'returned',
    updatedAt: { $gte: startDate },
  }).lean();

  // Refund breakdown
  const refundBreakdown = await SellerOrder.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: 'returned',
        updatedAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$total' },
      },
    },
  ]);

  // Total orders for refund rate calculation
  const totalOrders = await SellerOrder.countDocuments({
    seller: sellerId,
    createdAt: { $gte: startDate },
  });

  // Refunds by product
  const refundsByProduct = await OrderItem.aggregate([
    {
      $lookup: {
        from: 'sellerorders',
        localField: 'order',
        foreignField: 'order',
        as: 'sellerOrders',
      },
    },
    {
      $match: {
        'sellerOrders.seller': new mongoose.Types.ObjectId(sellerId),
        'sellerOrders.status': 'returned',
      },
    },
    {
      $group: {
        _id: '$product',
        refundCount: { $sum: 1 },
        refundAmount: { $sum: { $multiply: ['$price', '$quantity'] } },
      },
    },
    { $sort: { refundCount: -1 } },
    { $limit: 10 },
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
        productImage: '$productInfo.imageCover',
        refundCount: 1,
        refundAmount: 1,
      },
    },
  ]);

  const refundCount = refundedOrders.length;
  const refundRate = totalOrders > 0 ? ((refundCount / totalOrders) * 100).toFixed(2) : 0;

  res.status(200).json({
    status: 'success',
    data: {
      refundRequests: refundCount,
      approvedRefunds: refundCount, // Assuming returned status means approved
      rejectedRefunds: 0, // Would need separate status tracking
      refundRate: parseFloat(refundRate),
      refundsByProduct,
      totalRefundAmount: refundBreakdown.reduce((sum, item) => sum + (item.totalAmount || 0), 0),
    },
  });
});

/**
 * Get Seller Performance Score
 * GET /seller/analytics/performance
 */
exports.getSellerPerformanceScore = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // On-time delivery rate
  const totalDelivered = await SellerOrder.countDocuments({
    seller: sellerId,
    status: 'delivered',
    createdAt: { $gte: startDate },
  });

  // Assuming on-time if delivered within expected timeframe
  // This is simplified - you'd need actual delivery estimates
  const onTimeDelivered = totalDelivered; // Simplified
  const onTimeDeliveryRate = totalDelivered > 0 ? (onTimeDelivered / totalDelivered) * 100 : 100;

  // Response rate (from support tickets - simplified)
  const responseRate = 90; // Placeholder - would need actual support ticket data

  // Product quality score (from reviews)
  const sellerReviews = await Product.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
      },
    },
    {
      $lookup: {
        from: 'reviews',
        localField: '_id',
        foreignField: 'product',
        as: 'reviews',
      },
    },
    {
      $project: {
        avgRating: { $avg: '$reviews.rating' },
      },
    },
  ]);

  const avgRating = sellerReviews.length > 0
    ? sellerReviews.reduce((sum, p) => sum + (p.avgRating || 0), 0) / sellerReviews.length
    : 5;
  const productQualityScore = (avgRating / 5) * 100;

  // Return rate (negative factor)
  const totalOrders = await SellerOrder.countDocuments({
    seller: sellerId,
    createdAt: { $gte: startDate },
  });
  const returnedOrders = await SellerOrder.countDocuments({
    seller: sellerId,
    status: 'returned',
    createdAt: { $gte: startDate },
  });
  const returnRate = totalOrders > 0 ? (returnedOrders / totalOrders) * 100 : 0;

  // Calculate performance score
  const score = (onTimeDeliveryRate * 0.4) +
    (responseRate * 0.2) +
    (productQualityScore * 0.2) -
    (returnRate * 0.2);

  const finalScore = Math.max(0, Math.min(100, score));

  // Determine badge
  let performanceBadge = 'poor';
  if (finalScore >= 90) performanceBadge = 'gold';
  else if (finalScore >= 75) performanceBadge = 'silver';
  else if (finalScore >= 60) performanceBadge = 'bronze';

  res.status(200).json({
    status: 'success',
    data: {
      sellerScore: parseFloat(finalScore.toFixed(1)),
      performanceBadge,
      breakdown: {
        onTimeDeliveryRate: parseFloat(onTimeDeliveryRate.toFixed(1)),
        responseRate: parseFloat(responseRate.toFixed(1)),
        productQualityScore: parseFloat(productQualityScore.toFixed(1)),
        returnRate: parseFloat(returnRate.toFixed(1)),
      },
    },
  });
});

