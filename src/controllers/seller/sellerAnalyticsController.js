const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const SellerOrder = require('../../models/order/sellerOrderModel');
const OrderItem = require('../../models/order/OrderItemModel');
const Product = require('../../models/product/productModel');
const ActivityLog = require('../../models/activityLog/activityLogModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const TaxCollection = require('../../models/tax/taxCollectionModel');
const Seller = require('../../models/user/sellerModel');
const mongoose = require('mongoose');

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

  // Today's Revenue (VAT-exclusive basePrice)
  const todayOrders = await SellerOrder.find({
    seller: sellerId,
    status: { $in: ['delivered', 'paid'] },
    createdAt: { $gte: today },
  });
  const revenueToday = todayOrders.reduce((sum, order) => sum + (order.totalBasePrice || 0), 0);

  // Yesterday's Revenue (for comparison)
  const yesterdayOrders = await SellerOrder.find({
    seller: sellerId,
    status: { $in: ['delivered', 'paid'] },
    createdAt: { $gte: yesterday, $lt: today },
  });
  const revenueYesterday = yesterdayOrders.reduce((sum, order) => sum + (order.totalBasePrice || 0), 0);
  const revenueTodayChange = revenueYesterday > 0
    ? ((revenueToday - revenueYesterday) / revenueYesterday * 100).toFixed(1)
    : revenueToday > 0 ? 100 : 0;

  // This Week's Revenue
  const weekOrders = await SellerOrder.find({
    seller: sellerId,
    status: { $in: ['delivered', 'paid'] },
    createdAt: { $gte: lastWeek },
  });
  const revenueThisWeek = weekOrders.reduce((sum, order) => sum + (order.totalBasePrice || 0), 0);

  // Previous Week's Revenue (for comparison)
  const previousWeekOrders = await SellerOrder.find({
    seller: sellerId,
    status: { $in: ['delivered', 'paid'] },
    createdAt: { $gte: last14Days, $lt: lastWeek },
  });
  const revenuePreviousWeek = previousWeekOrders.reduce((sum, order) => sum + (order.totalBasePrice || 0), 0);
  const revenueWeekChange = revenuePreviousWeek > 0
    ? ((revenueThisWeek - revenuePreviousWeek) / revenuePreviousWeek * 100).toFixed(1)
    : revenueThisWeek > 0 ? 100 : 0;

  // Total Orders Today
  const ordersToday = await SellerOrder.countDocuments({
    seller: sellerId,
    createdAt: { $gte: today },
  });

  // Pending Orders
  const pendingOrders = await SellerOrder.countDocuments({
    seller: sellerId,
    status: { $in: ['pending', 'confirmed', 'processing'] },
  });

  // Total Products Live
  const totalProductsLive = await Product.countDocuments({
    seller: sellerId,
    active: true,
  });

  // Available Balance (after withholding tax)
  const seller = await Seller.findById(sellerId);
  const availableBalance = seller?.withdrawableBalance || seller?.balance - (seller?.lockedBalance || 0) - (seller?.pendingBalance || 0) || 0;

  res.status(200).json({
    status: 'success',
    data: {
      revenueToday: {
        value: revenueToday,
        change: parseFloat(revenueTodayChange),
        label: "Today's Revenue",
      },
      revenueThisWeek: {
        value: revenueThisWeek,
        change: parseFloat(revenueWeekChange),
        label: "This Week's Revenue",
      },
      ordersToday: {
        value: ordersToday,
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
  const sellerId = req.user.id;
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Daily Revenue Timeline
  const revenueTimeline = await SellerOrder.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['delivered', 'paid'] },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        revenue: { $sum: '$totalBasePrice' },
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
        sellerId: new mongoose.Types.ObjectId(sellerId),
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
        seller: new mongoose.Types.ObjectId(sellerId),
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
  const sellerId = req.user.id;

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

  const totalOrders = await SellerOrder.countDocuments({ seller: sellerId });

  const statusData = statusBreakdown.reduce((acc, item) => {
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
  const range = parseInt(req.query.range) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Get seller's product IDs
  const sellerProducts = await Product.find({ seller: sellerId }).select('_id').lean();
  const productIds = sellerProducts.map(p => p._id);

  // Product page views
  const productViews = await ActivityLog.aggregate([
    {
      $match: {
        action: { $in: ['VIEW_PRODUCT', 'VIEW_PAGE'] },
        timestamp: { $gte: startDate },
        metadata: {
          $or: [
            { productId: { $in: productIds.map(id => id.toString()) } },
            { 'product._id': { $in: productIds.map(id => id.toString()) } },
          ],
        },
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
    metadata: {
      $or: [
        { productId: { $in: productIds.map(id => id.toString()) } },
      ],
    },
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
        timestamp: { $gte: startDate },
        metadata: {
          $or: [
            { productId: { $exists: true } },
            { 'product._id': { $exists: true } },
          ],
        },
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

  const totalViews = productViews.reduce((sum, day) => sum + (day.views || 0), 0);
  const totalOrders = orders.reduce((sum, day) => sum + (day.orders || 0), 0);
  const conversionRate = totalViews > 0 ? (totalOrders / totalViews * 100).toFixed(2) : 0;

  res.status(200).json({
    status: 'success',
    data: {
      range,
      productViews,
      addToCartEvents,
      orders: orders.map(day => ({
        date: day._id,
        orders: day.orders || 0,
      })),
      mostVisitedProducts,
      conversionRate: parseFloat(conversionRate),
      totalViews,
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
        totalCovidLevy: { $sum: '$totalCovidLevy' },
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
    totalCovidLevy: 0,
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
        totalCovidLevy: breakdown.totalCovidLevy,
        totalTax: breakdown.totalVAT + breakdown.totalNHIL + breakdown.totalGETFund + breakdown.totalCovidLevy,
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

