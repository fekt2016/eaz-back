const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');
const SaiisaiShippingFees = require('../../models/shipping/saiisaiShippingFeesModel');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const OrderItem = require('../../models/order/OrderItemModel');
const PickupCenter = require('../../models/shipping/pickupCenterModel');
const SellerRevenueHistory = require('../../models/history/sellerRevenueHistoryModel');
const Transaction = require('../../models/transaction/transactionModel');
const orderService = require('../../services/order/orderService');
const mongoose = require('mongoose');

// Saiisai Seller ID constant
const SAIISAI_SELLER_ID = '6970b22eaba06cadfd4b8035';
const LEGACY_EAZSHOP_SELLER_ID = '000000000000000000000001';

/**
 * Build a resilient SellerOrder filter for Official Store flows.
 * Includes:
 * - legacy/current EazShop seller IDs
 * - sellerType = eazshop
 * - fallback item-level match for orders containing Official Store products
 */
async function buildOfficialStoreSellerOrderFilter() {
  const legacyIds = [LEGACY_EAZSHOP_SELLER_ID, SAIISAI_SELLER_ID];

  const officialProducts = await Product.find({
    $or: [
      { isEazShopProduct: true },
      { isEazShopProduct: 'true' },
      { seller: SAIISAI_SELLER_ID },
    ],
  })
    .select('_id')
    .lean();

  const officialProductIds = officialProducts.map((p) => p._id);

  const filter = {
    $or: [
      { seller: { $in: legacyIds } },
      { sellerType: 'eazshop' },
    ],
  };

  if (officialProductIds.length > 0) {
    const orderItems = await OrderItem.find({
      product: { $in: officialProductIds },
    })
      .select('_id')
      .lean();

    const officialOrderItemIds = orderItems.map((i) => i._id);
    if (officialOrderItemIds.length > 0) {
      filter.$or.push({ items: { $in: officialOrderItemIds } });
    }
  }

  return {
    filter,
    legacyIds,
    officialProductIds,
  };
}

/**
 * Get all Saiisai products (public - for homepage/display)
 * Only returns active products
 */
exports.getPublicOfficialStoreProducts = catchAsync(async (req, res, next) => {
  // CRITICAL: Use $and to ensure all conditions must be met
  // This explicitly excludes deleted products in multiple ways
  const query = {
    $and: [
      {
        $or: [
          { isEazShopProduct: true },
          { isEazShopProduct: 'true' },
          { seller: SAIISAI_SELLER_ID },
        ],
      },
      {
        // Only buyer-visible statuses
        status: { $in: ['active', 'out_of_stock', 'outOfStock'] },
      },
      {
        // Keep this aligned with order validation in orderController:
        // products must be moderationStatus === 'approved' to be purchased.
        moderationStatus: 'approved',
      },
      {
        // Exclude deleted products - check all possible deletion states
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false },
          { isDeleted: null },
        ],
      },
      {
        $or: [
          { isDeletedByAdmin: { $exists: false } },
          { isDeletedByAdmin: false },
          { isDeletedByAdmin: null },
        ],
      },
      {
        $or: [
          { isDeletedBySeller: { $exists: false } },
          { isDeletedBySeller: false },
          { isDeletedBySeller: null },
        ],
      },
    ],
  };

  const products = await Product.find(query)
    .populate('seller', 'shopName name')
    .populate('parentCategory', 'name slug')
    .populate('subCategory', 'name slug')
    .select('-__v') // Exclude version field
    .sort({ createdAt: -1 })
    .limit(50); // Limit for performance

  // CRITICAL: Additional server-side filter as final safety check
  // This catches any products that might have slipped through the query
  const filteredProducts = products.filter(product => {
    // Convert to plain object if it's a Mongoose document
    const productObj = product.toObject ? product.toObject() : product;

    // Double-check: exclude any products that are marked as deleted
    const isDeleted = productObj.isDeleted === true ||
      productObj.isDeletedByAdmin === true ||
      productObj.isDeletedBySeller === true ||
      productObj.status === 'archived' ||
      productObj.status === 'inactive' ||
      productObj.moderationStatus !== 'approved';

    if (isDeleted) {
      console.warn(`[getPublicOfficialStoreProducts] ⚠️ Filtered out deleted product: ${productObj._id} - ${productObj.name}`, {
        isDeleted: productObj.isDeleted,
        isDeletedByAdmin: productObj.isDeletedByAdmin,
        isDeletedBySeller: productObj.isDeletedBySeller,
        status: productObj.status,
      });
      return false;
    }
    return true;
  });

  // Log for debugging
  console.log(`[getPublicOfficialStoreProducts] Query returned ${products.length} products, filtered to ${filteredProducts.length}`);

  res.status(200).json({
    status: 'success',
    results: filteredProducts.length,
    data: { products: filteredProducts },
  });
});

/**
 * Get all Saiisai products (admin - includes all statuses)
 */
exports.getOfficialStoreProducts = catchAsync(async (req, res, next) => {
  const products = await Product.find({
    $or: [
      { isEazShopProduct: true },
      { isEazShopProduct: 'true' },
      { seller: SAIISAI_SELLER_ID },
    ],
  })
    .populate('seller', 'shopName name')
    .populate('parentCategory', 'name slug')
    .populate('subCategory', 'name slug')
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: { products },
  });
});

/**
 * Parse and normalize req.body variants/specifications (match seller product controller).
 * Returns true if an error was passed to next(), so caller should return.
 */
function parseAndNormalizeProductBody(req, next) {
  // Parse variants from JSON string (multipart/form-data sends strings)
  if (req.body.variants != null) {
    if (typeof req.body.variants === 'string') {
      try {
        req.body.variants = JSON.parse(req.body.variants);
      } catch (err) {
        next(new AppError('Invalid variants format', 400));
        return true;
      }
    }
    if (!Array.isArray(req.body.variants)) {
      next(new AppError('Variants must be an array', 400));
      return true;
    }
    req.body.variants = req.body.variants.map((variant) => {
      let attributes = variant.attributes || [];
      if (!Array.isArray(attributes)) attributes = [];
      attributes = attributes.filter(attr => attr && attr.key && attr.value);
      if (attributes.length === 0) attributes = [{ key: 'Default', value: 'N/A' }];
      return {
        ...variant,
        attributes,
        price: parseFloat(variant.price) || 0,
        stock: parseInt(variant.stock) || 0,
        sku: variant.sku || '',
        status: variant.status || 'active',
        condition: variant.condition || 'new',
      };
    });
  }

  // Parse specifications from JSON string
  if (req.body.specifications != null && typeof req.body.specifications === 'string') {
    try {
      req.body.specifications = JSON.parse(req.body.specifications);
    } catch (err) {
      next(new AppError('Invalid specifications format', 400));
      return true;
    }
  }

  // Manufacturer string -> object
  if (req.body.manufacturer !== undefined && typeof req.body.manufacturer === 'string' && req.body.manufacturer.trim() !== '') {
    req.body.manufacturer = { name: req.body.manufacturer.trim() };
  }
  return false;
}

/**
 * Create EazShop product
 */
exports.createEazShopProduct = catchAsync(async (req, res, next) => {
  if (parseAndNormalizeProductBody(req, next)) return;

  // Admin-created Official Store products are platform-owned (Main EazShop).
  req.body.seller = SAIISAI_SELLER_ID;
  req.body.isEazShopProduct = true;
  req.body.supplierSeller = null;
  req.body.moderationStatus = 'approved';
  if (!req.body.status) req.body.status = 'active';

  const product = await Product.create(req.body);

  res.status(201).json({
    status: 'success',
    data: { product },
  });
});

/**
 * Update Saiisai product
 */
exports.updateOfficialStoreProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Verify it's an Official Store product
  const isOfficialProduct = product.isEazShopProduct ||
    product.seller?.toString() === SAIISAI_SELLER_ID;

  if (!isOfficialProduct) {
    return next(new AppError('This product is not a Saiisai product', 403));
  }

  if (parseAndNormalizeProductBody(req, next)) return;

  // Keep existing ownership semantics:
  // - platform-created items stay Main EazShop (seller = SAIISAI, no supplierSeller)
  // - accepted seller items keep seller ownership and supplierSeller link.
  req.body.isEazShopProduct = true;
  req.body.moderationStatus = 'approved';

  const rawSellerId = product.seller?.toString?.() || product.seller;
  if (rawSellerId && rawSellerId !== SAIISAI_SELLER_ID) {
    req.body.supplierSeller = product.supplierSeller || product.seller;
  } else {
    req.body.supplierSeller = null;
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  res.status(200).json({
    status: 'success',
    data: { product: updatedProduct },
  });
});

/**
 * Toggle Saiisai product status (activate/deactivate)
 */
exports.toggleOfficialStoreProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Verify it's an Official Store product
  const isOfficialStoreProduct = product.isEazShopProduct ||
    product.seller?.toString() === SAIISAI_SELLER_ID;

  if (!isOfficialStoreProduct) {
    return next(new AppError('This product is not a Saiisai product', 403));
  }

  // Toggle status
  const newStatus = product.status === 'active' ? 'inactive' : 'active';
  product.status = newStatus;
  await product.save();

  res.status(200).json({
    status: 'success',
    data: { product },
  });
});

/**
 * Mark existing product as Saiisai product
 */
exports.markProductAsOfficial = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  product.isEazShopProduct = true;
  product.moderationStatus = 'approved';
  product.status = 'active';

  // If a seller's product is being promoted into EazShop/Official Store,
  // ensure the original seller is credited after order delivery.
  // OrderService uses Product.supplierSeller to decide who gets credited.
  const rawSellerId = product.seller?.toString?.() || product.seller;
  const currentSupplierSeller = product.supplierSeller?.toString?.() || product.supplierSeller;
  if (rawSellerId && rawSellerId !== SAIISAI_SELLER_ID) {
    // Only set supplierSeller when it's missing; avoid overwriting if already
    // configured for some reason.
    if (!currentSupplierSeller) {
      product.supplierSeller = product.seller;
    }
  } else {
    // Platform-owned products should not have a supplierSeller override.
    product.supplierSeller = null;
  }

  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product marked as Official Store product',
    data: { product },
  });
});

/**
 * Unmark product as Official Store product (convert back to regular product)
 */
exports.unmarkProductAsOfficial = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Only allow if product was marked as Official (not if seller is Saiisai)
  if (!product.isEazShopProduct) {
    return next(new AppError('This product is not marked as Saiisai product', 400));
  }

  // Unmark as Official Store product (but keep original seller if it was changed)
  product.isEazShopProduct = false;
  product.supplierSeller = null;
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product unmarked as Saiisai product',
    data: { product },
  });
});

/**
 * Get Official Store orders
 */
exports.getOfficialStoreOrders = catchAsync(async (req, res, next) => {
  // STRICT official-store scope for orders list:
  // use order-time markers only to avoid pulling historical non-official orders
  // when a product is marked official later.
  const legacyIds = [LEGACY_EAZSHOP_SELLER_ID, SAIISAI_SELLER_ID];
  const orderFilter = {
    $or: [
      { seller: { $in: legacyIds } },
      { sellerType: 'eazshop' },
    ],
  };

  const sellerOrders = await SellerOrder.find({
    ...orderFilter,
  })
    .populate({
      path: 'order',
      populate: { path: 'user', select: 'name email' },
    })
    .populate({
      path: 'items',
      populate: { path: 'product', select: '_id isEazShopProduct seller' },
    })
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: sellerOrders.length,
    data: { orders: sellerOrders },
  });
});

/**
 * Official Store analytics (EazShop main vs accepted sellers credits)
 * GET /api/v1/eazshop/analytics?range=7|30|90|365&page=1&limit=10
 */
exports.getOfficialStoreAnalytics = catchAsync(async (req, res, next) => {
  const range = parseInt(req.query.range, 10) || 30;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  const includeDebug =
    String(req.query.debug || req.query.includeMatchReason || '')
      .toLowerCase() === 'true';
  const reconcileParam = String(
    req.query.reconcile ?? req.query.reconciliation ?? 'true',
  ).toLowerCase();
  const shouldReconcile = reconcileParam !== 'false';

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - range);
  startDate.setHours(0, 0, 0, 0);

  // Canonical main seller id for analytics output and bucketing.
  const canonicalEazshopSellerId = SAIISAI_SELLER_ID;
  const canonicalEazshopSellerObjectId = new mongoose.Types.ObjectId(
    canonicalEazshopSellerId,
  );
  const legacyEazshopSellerObjectId = new mongoose.Types.ObjectId(
    LEGACY_EAZSHOP_SELLER_ID,
  );

  const { filter: sellerOrderFilter } = await buildOfficialStoreSellerOrderFilter();
  const officialSellerOrders = await SellerOrder.find(sellerOrderFilter)
    .select('order')
    .lean();
  const officialOrderIds = [
    ...new Set(
      officialSellerOrders
        .map((so) => so?.order)
        .filter(Boolean)
        .map((id) => id.toString()),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  // Optional reconciliation pass:
  // Backfill missing credits for delivered Official Store orders so they
  // appear in analytics tables. creditSellerForOrder is idempotent.
  let reconciliation = null;
  if (shouldReconcile) {
    const deliveredOfficialOrders = await Order.find({
      _id: { $in: officialOrderIds },
      $or: [
        { currentStatus: { $in: ['delivered', 'delievered'] } },
        { status: { $in: ['delivered', 'completed'] } },
        { orderStatus: 'delievered' },
      ],
    })
      .select('_id')
      .lean();

    const distinctOrderIds = [
      ...new Set(
        deliveredOfficialOrders
          .map((o) => o?._id)
          .filter(Boolean)
          .map((id) => id.toString()),
      ),
    ];

    let attempted = 0;
    let success = 0;
    const errors = [];

    for (const orderId of distinctOrderIds) {
      attempted += 1;
      try {
        const result = await orderService.creditSellerForOrder(
          orderId,
          req.user?.id,
        );
        if (result?.success) success += 1;
      } catch (err) {
        errors.push({
          orderId,
          message: err?.message || 'Reconciliation failed',
        });
      }
    }

    reconciliation = {
      attempted,
      success,
      failed: errors.length,
      errors: errors.slice(0, 10),
    };
  }

  const baseMatch = {
    type: 'ORDER_EARNING',
    orderId: { $ne: null },
    createdAt: { $gte: startDate },
    ...(officialOrderIds.length > 0
      ? {
          $or: [
            { 'metadata.platformStore': true },
            { orderId: { $in: officialOrderIds } },
          ],
        }
      : { 'metadata.platformStore': true }),
  };

  // Helper: group to get unique (orderId, sellerId) credited amounts first.
  const perSellerPipeline = [
    { $match: baseMatch },
    {
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'orderInfo',
      },
    },
    { $unwind: { path: '$orderInfo', preserveNullAndEmptyArrays: false } },
    {
      $match: {
        $or: [
          { 'orderInfo.currentStatus': { $in: ['delivered', 'delievered'] } },
          { 'orderInfo.status': { $in: ['delivered', 'completed'] } },
          { 'orderInfo.orderStatus': 'delievered' },
        ],
      },
    },
    {
      $addFields: {
        sellerIdNormalized: {
          $cond: [
            { $eq: ['$sellerId', legacyEazshopSellerObjectId] },
            canonicalEazshopSellerObjectId,
            '$sellerId',
          ],
        },
      },
    },
    {
      $group: {
        _id: { orderId: '$orderId', sellerId: '$sellerIdNormalized' },
        amount: { $sum: '$amount' },
        matchedByMetadata: {
          $max: {
            $cond: [{ $eq: ['$metadata.platformStore', true] }, 1, 0],
          },
        },
        matchedByOrderLink: {
          $max: {
            $cond: [{ $in: ['$orderId', officialOrderIds] }, 1, 0],
          },
        },
      },
    },
  ];

  // Summary totals across all matched orders.
  const summaryAgg = await SellerRevenueHistory.aggregate([
    ...perSellerPipeline,
    {
      $group: {
        _id: null,
        totalCredited: { $sum: '$amount' },
        eazshopMainAmount: {
          $sum: {
            $cond: [{ $eq: ['$_id.sellerId', canonicalEazshopSellerObjectId] }, '$amount', 0],
          },
        },
        acceptedSellersAmount: {
          $sum: {
            $cond: [
              { $ne: ['$_id.sellerId', canonicalEazshopSellerObjectId] },
              '$amount',
              0,
            ],
          },
        },
        ordersSet: { $addToSet: '$_id.orderId' },
      },
    },
    {
      $project: {
        _id: 0,
        totalCredited: 1,
        eazshopMainAmount: 1,
        acceptedSellersAmount: 1,
        ordersCount: { $size: '$ordersSet' },
      },
    },
  ]);

  const summary = summaryAgg[0] || {
    totalCredited: 0,
    eazshopMainAmount: 0,
    acceptedSellersAmount: 0,
    ordersCount: 0,
  };

  // Recent orders list with split amounts (per order).
  const ordersAgg = await SellerRevenueHistory.aggregate([
    ...perSellerPipeline,
    {
      $group: {
        _id: '$_id.orderId',
        eazshopMainAmount: {
          $sum: {
            $cond: [{ $eq: ['$_id.sellerId', canonicalEazshopSellerObjectId] }, '$amount', 0],
          },
        },
        acceptedSellersAmount: {
          $sum: {
            $cond: [
              { $ne: ['$_id.sellerId', canonicalEazshopSellerObjectId] },
              '$amount',
              0,
            ],
          },
        },
        totalCredited: { $sum: '$amount' },
        creditedFaces: { $addToSet: '$_id.sellerId' },
      },
    },
    {
      $addFields: {
        acceptedSellersCount: {
          $size: {
            $filter: {
              input: '$creditedFaces',
              as: 'sid',
              cond: { $ne: ['$$sid', canonicalEazshopSellerObjectId] },
            },
          },
        },
        creditedFacesCount: { $size: '$creditedFaces' },
        matchedByMetadata: { $max: '$matchedByMetadata' },
        matchedByOrderLink: { $max: '$matchedByOrderLink' },
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
    { $unwind: { path: '$orderInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        orderId: '$_id',
        orderNumber: '$orderInfo.orderNumber',
        date: '$orderInfo.createdAt',
        status: '$orderInfo.currentStatus',
        eazshopMainAmount: 1,
        acceptedSellersAmount: 1,
        totalCredited: 1,
        acceptedSellersCount: 1,
        creditedFacesCount: 1,
        matchedByMetadata: 1,
        matchedByOrderLink: 1,
      },
    },
    { $sort: { date: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  // Credit sellers list with one row per (orderId, sellerId).
  // Used to build "table of credit sellers order".
  const sellerCreditsAgg = await SellerRevenueHistory.aggregate([
    ...perSellerPipeline,
    {
      $lookup: {
        from: 'sellers',
        localField: '_id.sellerId',
        foreignField: '_id',
        as: 'sellerInfo',
      },
    },
    { $unwind: { path: '$sellerInfo', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'orders',
        localField: '_id.orderId',
        foreignField: '_id',
        as: 'orderInfo',
      },
    },
    { $unwind: { path: '$orderInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        orderId: '$_id.orderId',
        orderNumber: '$orderInfo.orderNumber',
        date: '$orderInfo.createdAt',
        status: '$orderInfo.currentStatus',
        sellerId: '$_id.sellerId',
        sellerName: { $ifNull: ['$sellerInfo.shopName', '$sellerInfo.name'] },
        face: {
          $cond: [
            { $eq: ['$_id.sellerId', canonicalEazshopSellerObjectId] },
            'eazshop_main',
            'accepted_seller',
          ],
        },
        amount: 1,
        matchedByMetadata: 1,
        matchedByOrderLink: 1,
      },
    },
    { $sort: { date: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  let effectiveSummary = summary;
  let effectiveOrders = ordersAgg;
  let effectiveSellerCredits = sellerCreditsAgg;
  let usedTransactionFallback = false;
  let usedDeliveredOrdersCountFallback = false;

  // Fallback: when revenue history is empty but delivery credits exist as transactions,
  // compute analytics from Transaction so delivered Official Store orders show immediately.
  if (summary.ordersCount === 0 && ordersAgg.length === 0 && sellerCreditsAgg.length === 0) {
    const txBaseMatch = {
      source: 'order_delivery',
      type: 'credit',
      status: 'completed',
      order: { $ne: null },
      createdAt: { $gte: startDate },
      ...(officialOrderIds.length > 0
        ? {
            $or: [
              { 'metadata.platformStore': true },
              { order: { $in: officialOrderIds } },
            ],
          }
        : { 'metadata.platformStore': true }),
    };

    const txPerSeller = await Transaction.aggregate([
      { $match: txBaseMatch },
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'orderInfo',
        },
      },
      { $unwind: { path: '$orderInfo', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          $or: [
            { 'orderInfo.currentStatus': { $in: ['delivered', 'delievered'] } },
            { 'orderInfo.status': { $in: ['delivered', 'completed'] } },
            { 'orderInfo.orderStatus': 'delievered' },
          ],
        },
      },
      {
        $addFields: {
          sellerIdNormalized: {
            $cond: [
              { $eq: ['$seller', legacyEazshopSellerObjectId] },
              canonicalEazshopSellerObjectId,
              '$seller',
            ],
          },
        },
      },
      {
        $group: {
          _id: { orderId: '$order', sellerId: '$sellerIdNormalized' },
          amount: { $sum: '$amount' },
          matchedByMetadata: {
            $max: {
              $cond: [{ $eq: ['$metadata.platformStore', true] }, 1, 0],
            },
          },
          matchedByOrderLink: {
            $max: {
              $cond: [{ $in: ['$order', officialOrderIds] }, 1, 0],
            },
          },
        },
      },
    ]);

    if (txPerSeller.length > 0) {
      usedTransactionFallback = true;
      const orderMap = new Map();
      const sellerIds = new Set();

      txPerSeller.forEach((row) => {
        const orderId = row._id.orderId.toString();
        const sellerId = row._id.sellerId.toString();
        sellerIds.add(sellerId);
        if (!orderMap.has(orderId)) {
          orderMap.set(orderId, {
            orderId: row._id.orderId,
            eazshopMainAmount: 0,
            acceptedSellersAmount: 0,
            totalCredited: 0,
            creditedFaces: new Set(),
            matchedByMetadata: 0,
            matchedByOrderLink: 0,
          });
        }
        const bucket = orderMap.get(orderId);
        if (sellerId === canonicalEazshopSellerId) {
          bucket.eazshopMainAmount += row.amount || 0;
        } else {
          bucket.acceptedSellersAmount += row.amount || 0;
        }
        bucket.totalCredited += row.amount || 0;
        bucket.creditedFaces.add(sellerId);
        bucket.matchedByMetadata = Math.max(bucket.matchedByMetadata, row.matchedByMetadata || 0);
        bucket.matchedByOrderLink = Math.max(bucket.matchedByOrderLink, row.matchedByOrderLink || 0);
      });

      const orderDocs = await Order.find({
        _id: { $in: [...orderMap.values()].map((v) => v.orderId) },
      })
        .select('_id orderNumber createdAt currentStatus')
        .lean();
      const orderDocMap = new Map(orderDocs.map((o) => [o._id.toString(), o]));

      const sellerDocs = await Seller.find({ _id: { $in: [...sellerIds] } })
        .select('_id shopName name')
        .lean();
      const sellerDocMap = new Map(sellerDocs.map((s) => [s._id.toString(), s]));

      effectiveOrders = [...orderMap.values()]
        .map((o) => {
          const orderInfo = orderDocMap.get(o.orderId.toString());
          return {
            orderId: o.orderId,
            orderNumber: orderInfo?.orderNumber,
            date: orderInfo?.createdAt,
            status: orderInfo?.currentStatus,
            eazshopMainAmount: o.eazshopMainAmount,
            acceptedSellersAmount: o.acceptedSellersAmount,
            totalCredited: o.totalCredited,
            acceptedSellersCount: [...o.creditedFaces].filter(
              (sid) => sid !== canonicalEazshopSellerId,
            ).length,
            creditedFacesCount: o.creditedFaces.size,
            matchedByMetadata: o.matchedByMetadata,
            matchedByOrderLink: o.matchedByOrderLink,
          };
        })
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(skip, skip + limit);

      effectiveSellerCredits = txPerSeller
        .map((c) => {
          const orderInfo = orderDocMap.get(c._id.orderId.toString());
          const sellerInfo = sellerDocMap.get(c._id.sellerId.toString());
          return {
            orderId: c._id.orderId,
            orderNumber: orderInfo?.orderNumber,
            date: orderInfo?.createdAt,
            status: orderInfo?.currentStatus,
            sellerId: c._id.sellerId,
            sellerName: sellerInfo?.shopName || sellerInfo?.name,
            face:
              c._id.sellerId.toString() === canonicalEazshopSellerId
                ? 'eazshop_main'
                : 'accepted_seller',
            amount: c.amount || 0,
            matchedByMetadata: c.matchedByMetadata || 0,
            matchedByOrderLink: c.matchedByOrderLink || 0,
          };
        })
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(skip, skip + limit);

      const allRows = txPerSeller;
      effectiveSummary = {
        totalCredited: allRows.reduce((acc, r) => acc + (r.amount || 0), 0),
        eazshopMainAmount: allRows
          .filter((r) => r._id.sellerId.toString() === canonicalEazshopSellerId)
          .reduce((acc, r) => acc + (r.amount || 0), 0),
        acceptedSellersAmount: allRows
          .filter((r) => r._id.sellerId.toString() !== canonicalEazshopSellerId)
          .reduce((acc, r) => acc + (r.amount || 0), 0),
        ordersCount: new Set(allRows.map((r) => r._id.orderId.toString())).size,
      };
    }
  }

  // Final safety net: ensure "Credited orders" is not zero when Official Store
  // orders are already delivered in the selected range but credit rows are delayed.
  if ((effectiveSummary.ordersCount || 0) === 0 && officialOrderIds.length > 0) {
    const deliveredOrdersCount = await Order.countDocuments({
      _id: { $in: officialOrderIds },
      $or: [
        { currentStatus: { $in: ['delivered', 'delievered'] } },
        { status: { $in: ['delivered', 'completed'] } },
        { orderStatus: 'delievered' },
      ],
      // Use updatedAt for delivery-time relevance. This avoids missing older
      // orders that were delivered recently.
      updatedAt: { $gte: startDate },
    });

    if (deliveredOrdersCount > 0) {
      effectiveSummary = {
        ...effectiveSummary,
        ordersCount: deliveredOrdersCount,
      };
      usedDeliveredOrdersCountFallback = true;
    }
  }

  // Keep credited rows as-is from analytics aggregation.
  // UI already separates eazshop_main vs accepted_seller using `face`.

  res.status(200).json({
    status: 'success',
    data: {
      range,
      summary: effectiveSummary,
      pagination: { page, limit },
      orders: effectiveOrders.map((o) => ({
        ...o,
        // Keep money rounding stable for the UI.
        eazshopMainAmount: Math.round((o.eazshopMainAmount || 0) * 100) / 100,
        acceptedSellersAmount:
          Math.round((o.acceptedSellersAmount || 0) * 100) / 100,
        totalCredited: Math.round((o.totalCredited || 0) * 100) / 100,
        ...(includeDebug
          ? {
              matchSource:
                o.matchedByMetadata && o.matchedByOrderLink
                  ? 'metadata_and_order_link'
                  : o.matchedByMetadata
                  ? 'metadata_platform_store'
                  : 'order_link_fallback',
            }
          : {}),
      })),
      sellerCredits: effectiveSellerCredits.map((c) => ({
        ...c,
        amount: Math.round((c.amount || 0) * 100) / 100,
        ...(includeDebug
          ? {
              matchSource:
                c.matchedByMetadata && c.matchedByOrderLink
                  ? 'metadata_and_order_link'
                  : c.matchedByMetadata
                  ? 'metadata_platform_store'
                  : 'order_link_fallback',
            }
          : {}),
      })),
      ...(includeDebug
        ? {
            debug: {
              officialOrdersMatched: officialOrderIds.length,
              filter:
                'ORDER_EARNING within range, matched by metadata.platformStore=true OR official order link',
              reconciliation,
              usedTransactionFallback,
              usedDeliveredOrdersCountFallback,
            },
          }
        : {}),
    },
  });
});

/**
 * Get Official Store shipping fees
 */
exports.getOfficialStoreShippingFees = catchAsync(async (req, res, next) => {
  const fees = await SaiisaiShippingFees.getOrCreate();

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

/**
 * Update Official Store shipping fees
 */
exports.updateOfficialStoreShippingFees = catchAsync(async (req, res, next) => {
  const fees = await SaiisaiShippingFees.getOrCreate();

  // Update fees
  if (req.body.sameCity !== undefined) fees.sameCity = req.body.sameCity;
  if (req.body.crossCity !== undefined) fees.crossCity = req.body.crossCity;
  if (req.body.heavyItem !== undefined) fees.heavyItem = req.body.heavyItem;
  if (req.body.freeDeliveryThreshold !== undefined) {
    fees.freeDeliveryThreshold = req.body.freeDeliveryThreshold;
  }

  await fees.save();

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

/**
 * Get pickup centers (for EazShop store management)
 */
exports.getPickupCenters = catchAsync(async (req, res, next) => {
  const query = {};

  // Filter by city if provided
  if (req.query.city) {
    query.city = req.query.city.toUpperCase();
  }

  // Filter by active status if provided
  if (req.query.isActive !== undefined) {
    query.isActive = req.query.isActive === 'true';
  }

  const pickupCenters = await PickupCenter.find(query).sort({ city: 1, area: 1 });

  res.status(200).json({
    status: 'success',
    results: pickupCenters.length,
    data: { pickupCenters },
  });
});

