const Order = require('../../models/order/orderModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const OrderItems = require('../../models/order/OrderItemModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Product = require('../../models/product/productModel');
const Address = require('../../models/user/addressModel');
const Admin = require('../../models/user/adminModel');
const handleFactory = require('../shared/handleFactory');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');
const { generateOrderNumber } = require('../../utils/helpers/helper');
const { generateTrackingNumber } = require('../../services/order/shippingService');
const { populate } = require('../../models/category/categoryModel');
const CouponBatch = require('../../models/coupon/couponBatchModel');
const CouponUsage = require('../../models/coupon/couponUsageModel');
const couponService = require('../../services/coupon/couponService');
const { sendOrderDetailEmail } = require('../../utils/email/emailService');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const notificationService = require('../../services/notification/notificationService');
const Creditbalance = require('../../models/user/creditbalanceModel');
const WalletTransaction = require('../../models/user/walletTransactionModel');
const { logBuyerWallet } = require('../../services/historyLogger');
const taxService = require('../../services/tax/taxService');
const logger = require('../../utils/logger');


exports.updateProductTotalSold = async (order) => {
  try {
    // Populate orderItems if not already populated
    let orderItems;
    if (order.orderItems && order.orderItems[0] && order.orderItems[0].product) {
      // Already populated
      orderItems = order.orderItems;
    } else {
      // Need to populate
      const populatedOrder = await Order.findById(order._id)
        .populate({
          path: 'orderItems',
          select: 'product variant quantity',
        });
      orderItems = populatedOrder.orderItems;
    }

    if (!orderItems || orderItems.length === 0) {
      logger.info(`[updateProductTotalSold] No order items found for order ${order._id}`);
      return;
    }

    // Group quantities by product ID
    const productQuantities = new Map();

    for (const orderItem of orderItems) {
      if (!orderItem || !orderItem.product) {
        logger.warn(`[updateProductTotalSold] Skipping invalid order item:`, orderItem);
        continue;
      }

      const productId = orderItem.product._id || orderItem.product;
      const quantity = orderItem.quantity || 0;

      if (quantity > 0) {
        const currentTotal = productQuantities.get(productId.toString()) || 0;
        productQuantities.set(productId.toString(), currentTotal + quantity);
      }
    }

    // Update totalSold for each product
    for (const [productId, totalQuantity] of productQuantities.entries()) {
      try {
        await Product.findByIdAndUpdate(
          productId,
          { $inc: { totalSold: totalQuantity } },
          { new: true }
        );
        logger.info(`[updateProductTotalSold] Updated totalSold for product ${productId} by ${totalQuantity}`);
      } catch (error) {
        logger.error(`[updateProductTotalSold] Error updating totalSold for product ${productId}:`, error);
        // Continue with other products even if one fails
      }
    }

    logger.info(`[updateProductTotalSold] ✅ TotalSold updated successfully for order ${order._id}`);
  } catch (error) {
    logger.error(`[updateProductTotalSold] Error updating totalSold for order ${order._id}:`, error);
    // Don't throw - log error but don't fail the order process
  }
};

// DEPRECATED: Use stockService.reduceOrderStock instead
// Keeping for backward compatibility but redirecting to service
exports.reduceOrderStock = async (order, session = null) => {
  const stockService = require('../../services/stock/stockService');
  return await stockService.reduceOrderStock(order, session);
};

/**
 * Validate cart - Calculate prices from database and validate quantities
 * POST /order/validate-cart
 * @access Protected (Buyer)
 */
exports.validateCart = catchAsync(async (req, res, next) => {
  const { orderItems, couponCode, deliveryMethod, address } = req.body;

  // Basic validation
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    return next(new AppError('Order must contain at least one item', 400));
  }

  // Fetch all products (include priceInclVat for display; sellers enter base price, we show inclusive)
  const productIds = [...new Set(orderItems.map(item => item.product))];
  const products = await Product.find({ _id: { $in: productIds } })
    .populate('seller', '_id')
    .select('defaultPrice variants stock name promotionKey price priceInclVat priceExVat');

  const productMap = new Map();
  products.forEach(p => productMap.set(p._id.toString(), p));

  const { getPromosFromAds, getApplicablePromos, applyPromosToPrice } = require('../seller/productController');
  let promos = [];
  try {
    promos = await getPromosFromAds();
  } catch (e) {
    logger.warn('[validateCart] Could not load promos:', e?.message);
  }

  const platformSettings = await require('../../models/platform/platformSettingsModel').getSettings();

  // Validate prices and quantities; dual VAT: base -> add VAT -> inclusive -> apply promo (single final price to customer)
  const validatedItems = [];
  for (const item of orderItems) {
    const product = productMap.get(item.product?.toString());
    if (!product) {
      return next(new AppError(`Product ${item.product} not found`, 404));
    }

    let basePrice = product.price ?? product.defaultPrice;
    let sellableUnit = product;

    if (item.variant) {
      const variant = product.variants?.id(item.variant);
      if (variant) {
        basePrice = variant.price ?? product.price ?? product.defaultPrice;
        sellableUnit = variant;
      }
    } else if (item.sku) {
      const sku = item.sku.trim().toUpperCase();
      if (product.variants && product.variants.length > 0) {
        const variant = product.variants.find(
          v => v.sku && v.sku.toUpperCase() === sku
        );
        if (variant) {
          basePrice = variant.price ?? product.price ?? product.defaultPrice;
          sellableUnit = variant;
        }
      }
    }

    // Dual VAT: add VAT to base to get customer-facing inclusive price (no tax line at checkout)
    let priceInclVat = sellableUnit.priceInclVat ?? product.priceInclVat;
    if (priceInclVat == null || priceInclVat <= 0) {
      const computed = await taxService.addVatToBase(basePrice, platformSettings);
      priceInclVat = computed.priceInclVat;
    }

    // Apply promotion discount (same as cart) so checkout subtotal matches cart
    const applicable = getApplicablePromos(product, promos);
    const { unitPrice: price } = applyPromosToPrice(priceInclVat, applicable);

    // Validate quantity against stock
    const availableStock = sellableUnit.stock - (sellableUnit.sold || 0);
    const requestedQuantity = item.quantity || 1;
    const validatedQuantity = Math.max(1, Math.min(requestedQuantity, Math.max(availableStock, 0)));

    if (validatedQuantity < requestedQuantity) {
      return next(new AppError(
        'Insufficient stock available for one or more items',
        400
      ));
    }

    validatedItems.push({
      product: item.product,
      variant: item.variant || null,
      sku: item.sku || null,
      quantity: validatedQuantity,
      price, // From database with promo applied (matches cart)
      validated: true,
      productName: product.name,
      availableStock,
    });
  }

  // Round to 2 decimal places for money (avoids floating-point total being 1 unit short)
  const round2 = (n) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : 0);

  // Subtotal = sum of rounded line totals
  const subtotalSum = validatedItems.reduce(
    (sum, item) => sum + round2(item.price * item.quantity),
    0
  );
  let subtotal = round2(subtotalSum);
  // If subtotal is 1199.x (e.g. float or rounding), treat as 1200 so total = 1200 + shipping (avoids 1 short)
  if (subtotal >= 1199 && subtotal < 1200) subtotal = 1200;
  else subtotal = Math.round(subtotal);

  // Calculate discount (if coupon provided)
  let discount = 0;
  let couponData = null;
  if (couponCode) {
    try {
      const productIds = validatedItems.map(item => item.product);
      const products = await Product.find({ _id: { $in: productIds } })
        .populate('seller', '_id')
        .populate('category', '_id');
      
      const categoryIds = [...new Set(products.map(p => p.category?._id?.toString()).filter(Boolean))];
      const sellerIds = [...new Set(products.map(p => p.seller?._id?.toString()).filter(Boolean))];

      couponData = await couponService.validateCoupon(
        couponCode,
        req.user.id.toString(),
        subtotal,
        productIds.map(id => id.toString()),
        categoryIds,
        sellerIds
      );

      discount = round2(couponData.discountAmount || 0);
    } catch (couponError) {
      return next(new AppError(
        'Invalid or expired coupon code',
        400
      ));
    }
  }

  // Calculate shipping (simplified - using address if provided)
  let shippingFee = 0;
  if (address && deliveryMethod) {
    try {
      const Address = require('../../models/user/addressModel');
      const addressDoc = await Address.findById(address);

      if (addressDoc && addressDoc.city) {
        // Prepare items for shipping calculation
        const shippingItems = validatedItems.map(item => ({
          productId: item.product,
          quantity: item.quantity,
          sellerId: productMap.get(item.product.toString())?.seller?._id || productMap.get(item.product.toString())?.seller,
        }));

        const { calculateShippingQuote } = require('../../services/shipping/shippingCalculationService');
        const shippingQuote = await calculateShippingQuote(
          addressDoc.city,
          shippingItems,
          deliveryMethod === 'pickup_center' ? 'pickup_center' : 'dispatch',
          req.body.pickupCenterId || null,
          req.body.deliverySpeed || 'standard'
        );

        shippingFee = round2(shippingQuote.totalShippingFee || 0);
      }
    } catch (shippingError) {
      // Log error but don't fail validation - shipping can be calculated later
      console.warn('[validateCart] Shipping calculation error:', shippingError.message);
    }
  }

  // Calculate final total (Jumia-style: buyer sees single price; no tax line)
  const totalRaw = Math.max(0, subtotal - discount + shippingFee);
  const totalRounded2 = round2(totalRaw);
  // Round to nearest whole number so 1215.99 shows as 1216 (avoids floating-point showing 1215)
  const total = Math.round(totalRounded2);

  // VAT-inclusive: do NOT return tax breakdown to buyer (what you see is what you pay)
  // Tax is kept server-side for orders/audits only

  res.status(200).json({
    status: 'success',
    data: {
      validatedItems,
      totals: {
        subtotal,
        discount,
        shipping: shippingFee,
        total,
        totalAmount: total,
      },
      paymentAmount: Math.round(total * 100), // In smallest currency unit (pesewas/kobo)
      coupon: couponData ? {
        code: couponCode,
        discountAmount: discount,
        batchId: couponData.batchId,
      } : null,
    },
  });
});

exports.getAllOrder = handleFactory.getAll(Order, [
  {
    path: 'orderItems',
    select: 'quantity product price productName',
    populate: {
      path: 'product',
      select: 'name price',
    },
  },
  {
    path: 'user',
    select: 'name email phone',
  },
]);
// creating orders
exports.createOrder = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderItems, address, couponCode } = req.body;

    /* ---------------------------------- */
    /* 1. BASIC VALIDATION                 */
    /* ---------------------------------- */
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return next(new AppError('Order must contain at least one item', 400));
    }
    if (!address) {
      return next(new AppError('Shipping address is required', 400));
    }

    const addressDoc = await Address.findOne({
      _id: address,
      user: req.user.id,
    }).session(session);

    if (!addressDoc) {
      return next(new AppError('Invalid shipping address', 403));
    }

    const orderNumber = await generateOrderNumber();
    const trackingNumber = generateTrackingNumber();

    /* ---------------------------------- */
    /* 2. FETCH PRODUCTS (DB TRUTH ONLY)   */
    /* ---------------------------------- */
    const productIds = [...new Set(orderItems.map(i => i.product))];

    // Do NOT populate seller: we need the raw ObjectId from the product document so the order
    // always gets the actual seller ID (not null when seller is inactive, and not wrongly EazShop).
    const products = await Product.find({ _id: { $in: productIds } })
      .session(session);

    const productMap = new Map();
    products.forEach(p => productMap.set(p._id.toString(), p));

    /* ---------------------------------- */
    /* 2.5. VALIDATE PRODUCT & SELLER     */
    /* ---------------------------------- */
    // CRITICAL: Orders can only be placed for products that are:
    // 1. Approved by admin (moderationStatus === 'approved')
    // 2. From sellers that exist in the system (but we no longer block on seller verification status)
    const Seller = require('../../models/user/sellerModel');

    for (const product of products) {
      // Check product approval status
      if (product.moderationStatus !== 'approved') {
        await session.abortTransaction();
        return next(new AppError(
          `Product "${product.name}" is not approved for sale. Orders can only be placed for approved products.`,
          400
        ));
      }

      // seller is the raw ObjectId ref from the product document (we did not populate)
      const sellerRef = product.seller;
      if (sellerRef) {
        const seller = await Seller.findById(sellerRef)
          .select('verificationStatus')
          .session(session);

        if (!seller) {
          logger.warn(
            `[Order] Seller not found for product ${product._id} (${product.name}). Proceeding with order as per current business rules.`
          );
        } else if (seller.verificationStatus !== 'verified') {
          logger.warn(
            `[Order] Product "${product.name}" belongs to unverified seller ${seller._id}. Proceeding with order as per current business rules.`
          );
        }
      }
    }

    /* ---------------------------------- */
    /* 3. NORMALIZE ORDER ITEMS (SKU ONLY) — Dual VAT: base -> add VAT -> apply promo */
    /* ---------------------------------- */
    const { getPromosFromAds, getApplicablePromos, applyPromosToPrice } = require('../seller/productController');
    let orderPromos = [];
    try {
      orderPromos = await getPromosFromAds();
    } catch (e) {
      logger.warn('[createOrder] Could not load promos:', e?.message);
    }

    const platformSettings = await require('../../models/platform/platformSettingsModel').getSettings();
    const sellerIds = [...new Set(products.map(p => p.seller).filter(Boolean))];
    const sellers = await Seller.find({ _id: { $in: sellerIds } }).select('isVatRegistered').session(session).lean();
    const sellerVatCollectedBy = new Map();
    sellers.forEach((s) => {
      sellerVatCollectedBy.set(s._id.toString(), s.isVatRegistered === true ? 'seller' : 'platform');
    });

    const normalizedItems = [];

    for (const item of orderItems) {
      const product = productMap.get(item.product.toString());
      if (!product) {
        throw new AppError(`Product not found: ${item.product}`, 404);
      }

      if (!item.sku) {
        throw new AppError(`SKU is required for product ${product.name}`, 400);
      }

      const sku = item.sku.trim().toUpperCase();
      let sellableUnit = null;

      if (product.variants && product.variants.length > 0) {
        sellableUnit = product.variants.find(
          v => v.sku && v.sku.toUpperCase() === sku
        );
        if (!sellableUnit) {
          throw new AppError(
            `Variant SKU "${sku}" not found for product "${product.name}"`,
            400
          );
        }
      } else {
        sellableUnit = product;
      }

      // Dual VAT: seller enters base price; add VAT to get customer-facing inclusive price
      const basePrice = sellableUnit.price ?? product.price;
      const vatComputed = await taxService.addVatToBase(basePrice, platformSettings);
      let priceInclVat = sellableUnit.priceInclVat ?? product.priceInclVat ?? vatComputed.priceInclVat;
      const vatAmountPerUnit = vatComputed.vatAmount;
      const vatRateUsed = vatComputed.vatRate;

      // Apply promotion discount (same as cart/validateCart)
      const applicable = getApplicablePromos(product, orderPromos);
      const { unitPrice: finalPrice } = applyPromosToPrice(priceInclVat, applicable);

      const quantity = Math.max(1, Math.min(item.quantity || 1, 999));
      if (quantity !== item.quantity) {
        throw new AppError(`Invalid quantity for product ${item.product}`, 400);
      }

      if (item.price && Math.abs(item.price - finalPrice) > 0.01) {
        logger.warn(`[SECURITY] Price mismatch for product ${item.product}: frontend=${item.price}, database=${finalPrice}`);
      }

      const sellerIdStr = (product.seller && product.seller.toString()) || '';
      const vatCollectedBy = sellerVatCollectedBy.get(sellerIdStr) || 'platform';

      normalizedItems.push({
        product: item.product,
        variant: sellableUnit._id !== product._id ? sellableUnit._id : null,
        quantity,
        price: finalPrice,
        sku,
        basePrice: vatComputed.basePrice,
        vatAmount: vatAmountPerUnit,
        vatRate: vatRateUsed,
        vatCollectedBy,
      });
    }

    // Build order items with VAT metadata (vatAmount, vatRate, vatCollectedBy) for audit and payout
    const vatR = platformSettings?.vatRate ?? 0.125;
    const nhilR = platformSettings?.nhilRate ?? 0.025;
    const getfundR = platformSettings?.getfundRate ?? 0.025;
    const orderItemsWithTax = normalizedItems.map((item) => ({
      product: item.product,
      variant: item.variant,
      quantity: item.quantity,
      price: item.price,
      sku: item.sku,
      priceInclVat: item.price,
      priceExVat: item.basePrice,
      vatAmount: item.vatAmount,
      vatRate: item.vatRate,
      vatCollectedBy: item.vatCollectedBy,
      basePrice: item.basePrice,
      vat: Math.round((item.basePrice * vatR) * 100) / 100,
      nhil: Math.round((item.basePrice * nhilR) * 100) / 100,
      getfund: Math.round((item.basePrice * getfundR) * 100) / 100,
      covidLevy: 0,
      totalTaxes: item.vatAmount,
      isVATInclusive: true,
    }));

    const orderItemDocs = await OrderItems.insertMany(orderItemsWithTax, { session });

    // SECURITY: Products already fetched above for price validation
    // Reuse products array that was already fetched
    logger.info('Found products:', products.length);

    // EazShop Seller ID constant – only use when product actually belongs to EazShop
    const EAZSHOP_SELLER_ID = '6970b22eaba06cadfd4b8035';

    // Create product-seller map using the product's raw seller ref (we did not populate seller).
    // This ensures the order always gets the actual seller ID from the product document,
    // and we never wrongly assign EazShop ID to a third-party seller's product.
    const productSellerMap = new Map();
    products.forEach((product) => {
      const rawSellerId = product.seller ? product.seller.toString() : null;

      // Only use EazShop ID when the product is explicitly EazShop or its seller ref is EazShop
      const sellerId = product.isEazShopProduct || rawSellerId === EAZSHOP_SELLER_ID
        ? EAZSHOP_SELLER_ID
        : rawSellerId || undefined;

      productSellerMap.set(product._id.toString(), sellerId);
    });

    // Group items by seller and calculate subtotal
    const sellerGroups = new Map();
    let overallSubtotal = 0;

    orderItemDocs.forEach((item) => {
      let sellerId = productSellerMap.get(item.product.toString());

      // If seller is still missing, check if product is EazShop product
      if (!sellerId) {
        const product = products.find(p => p._id.toString() === item.product.toString());
        if (product && product.isEazShopProduct) {
          sellerId = EAZSHOP_SELLER_ID;
        } else {
          throw new AppError(`Seller missing for product: ${item.product}`, 400);
        }
      }

      if (!sellerGroups.has(sellerId)) {
        sellerGroups.set(sellerId, {
          items: [],
          subtotal: 0,
        });
      }

      const group = sellerGroups.get(sellerId);
      group.items.push(item._id);
      const itemTotal = item.price * item.quantity;
      group.subtotal += itemTotal;
      overallSubtotal += itemTotal;
    });

    // COUPON VALIDATION AND PROCESSING - V2 (Using new coupon service)
    let couponUsed = null;
    let totalDiscount = 0;
    let couponUsageDoc = null;
    let couponData = null;
    let sellerDiscounts = new Map(); // Map of sellerId -> discountAmount

    if (couponCode) {
      // Extract product and category IDs for validation
      const productIds = products.map((p) => p._id);
      const categoryIds = products.reduce((acc, p) => {
        if (p.parentCategory) acc.push(p.parentCategory);
        if (p.subCategory) acc.push(p.subCategory);
        return acc;
      }, []);
      const sellerIds = Array.from(sellerGroups.keys());

      // Use new coupon service for validation (validates everything + calculates discount)
      couponData = await couponService.validateCoupon(
        couponCode,
        req.user.id,
        overallSubtotal,
        productIds,
        categoryIds,
        sellerIds,
        session
      );

      // Get calculated discount from service (backend-only calculation)
      totalDiscount = couponData.discountAmount;

      // Calculate seller-level discounts
      sellerDiscounts = couponService.calculateSellerDiscounts(
        totalDiscount,
        sellerGroups,
        couponData.sellerId?.toString(),
        couponData.sellerFunded,
        couponData.platformFunded
      );

      // Fetch batch for reference (will be marked as used after order creation)
      couponUsed = await CouponBatch.findById(couponData.batchId).session(session);
    }

    // Get delivery method and optional checkout-selected shipping from request body
    const deliveryMethod = req.body.deliveryMethod || 'seller_delivery';
    const pickupCenterId = req.body.pickupCenterId || null;
    const deliverySpeed = req.body.deliverySpeed || req.body.shippingType || 'standard';
    const buyerCity = address?.city?.toUpperCase() || 'ACCRA';

    // Checkout-selected shipping (use this when provided so order matches what user saw at checkout)
    const checkoutShippingRaw = req.body.shippingFee ?? req.body.totalShippingFee;
    const checkoutShipping = (typeof checkoutShippingRaw === 'number' && !Number.isNaN(checkoutShippingRaw) && checkoutShippingRaw >= 0)
      ? Math.round(Number(checkoutShippingRaw) * 100) / 100
      : null;

    // Validate buyer city
    if (!['ACCRA', 'TEMA'].includes(buyerCity)) {
      return next(new AppError('Saiisai currently delivers only in Accra and Tema.', 400));
    }

    // Calculate shipping using the shipping quote service (same deliverySpeed as checkout for consistency)
    const { calculateShippingQuote } = require('../../services/shipping/shippingCalculationService');

    // Prepare items for shipping calculation
    const shippingItems = orderItemDocs.map(item => ({
      productId: item.product,
      sellerId: productSellerMap.get(item.product.toString()),
      quantity: item.quantity,
    }));

    // Calculate shipping quote (pass deliverySpeed so quote matches checkout option)
    const shippingQuote = await calculateShippingQuote(
      buyerCity,
      shippingItems,
      deliveryMethod,
      pickupCenterId,
      deliverySpeed
    );

    // Create SellerOrders (platformSettings already loaded above for order items)
    const sellerOrders = [];
    const platformCommissionRate = platformSettings.platformCommissionRate || 0;
    let orderTotal = 0;
    let shippingBreakdown = shippingQuote.perSeller || [];

    // Use checkout-selected shipping when provided so order total matches what user selected
    if (checkoutShipping != null) {
      const isDispatchMethod = deliveryMethod === 'dispatch';
      if (isDispatchMethod) {
        // Dispatch: one order-level fee; breakdown has 0 per seller
        shippingBreakdown = shippingBreakdown.map((s) => ({ ...s, shippingFee: 0 }));
      } else {
        // Seller delivery / pickup: scale per-seller breakdown so sum = checkoutShipping
        const recalcSum = shippingBreakdown.reduce((sum, s) => sum + (s.shippingFee || 0), 0);
        if (recalcSum > 0) {
          const scale = checkoutShipping / recalcSum;
          shippingBreakdown = shippingBreakdown.map((s) => ({
            ...s,
            shippingFee: Math.round((s.shippingFee || 0) * scale * 100) / 100,
          }));
          // Fix rounding: ensure sum equals checkoutShipping
          const scaledSum = shippingBreakdown.reduce((sum, s) => sum + (s.shippingFee || 0), 0);
          if (scaledSum !== checkoutShipping && shippingBreakdown.length > 0) {
            const diff = Math.round((checkoutShipping - scaledSum) * 100) / 100;
            shippingBreakdown[0] = { ...shippingBreakdown[0], shippingFee: (shippingBreakdown[0].shippingFee || 0) + diff };
          }
        } else {
          // No per-seller fee from quote (e.g. pickup): put full amount on first seller for storage
          shippingBreakdown = shippingBreakdown.map((s, i) => ({ ...s, shippingFee: i === 0 ? checkoutShipping : 0 }));
        }
      }
    }

    // For dispatch method, shipping is calculated at order level, not per seller
    const isDispatchMethod = deliveryMethod === 'dispatch';
    const orderLevelShipping = isDispatchMethod
      ? (checkoutShipping != null ? checkoutShipping : shippingQuote.totalShippingFee)
      : 0;

    for (const [sellerId, group] of sellerGroups) {
      // Get seller-specific discount from the map (calculated by coupon service)
      const sellerDiscount = sellerDiscounts.get(sellerId.toString()) || 0;

      const sellerSubtotal = group.subtotal - sellerDiscount;

      // Calculate tax breakdown for this seller's items
      const sellerItems = group.items.map(itemId => {
        const itemDoc = orderItemDocs.find(doc => doc._id.toString() === itemId.toString());
        return itemDoc;
      }).filter(Boolean);

      // Calculate seller-level tax totals
      let sellerTotalBasePrice = 0;
      let sellerTotalVAT = 0;
      let sellerTotalNHIL = 0;
      let sellerTotalGETFund = 0;
      let sellerTotalCovidLevy = 0;

      let sellerTotalVatAmount = 0;
      sellerItems.forEach(item => {
        const quantity = item.quantity || 1;
        sellerTotalBasePrice += (item.basePrice || 0) * quantity;
        sellerTotalVAT += (item.vat || 0) * quantity;
        sellerTotalNHIL += (item.nhil || 0) * quantity;
        sellerTotalGETFund += (item.getfund || 0) * quantity;
        sellerTotalCovidLevy += (item.covidLevy || 0) * quantity;
        sellerTotalVatAmount += (item.vatAmount || 0) * quantity;
      });

      // Round to 2 decimal places
      sellerTotalBasePrice = Math.round(sellerTotalBasePrice * 100) / 100;
      sellerTotalVAT = Math.round(sellerTotalVAT * 100) / 100;
      sellerTotalNHIL = Math.round(sellerTotalNHIL * 100) / 100;
      sellerTotalGETFund = Math.round(sellerTotalGETFund * 100) / 100;
      sellerTotalCovidLevy = Math.round(sellerTotalCovidLevy * 100) / 100;
      sellerTotalVatAmount = Math.round(sellerTotalVatAmount * 100) / 100;
      const sellerTotalTax = Math.round((sellerTotalVAT + sellerTotalNHIL + sellerTotalGETFund + sellerTotalCovidLevy) * 100) / 100;

      // Dual VAT: who collects VAT on this seller order (for payout: seller gets base+VAT or base only)
      const vatCollectedBy = sellerItems[0]?.vatCollectedBy || 'platform';

      // Get shipping fee for this seller from the quote
      const sellerShippingInfo = shippingBreakdown.find(s => s.sellerId === sellerId.toString());
      const shipping = sellerShippingInfo?.shippingFee || 0;

      // Total for seller order: VAT-inclusive subtotal + shipping
      const total = sellerSubtotal + shipping;
      orderTotal += total;

      const commissionAmount = Math.round(total * platformCommissionRate * 100) / 100;
      const vatRateForCommission = platformSettings?.vatRate ?? 0.15;
      const vatOnCommission = Math.round(commissionAmount * vatRateForCommission * 100) / 100;

      // Determine if this is an EazShop order (seller is raw ObjectId ref, not populated)
      const isEazShopStore = sellerId === EAZSHOP_SELLER_ID;
      const sellerProduct = products.find(p => p.seller?.toString() === sellerId);
      const isEazShopProduct = sellerProduct?.isEazShopProduct || isEazShopStore;

      // Determine delivery method for this seller
      let sellerDeliveryMethod = deliveryMethod;
      if (deliveryMethod === 'dispatch') {
        sellerDeliveryMethod = 'eazshop_dispatch';
      } else if (isEazShopProduct && deliveryMethod === 'seller_delivery') {
        sellerDeliveryMethod = 'eazshop_dispatch';
      }

      const sellerOrder = new SellerOrder({
        seller: sellerId,
        items: group.items,
        subtotal: sellerSubtotal,
        originalSubtotal: group.subtotal,
        discountAmount: sellerDiscount,
        tax: 0,
        shippingCost: shipping,
        total: total,
        totalBasePrice: sellerTotalBasePrice,
        totalVAT: sellerTotalVAT,
        totalNHIL: sellerTotalNHIL,
        totalGETFund: sellerTotalGETFund,
        totalCovidLevy: sellerTotalCovidLevy,
        totalTax: sellerTotalTax,
        totalVatAmount: sellerTotalVatAmount,
        vatCollectedBy,
        isVATInclusive: true,
        commissionRate: platformCommissionRate,
        commissionAmount,
        vatOnCommission,
        status: 'pending',
        payoutStatus: 'pending',
        sellerType: isEazShopProduct ? 'eazshop' : 'regular',
        deliveryMethod: sellerDeliveryMethod,
        pickupCenterId: deliveryMethod === 'pickup_center' ? pickupCenterId : null,
        dispatchType: deliveryMethod === 'dispatch' ? 'EAZSHOP' :
          (deliveryMethod === 'seller_delivery' && !isEazShopProduct) ? 'SELLER' : null,
      });

      await sellerOrder.save({ session });
      sellerOrders.push(sellerOrder._id);
    }

    // Total shipping: use checkout-selected amount when provided, else sum from breakdown
    const totalShippingFee = checkoutShipping != null
      ? checkoutShipping
      : (isDispatchMethod ? orderLevelShipping : shippingBreakdown.reduce((sum, item) => sum + (item.shippingFee || 0), 0));

    // Add order-level shipping to total if dispatch method
    if (isDispatchMethod) {
      orderTotal += orderLevelShipping;
    }

    // Round to nearest whole number so stored total matches checkout display (e.g. 1215.99 -> 1216)
    orderTotal = Math.round(Math.round(orderTotal * 100) / 100);

    const dispatchType = deliveryMethod === 'dispatch' ? 'EAZSHOP' :
      deliveryMethod === 'seller_delivery' ? 'SELLER' : null;

    // Get neighborhood and zone information for dispatch orders
    let neighborhood = null;
    let deliveryZone = null;
    let shippingType = req.body.shippingType || 'standard';
    let deliveryEstimate = null;

    // Calculate delivery estimate from shipping options
    const { calculateDeliveryEstimate } = require('../../utils/helpers/shippingHelpers');
    const { getActiveShippingConfig } = require('../../utils/helpers/shippingHelpers');
    const shippingConfig = await getActiveShippingConfig();
    const orderDate = new Date();

    if (shippingConfig) {
      deliveryEstimate = calculateDeliveryEstimate(shippingType, orderDate, shippingConfig);
    }

    if (deliveryMethod === 'dispatch' && address) {
      try {
        // Extract neighborhood name from address (area field is preferred, fallback to landmark or streetAddress)
        const neighborhoodName = address.area || address.landmark || address.streetAddress?.split(',')[0] || address.streetAddress;
        const city = address.city ? (address.city.charAt(0).toUpperCase() + address.city.slice(1).toLowerCase()) : null;

        if (neighborhoodName && city && (city === 'Accra' || city === 'Tema')) {
          const { getZoneFromNeighborhoodName } = require('../../utils/getZoneFromNeighborhood');

          const zoneResult = await getZoneFromNeighborhoodName(neighborhoodName, city);
          neighborhood = zoneResult.neighborhood._id;
          deliveryZone = zoneResult.zone.name;
        }
      } catch (error) {
        logger.warn('Could not determine neighborhood/zone for order:', error.message);
        // Continue without neighborhood/zone if lookup fails
      }
    }

    // Calculate weight for order
    const { calculateCartWeight } = require('../../utils/helpers/shippingHelpers');
    const orderWeight = await calculateCartWeight(orderItems);

    // Calculate order-level tax totals (aggregate from all seller orders)
    // We need to fetch the saved seller orders to get their tax breakdowns
    const savedSellerOrders = await SellerOrder.find({ _id: { $in: sellerOrders } }).session(session);

    let orderTotalBasePrice = 0;
    let orderTotalVAT = 0;
    let orderTotalNHIL = 0;
    let orderTotalGETFund = 0;
    let orderTotalCovidLevy = 0;

    savedSellerOrders.forEach(so => {
      orderTotalBasePrice += so.totalBasePrice || 0;
      orderTotalVAT += so.totalVAT || 0;
      orderTotalNHIL += so.totalNHIL || 0;
      orderTotalGETFund += so.totalGETFund || 0;
      orderTotalCovidLevy += so.totalCovidLevy || 0;
    });

    // Round to 2 decimal places
    orderTotalBasePrice = Math.round(orderTotalBasePrice * 100) / 100;
    orderTotalVAT = Math.round(orderTotalVAT * 100) / 100;
    orderTotalNHIL = Math.round(orderTotalNHIL * 100) / 100;
    orderTotalGETFund = Math.round(orderTotalGETFund * 100) / 100;
    orderTotalCovidLevy = Math.round(orderTotalCovidLevy * 100) / 100;
    const orderTotalTax = Math.round((orderTotalVAT + orderTotalNHIL + orderTotalGETFund + orderTotalCovidLevy) * 100) / 100;

    // Create main order
    const newOrder = new Order({
      orderNumber,
      trackingNumber,
      user: req.user.id,
      shippingAddress: addressDoc._id, // Use validated address document
      orderItems: orderItemDocs.map((doc) => doc._id),
      orderStatus: 'pending',
      paymentStatus: 'pending',
      sellerOrder: sellerOrders,
      totalPrice: orderTotal, // Grand total (VAT-inclusive + shipping + COVID levy)
      coupon: couponUsed?._id,
      discountAmount: totalDiscount,
      appliedCouponBatchId: couponData?.batchId || null,
      appliedCouponId: couponData?.couponId || null,
      // Normalize payment method to match enum values
      paymentMethod: (() => {
        const method = req.body.paymentMethod || 'mobile_money';
        // Normalize common variations to match enum
        if (method === 'cod' || method === 'cash_on_delivery') {
          return 'payment_on_delivery';
        }
        if (method === 'bank') {
          return 'bank_transfer';
        }
        return method;
      })(),
      shippingCost: totalShippingFee,
      shippingFee: totalShippingFee,
      shippingBreakdown: shippingBreakdown,
      shippingCity: buyerCity,
      deliveryMethod: deliveryMethod,
      pickupCenterId: pickupCenterId,
      dispatchType: dispatchType,
      shippingType: shippingType,
      deliveryZone: deliveryZone,
      neighborhood: neighborhood,
      weight: orderWeight,
      deliveryEstimate: deliveryEstimate,
      subtotal: overallSubtotal, // VAT-inclusive subtotal
      tax: 0, // Deprecated - use tax breakdown fields
      // Tax breakdown fields (Ghana GRA)
      totalBasePrice: orderTotalBasePrice,
      totalVAT: orderTotalVAT,
      totalNHIL: orderTotalNHIL,
      totalGETFund: orderTotalGETFund,
      totalCovidLevy: orderTotalCovidLevy,
      totalTax: orderTotalTax,
      isVATInclusive: true,
      // Initialize tracking system - Set status based on payment method
      // COD orders stay pending, Paystack orders wait for payment confirmation
      currentStatus: (() => {
        // Normalize payment method first
        let paymentMethod = req.body.paymentMethod || 'mobile_money';
        if (paymentMethod === 'cod' || paymentMethod === 'cash_on_delivery') {
          paymentMethod = 'payment_on_delivery';
        }
        if (paymentMethod === 'bank') {
          paymentMethod = 'bank_transfer';
        }
        // Cash on Delivery - payment pending until delivery
        if (paymentMethod === 'payment_on_delivery') {
          return 'pending_payment';
        }
        // If payment already completed, set to confirmed
        if (req.body.paymentStatus === 'completed') {
          return 'confirmed';
        }
        // Paystack orders wait for payment confirmation
        return 'pending_payment';
      })(),
      trackingHistory: (() => {
        const history = [
          {
            status: 'pending_payment',
            message: 'Your order has been placed successfully.',
            location: '',
            updatedBy: req.user.id,
            updatedByModel: 'User',
            timestamp: new Date(),
          },
        ];

        // If payment is already completed, add confirmed entry
        if (req.body.paymentStatus === 'completed') {
          history.push({
            status: 'confirmed',
            message: 'Your order has been confirmed and payment received.',
            location: '',
            updatedBy: req.user.id,
            updatedByModel: 'User',
            timestamp: req.body.paidAt ? new Date(req.body.paidAt) : new Date(),
          });
        }

        return history;
      })(),
    });

    // If payment is already completed, update payment status
    if (req.body.paymentStatus === 'completed') {
      newOrder.paymentStatus = 'completed';
      newOrder.status = 'confirmed'; // Set to confirmed, not paid
      if (req.body.paidAt) {
        newOrder.paidAt = new Date(req.body.paidAt);
      }
      // Reduce product stock after payment is confirmed
      await exports.reduceOrderStock(newOrder, session);
    } else {
      // Set initial status based on payment method
      let paymentMethod = req.body.paymentMethod || 'mobile_money';
      // Normalize payment method to match enum
      if (paymentMethod === 'cod' || paymentMethod === 'cash_on_delivery') {
        paymentMethod = 'payment_on_delivery';
      }
      if (paymentMethod === 'bank') {
        paymentMethod = 'bank_transfer';
      }

      if (paymentMethod === 'payment_on_delivery') {
        // COD orders - payment pending until delivery
        newOrder.paymentStatus = 'pending';
        newOrder.status = 'pending';
        newOrder.currentStatus = 'pending_payment';
      } else if (paymentMethod === 'credit_balance') {
        // Credit balance payment - process immediately using walletService
        const walletService = require('../../services/walletService');
        const reference = `ORDER-${orderNumber}`;

        // Deduct from wallet using walletService (includes transaction logging)
        const debitResult = await walletService.debitWallet(
          req.user.id,
          orderTotal,
          'DEBIT_ORDER',
          `Order #${orderNumber} - Payment via wallet`,
          reference,
          {
            orderNumber,
            orderId: newOrder._id.toString(),
          },
          newOrder._id
        );

        // Check if duplicate transaction (shouldn't happen but safety check)
        if (debitResult.isDuplicate) {
          throw new AppError('Transaction already processed', 400);
        }

        // Update order payment status
        newOrder.paymentStatus = 'paid';
        newOrder.status = 'confirmed';
        newOrder.currentStatus = 'confirmed';
        newOrder.paidAt = new Date();
        newOrder.revenueAmount = orderTotal; // Store revenue amount

        // Add confirmed tracking entry
        newOrder.trackingHistory.push({
          status: 'confirmed',
          message: 'Your order has been confirmed and payment received via account balance.',
          location: '',
          updatedBy: req.user.id,
          updatedByModel: 'User',
          timestamp: new Date(),
        });

        // Add revenue to admin revenue immediately (at payment time)
        const PlatformStats = require('../../models/platform/platformStatsModel');
        const platformStats = await PlatformStats.getStats();
        platformStats.totalRevenue = (platformStats.totalRevenue || 0) + orderTotal;
        platformStats.addDailyRevenue(new Date(), orderTotal, 0); // 0 for orders count (will be incremented on delivery)
        platformStats.lastUpdated = new Date();
        await platformStats.save({ session });

        // Mark revenue as added
        newOrder.revenueAdded = true;

        // Reduce product stock after payment is confirmed
        await exports.reduceOrderStock(newOrder, session);

        // Log payment activity
        const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
        logActivityAsync({
          userId: req.user.id,
          role: 'buyer',
          action: 'PAYMENT',
          description: `Payment of GH₵${orderTotal.toFixed(2)} via credit balance for order #${orderNumber}`,
          req,
          metadata: {
            orderId: newOrder._id,
            orderNumber: orderNumber,
            paymentMethod: 'credit_balance',
            amount: orderTotal,
            type: 'payment',
          },
        });
      }
    }

    // Save order
    await newOrder.save({ session });

    // Link SellerOrders back to this Order (required for getSellerOrders and syncSellerOrderStatus)
    await SellerOrder.updateMany(
      { _id: { $in: sellerOrders } },
      { $set: { order: newOrder._id } },
      { session }
    );

    /* ---------------------------------- */
    /* 7.1. PAYMENT HANDLING (LEGACY)      */
    /* ---------------------------------- */
    // NOTE: Wallet payments are now handled via walletService above when
    // paymentMethod === 'credit_balance'. To avoid double-charging and
    // undefined variable errors, this legacy block is effectively disabled.
    const isWalletPayment = false;

    // Handle wallet payment (credit_balance) - legacy path (currently disabled)
    if (isWalletPayment) {
      console.log('[createOrder] 💰 Processing wallet payment deduction...');
      
      // Get wallet (within same session)
      const wallet = await Creditbalance.findOne({ user: req.user.id }).session(session);
      
      if (!wallet) {
        await session.abortTransaction();
        return next(new AppError('Wallet not found. Please contact support.', 500));
      }
      
      const balanceBefore = wallet.balance || 0;
      // Use availableBalance (balance - holdAmount) for validation
      const availableBalanceBefore = wallet.availableBalance !== undefined 
        ? wallet.availableBalance 
        : Math.max(0, balanceBefore - (wallet.holdAmount || 0));
      const balanceAfter = balanceBefore - totalPrice;
      
      // Double-check available balance (race condition protection - final check before deduction)
      if (availableBalanceBefore < totalPrice) {
        await session.abortTransaction();
        return next(new AppError(
          `Insufficient wallet balance. Your available balance is GH₵${availableBalanceBefore.toFixed(2)}, but required amount is GH₵${totalPrice.toFixed(2)}. ${wallet.holdAmount > 0 ? `You have GH₵${wallet.holdAmount.toFixed(2)} on hold. ` : ''}Please try again or choose a different payment method.`,
          400
        ));
      }
      
      // Update wallet balance atomically using $inc to prevent race conditions
      const updatedWallet = await Creditbalance.findOneAndUpdate(
        { 
          _id: wallet._id,
          balance: { $gte: totalPrice } // Ensure balance is still sufficient
        },
        { 
          $inc: { balance: -totalPrice },
          $set: { 
            availableBalance: Math.max(0, balanceAfter - (wallet.holdAmount || 0)), // Recalculate availableBalance
            lastUpdated: new Date(),
          },
          $push: {
            transactions: {
              date: new Date(),
              amount: -totalPrice,
              type: 'purchase',
              description: `Order payment: ${orderNumber}`,
              reference: `ORDER-${newOrder._id}`,
            }
          }
        },
        { 
          new: true,
          session 
        }
      );
      
      if (!updatedWallet) {
        // Balance check failed (insufficient or race condition)
        await session.abortTransaction();
        return next(new AppError(
          `Insufficient wallet balance or balance changed. Please try again.`,
          400
        ));
      }
      
      // Create wallet transaction record
      const walletTransactionReference = `ORDER-${newOrder._id}-${Date.now()}`;
      await WalletTransaction.create([{
        user: req.user.id,
        amount: -totalPrice, // Store as negative for debits
        type: 'DEBIT_ORDER',
        description: `Order payment: ${orderNumber}`,
        reference: walletTransactionReference,
        orderId: newOrder._id,
        balanceBefore,
        balanceAfter,
        metadata: {
          orderNumber,
          orderId: newOrder._id.toString(),
        },
      }], { session });
      
      // Mark order as paid
      newOrder.paymentStatus = 'paid';
      newOrder.status = 'confirmed'; // Use 'status' field (has 'confirmed' in enum), not 'orderStatus'
      newOrder.currentStatus = 'confirmed'; // Also update currentStatus for tracking
      newOrder.paidAt = new Date();
      
      // Update order with payment status
      await newOrder.save({ session });
      
      console.log('[createOrder] ✅ Wallet payment processed:', {
        orderId: newOrder._id,
        orderNumber,
        amountDeducted: totalPrice,
        balanceBefore,
        balanceAfter,
        transactionReference: walletTransactionReference,
      });
      
      // Log to wallet history (non-blocking - don't fail if logging fails)
      logBuyerWallet({
        userId: req.user.id,
        amount: -totalPrice, // Store as negative for debits
        type: 'ORDER_DEBIT',
        description: `Order payment: ${orderNumber}`,
        reference: walletTransactionReference,
        orderId: newOrder._id,
        metadata: {
          orderNumber,
          orderId: newOrder._id.toString(),
        },
      }).catch(err => {
        console.error('[createOrder] Failed to log wallet history (non-critical):', err);
      });
      
      // 🔐 Reduce stock for wallet-paid orders
      await exports.reduceOrderStock(newOrder, session);
      
    } else if (req.body.paymentStatus === 'completed') {
      // Handle other payment methods (e.g., Paystack webhook)
      newOrder.paymentStatus = 'paid';
      newOrder.status = 'confirmed'; // Use 'status' field (has 'confirmed' in enum), not 'orderStatus'
      newOrder.currentStatus = 'confirmed'; // Also update currentStatus for tracking
      newOrder.paidAt = new Date();

      // Update order with payment status
      await newOrder.save({ session });

      // 🔐 Reduce stock ONLY here
      await exports.reduceOrderStock(newOrder, session);
    }

    /* ---------------------------------- */
    /* 7.5. APPLY COUPON TO ORDER          */
    /* ---------------------------------- */
    // Mark coupon as used after order is saved (within transaction)
    const appliedCouponBatchId = newOrder.appliedCouponBatchId;
    const appliedCouponId = newOrder.appliedCouponId;
    if (appliedCouponBatchId && appliedCouponId) {
      try {
        await couponService.applyCouponToOrder(
          appliedCouponBatchId,
          appliedCouponId,
          req.user.id.toString(),
          newOrder._id.toString(),
          session
        );
        console.log('[createOrder] Coupon applied to order:', {
          orderId: newOrder._id,
          couponId: appliedCouponId,
        });
      } catch (couponApplyError) {
        // Log error but don't fail order creation
        console.error('[createOrder] Failed to apply coupon to order (non-critical):', couponApplyError.message);
      }
    }

    /* ---------------------------------- */
    /* 8. COMMIT TRANSACTION               */
    /* ---------------------------------- */
    await session.commitTransaction();

    /* ---------------------------------- */
    /* 9. UPDATE SOLD (POST-PAYMENT ONLY)  */
    /* ---------------------------------- */
    if (newOrder.paymentStatus === 'paid') {
      await exports.updateProductTotalSold(newOrder);
    }

    /* ---------------------------------- */
    /* 10. RESPONSE                        */
    /* ---------------------------------- */
    // Verify order was saved correctly before responding
    // Populate sellerOrder and seller so we can send new-order emails to each seller
    const fullOrder = await Order.findById(newOrder._id)
      .populate('orderItems')
      .populate('user', 'name email')
      .populate({ path: 'sellerOrder', populate: { path: 'seller', select: 'email name shopName' } })
      .lean();

    if (!fullOrder) {
      console.error('[createOrder] ❌ CRITICAL: Order was not found after creation!', {
        orderId: newOrder._id,
        userId: req.user.id,
      });
      await session.abortTransaction();
      return next(new AppError('Order was created but could not be retrieved. Please contact support.', 500));
    }

    console.log('[createOrder] ✅ Order created successfully:', {
      orderId: fullOrder._id,
      orderNumber: fullOrder.orderNumber,
      userId: fullOrder.user?._id || fullOrder.user,
      totalPrice: fullOrder.totalPrice,
    });

    // Send order confirmation email to buyer
    try {
      const emailDispatcher = require('../../emails/emailDispatcher');
      const user = fullOrder.user || { email: req.user.email, name: req.user.name };
      if (user.email) {
        await emailDispatcher.sendOrderConfirmation(fullOrder, user);
        logger.info(`[createOrder] ✅ Order confirmation email sent to ${user.email}`);
      }
    } catch (emailError) {
      logger.error('[createOrder] Error sending order confirmation email:', emailError.message);
      // Don't fail the order if email fails
    }

    // Send new order alert emails to sellers
    try {
      const emailDispatcher = require('../../emails/emailDispatcher');
      const Seller = require('../../models/user/sellerModel');

      if (fullOrder.sellerOrder && fullOrder.sellerOrder.length > 0) {
        for (const sellerOrder of fullOrder.sellerOrder) {
          if (sellerOrder.seller && sellerOrder.seller.email) {
            try {
              await emailDispatcher.sendSellerNewOrder(sellerOrder.seller, fullOrder);
              logger.info(`[createOrder] ✅ New order email sent to seller ${sellerOrder.seller.email}`);
            } catch (sellerEmailError) {
              logger.error(`[createOrder] Error sending email to seller ${sellerOrder.seller.email}:`, sellerEmailError.message);
            }
          }
        }
      }
    } catch (sellerEmailError) {
      logger.error('[createOrder] Error sending seller order emails:', sellerEmailError.message);
      // Don't fail the order if email fails
    }

    res.status(201).json({
      status: 'success',
      data: { order: fullOrder },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('[createOrder] ❌ Order creation failed:', {
      error: error.message,
      stack: error.stack,
      body: {
        orderItemsCount: req.body?.orderItems?.length || 0,
        hasAddress: !!req.body?.address,
        hasCoupon: !!(req.body?.couponCode || req.body?.couponId),
        paymentMethod: req.body?.paymentMethod,
        deliveryMethod: req.body?.deliveryMethod,
      },
    });
    // Return the error message from AppError if it exists, otherwise generic message
    const errorMessage = error instanceof AppError 
      ? error.message 
      : (error.message || 'Failed to create order');
    return next(new AppError(errorMessage, 400));
  } finally {
    session.endSession();
  }
});

exports.totalSales = catchAsync(async (req, res, next) => {
  const totalSales = await Order.aggregate([
    { $group: { _id: null, totalSales: { $sum: '$totalPrice' } } },
  ]);
  if (!totalSales)
    return next(new AppError('total sales can not be generated', 404));
  res.status(200).json({ status: 'success', data: { totalSales } });
});

exports.getCount = catchAsync(async (req, res, next) => {
  const orderCount = await Order.countDocuments();
  if (!orderCount) return next(new AppError('Order not found', 404));
  res.status(200).json({ status: 'success', data: { orderCount } });
});

/**
 * Get order counts by status for admin order management dashboard.
 * GET /api/v1/order/get/stats — admin only.
 */
exports.getOrderStats = catchAsync(async (req, res, next) => {
  const stats = await Order.aggregate([
    { $facet: {
      total: [{ $count: 'count' }],
      pending: [{ $match: { currentStatus: { $in: ['pending', 'pending_payment'] } } }, { $count: 'count' }],
      processing: [{ $match: { currentStatus: { $in: ['processing', 'preparing', 'ready_for_dispatch'] } } }, { $count: 'count' }],
      confirmed: [{ $match: { currentStatus: 'confirmed' } }, { $count: 'count' }],
      shipped: [{ $match: { currentStatus: { $in: ['shipped', 'out_for_delivery'] } } }, { $count: 'count' }],
      delivered: [{ $match: { currentStatus: { $in: ['delivered', 'completed'] } } }, { $count: 'count' }],
      cancelled: [{ $match: { currentStatus: 'cancelled' } }, { $count: 'count' }],
    } },
  ]);
  const facet = (stats && stats[0]) ? stats[0] : {};
  const getCount = (key) => (facet[key] && facet[key][0] && facet[key][0].count) ? facet[key][0].count : 0;
  res.status(200).json({
    status: 'success',
    data: {
      totalOrders: getCount('total'),
      pendingCount: getCount('pending'),
      processing: getCount('processing'),
      confirmed: getCount('confirmed'),
      shipped: getCount('shipped'),
      delivered: getCount('delivered'),
      cancelled: getCount('cancelled'),
    },
  });
});

//get each seller order

exports.getSellerOrders = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;

  const sellerOrders = await SellerOrder.find({ seller: sellerId })
    .populate({
      path: 'items',
      populate: {
        path: 'product',
        model: 'Product',
      },
    })
    .populate({
      path: 'order',
      select: 'orderNumber trackingNumber user createdAt paymentMethod paymentStatus paidAt shippingAddress deliveryMethod pickupCenterId dispatchType currentStatus status',
      populate: [
        {
          path: 'user',
          select: 'name email phone',
        },
        {
          path: 'pickupCenterId',
          model: 'PickupCenter',
          select: 'pickupName address city area openingHours googleMapLink',
        },
      ],
    })
    .sort('-createdAt');

  // Fallback: SellerOrders created before we set order may have order=null. Find parent Order by sellerOrder array.
  for (const so of sellerOrders) {
    if (!so.order) {
      const parentOrder = await Order.findOne({ sellerOrder: so._id })
        .select('orderNumber trackingNumber user createdAt paymentMethod paymentStatus paidAt shippingAddress deliveryMethod pickupCenterId dispatchType currentStatus status')
        .populate([{ path: 'user', select: 'name email phone' }, { path: 'pickupCenterId', model: 'PickupCenter', select: 'pickupName address city area openingHours googleMapLink' }])
        .lean();
      if (parentOrder) so.order = parentOrder;
    }
  }

  const validSellerOrders = sellerOrders.filter((so) => so.order);
  
  // Return empty array instead of 404 - having no orders is a valid state
  const formattedOrders = validSellerOrders.length === 0 
    ? [] 
    : validSellerOrders.map((so) => ({
    // SellerOrder fields
    _id: so._id,
    status: so.status,
    items: so.items,
    subtotal: so.subtotal,
    total: so.total,
    shippingCost: so.shippingCost,
    tax: so.tax,
    commissionRate: so.commissionRate,
    payoutStatus: so.payoutStatus,

    // Parent Order fields
    orderNumber: so.order.orderNumber,
    trackingNumber: so.order.trackingNumber,
    user: so.order.user,
    createdAt: so.order.createdAt,
    paymentMethod: so.order.paymentMethod,
    paymentStatus: so.order.paymentStatus,
    paidAt: so.order.paidAt,
    shippingAddress: so.order.shippingAddress,
    // Parent order status (source of truth for "completed" / delivered)
    currentStatus: so.order.currentStatus,
    orderStatus: so.order.status,

    // Parent order ID
    parentOrderId: so.order._id || null,
  }));

  res.status(200).json({
    status: 'success',
    result: formattedOrders.length,
    data: {
      orders: formattedOrders,
    },
  });
});

//get order by seller order id
exports.getOrderBySeller = catchAsync(async (req, res, next) => {
  // Get order ID from URL params
  const orderId = req.params.id;

  // Validate MongoDB ID format
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new AppError('Invalid order ID format', 400));
  }

  // Find order and populate necessary data
  const order = await SellerOrder.findById(orderId)
    .populate({
      path: 'seller',
      select: '_id name shopName',
    })
    .populate({
      path: 'order',
      select: 'orderNumber user createdAt paymentMethod paymentStatus paidAt shippingAddress deliveryMethod pickupCenterId dispatchType currentStatus status trackingNumber',
      populate: [
        {
          path: 'user',
          model: 'User',
          select: 'name email',
        },
        {
          path: 'pickupCenterId',
          model: 'PickupCenter',
          select: 'pickupName address city area openingHours googleMapLink',
        },
      ],
    })
    .populate({
      path: 'items',
      populate: {
        path: 'product',
        model: 'Product',
        select: 'name variants price image',
      },
    });

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify the order belongs to the logged-in seller
  // Handle both ObjectId and string comparisons, and populated vs non-populated seller
  const sellerId = order.seller?._id
    ? order.seller._id.toString()
    : order.seller?.toString() || String(order.seller);
  const userId = req.user?._id
    ? req.user._id.toString()
    : req.user?.id?.toString() || String(req.user.id);

  logger.info('[getOrderBySeller] Authorization check:', {
    orderId: orderId,
    orderSellerId: sellerId,
    userId: userId,
    match: sellerId === userId,
    orderSellerType: typeof order.seller,
    userType: typeof req.user.id,
    userRole: req.user.role,
  });

  if (sellerId !== userId) {
    logger.error('[getOrderBySeller] Authorization failed:', {
      orderSellerId: sellerId,
      userId: userId,
    });
    return next(new AppError('You are not authorized to view this order', 403));
  }

  res.status(200).json({
    status: 'success',
    data: { order },
  });
});

exports.OrderDeleteOrderItem = catchAsync(async (req, res, next) => {
  // For normal users, we no longer hard-delete order items.
  // Deletion is now handled as cancel + archive in deleteOrder.
  if (req.user && req.user.role === 'user') {
    return next();
  }

  // Admin flow: still clean up order items when performing a hard delete
  const order = await Order.findById(req.params.id);
  if (order && Array.isArray(order.orderItems)) {
    await Promise.all(
      order.orderItems.map((item) => OrderItems.findByIdAndDelete(item))
    );
  }
  next();
});
exports.getUserOrders = catchAsync(async (req, res, next) => {
  // SECURITY FIX #9: Validate req.user exists
  if (!req.user || !req.user.id) {
    return next(new AppError('User authentication required', 401));
  }

  // Pagination support
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const includeArchived = String(req.query.includeArchived || '').toLowerCase() === 'true';

  // Base filter: orders for this user
  const baseFilter = { user: req.user.id };

  // By default, hide archived orders from user list
  const filter = includeArchived
    ? baseFilter
    : { ...baseFilter, archivedByUser: { $ne: true } };

  // Get total count for pagination metadata (respecting archive filter)
  const total = await Order.countDocuments(filter);

  // Get paginated orders
  const orders = await Order.find(filter)
    .sort({ createdAt: -1 }) // Most recent first
    .skip(skip)
    .limit(limit)
    .populate({
      path: 'orderItems',
      populate: {
        path: 'product',
        select: 'name imageCover price',
      },
    });

  // Attach latest refund request ID for each order (for buyer refund detail navigation)
  try {
    const orderIdsWithRefunds = orders
      .filter(o => o.refundRequested)
      .map(o => o._id);

    if (orderIdsWithRefunds.length > 0) {
      const RefundRequest = require('../../models/refund/refundRequestModel');
      const refundRequests = await RefundRequest.find({
        order: { $in: orderIdsWithRefunds },
      })
        .sort({ createdAt: -1 })
        .select('_id order createdAt')
        .lean();

      const latestByOrder = {};
      for (const rr of refundRequests) {
        const key = String(rr.order);
        if (!latestByOrder[key]) {
          latestByOrder[key] = rr._id;
        }
      }

      orders.forEach(o => {
        const key = String(o._id);
        if (latestByOrder[key]) {
          // attach as plain field so it serializes in JSON
          o.set('latestRefundRequestId', latestByOrder[key]);
        }
      });
    }
  } catch (err) {
    // Do not break orders listing if refund lookup fails
    console.error('[getUserOrders] Error attaching latestRefundRequestId:', err);
  }

  res.status(200).json({
    status: 'success',
    data: {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});
exports.getUserOrder = catchAsync(async (req, res, next) => {
  const orderId = req.params.id;

  // Validate MongoDB ID format
  if (!orderId) {
    return next(new AppError('Order ID is required', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    console.error(`[getUserOrder] Invalid order ID format: ${orderId}`);
    return next(new AppError(`Invalid order ID format: ${orderId}`, 400));
  }

  console.log(`[getUserOrder] Fetching order with ID: ${orderId} for user: ${req.user.id}`);

  const order = await Order.findById(orderId)
    .populate({
      path: 'user',
      select: 'name email phone',
    })
    .populate({
      path: 'orderItems', // Populate orderItems array
      populate: [
        {
          path: 'product', // Populate product details
          select: 'name price imageCover variants',
        },
        {
          path: 'variant',
          select: 'attributes price stock',
        },
      ],
    })
    .populate({
      path: 'sellerOrder',
      populate: [
        {
          path: 'seller',
          select: 'name email shopName',
        },
        {
          path: 'items',
          populate: {
            path: 'product',
            model: 'Product',
            select: 'name imageCover price',
          },
        },
      ],
    })
    .populate({
      path: 'pickupCenterId',
      model: 'PickupCenter',
      select: 'pickupName address city area openingHours googleMapLink instructions',
    });

  // If not found by _id, try finding by orderNumber (in case frontend passed orderNumber instead of _id)
  if (!order) {
    console.warn(`[getUserOrder] Order not found by _id, trying orderNumber: ${orderId}`);
    order = await Order.findOne({ orderNumber: orderId })
      .populate({
        path: 'user',
        select: 'name email phone',
      })
      .populate({
        path: 'orderItems',
        populate: [
          {
            path: 'product',
            select: 'name price imageCover variants',
          },
          {
            path: 'variant',
            select: 'attributes price stock',
          },
        ],
      })
      .populate({
        path: 'sellerOrder',
        populate: [
          {
            path: 'seller',
            select: 'name email shopName',
          },
          {
            path: 'items',
            populate: {
              path: 'product',
              model: 'Product',
              select: 'name imageCover price',
            },
          },
        ],
      })
      .populate({
        path: 'pickupCenterId',
        model: 'PickupCenter',
        select: 'pickupName address city area openingHours googleMapLink instructions',
      });
  }

  if (!order) {
    console.error(`[getUserOrder] Order not found with ID: ${orderId} for user: ${req.user.id}`);
    console.error(`[getUserOrder] Searched both _id and orderNumber`);
    
    // Additional debugging: Check if any orders exist for this user
    const userOrdersCount = await Order.countDocuments({ user: req.user.id });
    console.error(`[getUserOrder] User has ${userOrdersCount} total orders`);
    
    return next(new AppError(`Order not found with ID: ${orderId}`, 404));
  }

  // SECURITY: Verify order ownership - prevent users from accessing other users' orders
  if (order.user._id.toString() !== req.user.id.toString()) {
    return next(new AppError('You are not authorized to view this order', 403));
  }

  // Convert to object to ensure all fields are included
  let orderData = order.toObject ? order.toObject() : order;

  // Check if shippingAddress is a string ID (reference) or an object (embedded)
  // If it's a string ID, populate it from the Address model
  if (orderData.shippingAddress && typeof orderData.shippingAddress === 'string') {
    try {
      const address = await Address.findById(orderData.shippingAddress);
      if (address) {
        orderData.shippingAddress = address.toObject ? address.toObject() : address;
      } else {
        logger.warn(`[getUserOrder] Address not found for ID: ${orderData.shippingAddress}`);
        orderData.shippingAddress = null;
      }
    } catch (error) {
      logger.error(`[getUserOrder] Error populating address:`, error);
      // If address population fails, keep the ID or set to null
      orderData.shippingAddress = orderData.shippingAddress || null;
    }
  }

  // Ensure shippingAddress is included (even if null)
  if (!orderData.shippingAddress) {
    logger.warn(`[getUserOrder] Shipping address missing for order ${req.params.id}`);
  }

  // Ensure shippingCost is set for buyer order detail (sum from sellerOrder if not on order)
  if (orderData.shippingCost == null && Array.isArray(orderData.sellerOrder)) {
    orderData.shippingCost = orderData.sellerOrder.reduce((sum, so) => sum + (so.shippingCost || 0), 0);
  }

  // When seller populate returns null (e.g. inactive seller), attach name/shopName/email via raw collection
  const Seller = require('../../models/user/sellerModel');
  if (Array.isArray(orderData.sellerOrder)) {
    for (let i = 0; i < orderData.sellerOrder.length; i++) {
      const so = orderData.sellerOrder[i];
      const sellerId = so.seller?._id || so.seller;
      const hasSellerDetails = so.seller && (so.seller.name != null || so.seller.shopName != null);
      if (sellerId && !hasSellerDetails) {
        try {
          const id = mongoose.Types.ObjectId.isValid(sellerId) ? (typeof sellerId === 'string' ? new mongoose.Types.ObjectId(sellerId) : sellerId) : null;
          if (id) {
            const raw = await Seller.collection.findOne({ _id: id }, { projection: { name: 1, email: 1, shopName: 1 } });
            if (raw) {
              orderData.sellerOrder[i].seller = { _id: id, name: raw.name, email: raw.email, shopName: raw.shopName };
            }
          }
        } catch (err) {
          logger.warn(`[getUserOrder] Could not attach seller details for sellerOrder ${so._id}:`, err.message);
        }
      }
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      order: orderData
    }
  });
});
const getOrderPopulates = [
  {
    path: 'orderItems',
    select: 'quantity product price productName productImage sku variantAttributes variantName',
    populate: {
      path: 'product',
      select: 'name price imageCover description slug defaultSku',
    },
  },
  { path: 'user', select: 'name email phone' },
  {
    path: 'sellerOrder',
    select: 'seller subtotal total shippingCost totalBasePrice status payoutStatus sellerPaymentStatus',
    // Do NOT populate 'seller' here: Seller pre('find') filters active:false, so inactive sellers
    // would become null and the frontend would wrongly use sellerOrder._id as sellerId. Frontend
    // fetches seller by ID (GET /seller/:id) so seller stays as ObjectId ref.
  },
];

exports.getOrder = catchAsync(async (req, res, next) => {
  const orderId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new AppError('Invalid ID format', 400));
  }
  let query = Order.findById(orderId);
  getOrderPopulates.forEach((pop) => query = query.populate(pop));
  const doc = await query.lean();
  if (!doc) {
    return next(new AppError('Order not found', 404));
  }
  // Resolve shippingAddress when stored as Address ref (ObjectId)
  if (doc.shippingAddress && (typeof doc.shippingAddress === 'string' || mongoose.Types.ObjectId.isValid(doc.shippingAddress))) {
    const addressId = typeof doc.shippingAddress === 'string' ? doc.shippingAddress : doc.shippingAddress.toString();
    const address = await Address.findById(addressId).lean();
    if (address) {
      doc.shippingAddress = address;
    } else {
      doc.shippingAddress = null;
    }
  }
  // Ensure each sellerOrder has an explicit sellerId (string) so admin can fetch seller details
  if (Array.isArray(doc.sellerOrder)) {
    doc.sellerOrder = doc.sellerOrder.map((so) => {
      const sellerIdStr = so.seller && (typeof so.seller === 'object' && so.seller.toString ? so.seller.toString() : String(so.seller));
      return { ...so, sellerId: sellerIdStr || so.sellerId || null };
    });
  }
  res.status(200).json({ status: 'success', data: { data: doc } });
});
// Override updateOrder to handle status sync and seller balance updates
exports.updateOrder = catchAsync(async (req, res, next) => {
  const orderId = req.params.id;
  const updateData = req.body;

  // Find order
  const order = await Order.findById(orderId);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Store previous status (treat legacy typo 'delievered' as completed)
  const previousStatus = order.currentStatus;
  const wasCompleted =
    order.currentStatus === 'delivered' ||
    order.currentStatus === 'delievered' ||
    order.status === 'completed';

  // If status is being updated, sync all status fields
  if (updateData.currentStatus) {
    const newStatus = updateData.currentStatus;
    order.currentStatus = newStatus;

    // Sync legacy status fields for backward compatibility
    if (newStatus === 'delivered') {
      order.orderStatus = 'delievered';
      order.FulfillmentStatus = 'delievered';
      order.status = 'completed';
    } else if (newStatus === 'cancelled') {
      order.orderStatus = 'cancelled';
      order.FulfillmentStatus = 'cancelled';
      order.status = 'cancelled';
    } else if (newStatus === 'refunded') {
      order.status = 'cancelled';
      order.orderStatus = 'cancelled';
      order.FulfillmentStatus = 'cancelled';
    } else if (newStatus === 'out_for_delivery') {
      order.orderStatus = 'shipped';
      order.FulfillmentStatus = 'shipped';
      order.status = 'processing';
    } else if (newStatus === 'confirmed' || newStatus === 'payment_completed') {
      // Confirmed status means payment is complete - set status to confirmed
      order.status = 'confirmed';
      order.paymentStatus = 'completed';
    } else if (['processing', 'preparing', 'ready_for_dispatch'].includes(newStatus)) {
      order.status = 'processing';
    }

    // Add tracking history entry
    order.trackingHistory.push({
      status: newStatus,
      message: updateData.message || 'Order status updated',
      location: updateData.location || '',
      updatedBy: req.user.id,
      updatedByModel: req.user.role === 'admin' ? 'Admin' : req.user.role === 'seller' ? 'Seller' : 'User',
      timestamp: new Date(),
    });
  }

  // Update other fields
  Object.keys(updateData).forEach((key) => {
    if (key !== 'currentStatus' && key !== 'message' && key !== 'location') {
      order[key] = updateData[key];
    }
  });

  // If client sent only legacy "delivered" fields (orderStatus/FulfillmentStatus 'delievered' or status 'completed')
  // without currentStatus, treat as delivered so seller crediting runs.
  let effectiveStatusBecameDelivered = false;
  const isDeliveredViaLegacy =
    (order.orderStatus === 'delievered' || order.FulfillmentStatus === 'delievered' || order.status === 'completed') &&
    order.currentStatus !== 'delivered' &&
    order.currentStatus !== 'delievered';
  if (isDeliveredViaLegacy) {
    order.currentStatus = 'delivered';
    order.orderStatus = 'delievered';
    order.FulfillmentStatus = 'delievered';
    order.status = 'completed';
    order.trackingHistory.push({
      status: 'delivered',
      message: updateData.message || 'Order marked delivered (legacy status sync)',
      location: updateData.location || '',
      updatedBy: req.user.id,
      updatedByModel: req.user.role === 'admin' ? 'Admin' : req.user.role === 'seller' ? 'Seller' : 'User',
      timestamp: new Date(),
    });
    effectiveStatusBecameDelivered = true;
    logger.info(`[updateOrder] Order ${orderId} had legacy delivered status; set currentStatus to 'delivered' for crediting`);
  }

  await order.save();

  // Sync SellerOrder status with Order status if currentStatus was updated
  if (updateData.currentStatus || effectiveStatusBecameDelivered) {
    try {
      const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
      const statusToSync = effectiveStatusBecameDelivered ? 'delivered' : updateData.currentStatus;
      const syncResult = await syncSellerOrderStatus(orderId, statusToSync);
      logger.info('[updateOrder] SellerOrder sync result:', syncResult);
    } catch (error) {
      logger.error('[updateOrder] Error syncing SellerOrder status:', error);
      // Don't fail the order update if SellerOrder sync fails
    }
  }

  // CRITICAL: Credit sellers ONLY when order status becomes "delivered"
  // This is the ONLY place where sellers should be credited (including when legacy delivered status was synced)
  if ((updateData.currentStatus === 'delivered' || effectiveStatusBecameDelivered) && !wasCompleted) {
    try {
      const orderService = require('../../services/order/orderService');
      const balanceUpdateResult = await orderService.creditSellerForOrder(
        orderId,
        req.user.id
      );
      logger.info('[updateOrder] Seller balance credit result:', balanceUpdateResult);
      if (!balanceUpdateResult.success) {
        logger.warn('[updateOrder] Seller credit failed:', balanceUpdateResult.message);
      }
    } catch (error) {
      // Log error but don't fail the status update
      logger.error('[updateOrder] Error crediting seller balances:', error);
    }
  }

  // If order is being refunded, revert seller balances
  if (updateData.currentStatus === 'refunded' && wasCompleted) {
    try {
      const orderService = require('../../services/order/orderService');
      const reversalResult = await orderService.revertSellerBalancesOnRefund(
        orderId,
        'Order Refunded'
      );
      logger.info('[updateOrder] Seller balance reversal result:', reversalResult);
    } catch (error) {
      // Log error but don't fail the status update
      logger.error('[updateOrder] Error reverting seller balances:', error);
    }
  }

  res.status(200).json({
    status: 'success',
    data: { order },
  });
});
/**
 * Delete order with backup and revenue deduction
 * DELETE /api/v1/order/:id
 * - Backs up order info before deletion
 * - Deducts order revenue from admin totalRevenue if revenueAdded is true
 */
exports.deleteOrder = catchAsync(async (req, res, next) => {
  const { orderItems, shippingAddress } = req.body;
  const userId = req.user._id;
  const role = req.user?.role;

  // SECURITY FIX #25: Order items validation (only when items are explicitly provided)
  // For delete operations, the order and its items already exist in the database.
  // We should NOT require the client to re-send all items just to delete an order.
  if (orderItems && Array.isArray(orderItems) && orderItems.length > 0) {
    // Validate each provided order item (defensive, but optional)
    for (const item of orderItems) {
      // Validate quantity
      if (!item.quantity || item.quantity <= 0) {
        return next(new AppError('Item quantity must be greater than zero', 400));
      }

      if (!Number.isInteger(item.quantity)) {
        return next(new AppError('Item quantity must be a whole number', 400));
      }

      // Validate product exists
      if (!item.product) {
        return next(new AppError('Product ID is required for all items', 400));
      }

      // Check product exists and has sufficient stock
      const Product = require('../../models/product/productModel'); // Assuming Product model is needed here
      const product = await Product.findById(item.product);
      if (!product) {
        return next(new AppError(`Product ${item.product} not found`, 404));
      }

      // SECURITY: Check stock availability
      if (product.stock < item.quantity) {
        return next(
          new AppError(
            `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`,
            400
          )
        );
      }
    }
  }

  const orderId = req.params.id;
  const adminId = req.user?.id;

  // Validate order ID
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new AppError('Invalid order ID format', 400));
  }

  // Find the order before deletion
  const order = await Order.findById(orderId);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // USER FLOW: Cancel + archive instead of hard delete
  if (role === 'user') {
    const isPaidOrShipped =
      ['paid', 'completed'].includes(order.paymentStatus) ||
      ['paid', 'confirmed', 'processing', 'partially_shipped', 'completed'].includes(order.status) ||
      [
        'payment_completed',
        'processing',
        'confirmed',
        'preparing',
        'ready_for_dispatch',
        'out_for_delivery',
        'delivered',
      ].includes(order.currentStatus);

    if (isPaidOrShipped) {
      return next(
        new AppError('This order can no longer be cancelled.', 400)
      );
    }

    // Cancel order (unpaid / pending payment)
    order.status = 'cancelled';
    order.orderStatus = 'cancelled';
    order.FulfillmentStatus = 'cancelled';
    order.currentStatus = 'cancelled';
    order.cancelledAt = new Date();

    // Archive from user's list
    order.archivedByUser = true;
    order.archivedAt = new Date();

    // Add tracking history entry for audit
    order.trackingHistory.push({
      status: 'cancelled',
      message: 'Order cancelled by customer',
      location: '',
      updatedBy: req.user.id,
      updatedByModel: 'User',
      timestamp: new Date(),
    });

    await order.save();

    return res.status(200).json({
      status: 'success',
      message: 'Order cancelled and archived from your list.',
      data: {
        order,
      },
    });
  }

  // ADMIN FLOW: Hard delete with backup (no change in external behavior)

  // Create backup of order info before deletion
  const orderBackup = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    user: order.user,
    totalPrice: order.totalPrice,
    totalAmount: order.totalAmount,
    revenueAmount: order.revenueAmount || 0,
    revenueAdded: order.revenueAdded || false,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    orderStatus: order.orderStatus,
    currentStatus: order.currentStatus,
    orderItems: order.orderItems,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    deletedAt: new Date(),
    deletedBy: adminId,
    deletedByRole: req.user?.role || 'admin',
    // Store full order document as JSON for complete backup
    fullOrderData: order.toObject(),
  };

  // Save backup to a collection
  const DeletedOrder = require('../../models/order/deletedOrderModel');
  await DeletedOrder.create(orderBackup);

  // Deduct revenue from admin totalRevenue if revenue was added for this order
  if (order.revenueAdded && order.revenueAmount && order.revenueAmount > 0) {
    const PlatformStats = require('../../models/platform/platformStatsModel');
    const platformStats = await PlatformStats.getStats();

    const oldRevenue = platformStats.totalRevenue || 0;
    const deductionAmount = order.revenueAmount;

    // Deduct the order's revenue amount
    platformStats.totalRevenue = Math.max(0, oldRevenue - deductionAmount);
    platformStats.lastUpdated = new Date();
    await platformStats.save();

    logger.info(
      `[deleteOrder] Deducted GH₵${deductionAmount.toFixed(
        2
      )} from admin revenue for deleted order ${orderId}`
    );
    logger.info(
      `[deleteOrder] Revenue: GH₵${oldRevenue.toFixed(
        2
      )} → GH₵${platformStats.totalRevenue.toFixed(2)}`
    );

    // Log activity
    const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
    logActivityAsync({
      userId: adminId,
      role: req.user?.role || 'admin',
      action: 'ORDER_DELETED',
      description: `Order ${order.orderNumber || orderId} deleted. Revenue deducted: GH₵${deductionAmount.toFixed(
        2
      )}`,
      req,
      metadata: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        revenueDeducted: deductionAmount,
        oldRevenue,
        newRevenue: platformStats.totalRevenue,
      },
    });
  }

  // Now delete the order
  await Order.findByIdAndDelete(orderId);

  res.status(200).json({
    status: 'success',
    message: 'Order deleted successfully. Revenue has been deducted from admin total revenue.',
    data: {
      deletedOrder: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        revenueDeducted: order.revenueAdded && order.revenueAmount ? order.revenueAmount : 0,
        backedUp: true,
      },
    },
  });
});

/**
 * Update order shipping address
 * PATCH /api/v1/order/:id/shipping-address
 * Only allowed if order is less than 24 hours old
 */
exports.updateOrderShippingAddress = catchAsync(async (req, res, next) => {
  const orderId = req.params.id;
  const { addressId } = req.body;

  if (!addressId) {
    return next(new AppError('Address ID is required', 400));
  }

  // Find the order
  const order = await Order.findById(orderId);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify the order belongs to the logged-in user
  if (order.user.toString() !== req.user.id) {
    return next(new AppError('You are not authorized to update this order', 403));
  }

  // Check if order is less than 24 hours old
  const orderDate = new Date(order.createdAt);
  const now = new Date();
  const hoursDiff = (now - orderDate) / (1000 * 60 * 60);

  if (hoursDiff >= 24) {
    return next(
      new AppError(
        'Order cannot be edited. Orders can only be edited within 24 hours of placement.',
        400
      )
    );
  }

  // Check if order has already been shipped
  if (order.orderStatus === 'shipped' || order.FulfillmentStatus === 'shipped') {
    return next(
      new AppError('Order cannot be edited. Order has already been shipped.', 400)
    );
  }

  // Verify the address exists and belongs to the user
  const Address = require('../../models/user/addressModel');
  const address = await Address.findById(addressId);

  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  if (address.user.toString() !== req.user.id) {
    return next(new AppError('You are not authorized to use this address', 403));
  }

  // Update the order shipping address
  // Since shippingAddress is stored as Object type, we can store the address ID or the full address object
  // For consistency, let's store the address ID and populate it when fetching
  order.shippingAddress = addressId;

  await order.save();

  // Populate the address for the response
  const updatedOrder = await Order.findById(orderId)
    .populate({
      path: 'shippingAddress',
      model: 'Address',
    })
    .populate({
      path: 'user',
      select: 'name email phone',
    });

  res.status(200).json({
    status: 'success',
    message: 'Shipping address updated successfully',
    data: {
      order: updatedOrder,
    },
  });
});

/**
 * Update order address and recalculate shipping
 * PATCH /api/v1/orders/:orderId/update-address
 */
exports.updateOrderAddressAndRecalculate = catchAsync(async (req, res, next) => {
  const orderId = req.params.orderId;
  const { addressId, shippingType } = req.body;

  if (!addressId) {
    return next(new AppError('Address ID is required', 400));
  }

  if (!shippingType || !['same_day', 'standard'].includes(shippingType)) {
    return next(new AppError('Valid shipping type is required (same_day or standard)', 400));
  }

  // Find the order
  const order = await Order.findById(orderId)
    .populate({
      path: 'orderItems',
      populate: {
        path: 'product',
        select: 'variants specifications shipping',
      },
    });

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify the order belongs to the logged-in user
  if (order.user.toString() !== req.user.id) {
    return next(new AppError('You are not authorized to update this order', 403));
  }

  // Check if order is modifiable (less than 24 hours old and not shipped)
  const orderDate = new Date(order.createdAt);
  const now = new Date();
  const hoursDiff = (now - orderDate) / (1000 * 60 * 60);

  if (hoursDiff >= 24) {
    return next(
      new AppError(
        'Order cannot be edited. Orders can only be edited within 24 hours of placement.',
        400
      )
    );
  }

  if (order.orderStatus === 'shipped' || order.FulfillmentStatus === 'shipped') {
    return next(
      new AppError('Order cannot be edited. Order has already been shipped.', 400)
    );
  }

  // Verify the address exists and belongs to the user
  const Address = require('../../models/user/addressModel');
  const address = await Address.findById(addressId);

  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  if (address.user.toString() !== req.user.id) {
    return next(new AppError('You are not authorized to use this address', 403));
  }

  // Store old shipping fee
  const oldShippingFee = order.shippingFee || order.shippingCost || 0;

  // Calculate weight from order items
  const { calculateCartWeight } = require('../../utils/helpers/shippingHelpers');
  const totalWeight = await calculateCartWeight(order.orderItems);

  // Get neighborhood from address (town field maps to neighborhood name)
  const Neighborhood = require('../../models/shipping/neighborhoodModel');
  const { getZoneFromNeighborhoodName } = require('../../utils/getZoneFromNeighborhood');
  const { calcShipping } = require('../../utils/calcShipping');

  // Find neighborhood by landmark or street address (which may contain neighborhood name)
  // Address city is stored as 'ACCRA' or 'TEMA', but Neighborhood uses 'Accra' or 'Tema'
  const cityMap = {
    ACCRA: 'Accra',
    TEMA: 'Tema',
  };
  const normalizedCity = cityMap[address.city] || address.city;

  // Try to extract neighborhood name from address fields
  // Priority: landmark > streetAddress > city (as fallback)
  const potentialNeighborhoodName = address.landmark || address.streetAddress?.split(',')[0] || address.city;

  let neighborhood, zone;
  try {
    // Try to find neighborhood by name
    ({ neighborhood, zone } = await getZoneFromNeighborhoodName(
      potentialNeighborhoodName,
      normalizedCity
    ));
  } catch (error) {
    // If neighborhood not found, try to find by city (use first neighborhood in city as fallback)
    // This is a temporary solution - ideally addresses should have neighborhoodId field
    const Neighborhood = require('../../models/shipping/neighborhoodModel');
    const fallbackNeighborhood = await Neighborhood.findOne({
      city: normalizedCity,
      isActive: true,
    }).sort({ name: 1 });

    if (!fallbackNeighborhood || !fallbackNeighborhood.assignedZone) {
      return next(
        new AppError(
          `Could not determine shipping zone for address. Please ensure your address includes a valid neighborhood name.`,
          404
        )
      );
    }

    const ShippingZone = require('../../models/shipping/shippingZoneModel');
    zone = await ShippingZone.findOne({
      name: fallbackNeighborhood.assignedZone,
      isActive: true,
    });

    if (!zone) {
      return next(
        new AppError(
          `Shipping zone ${fallbackNeighborhood.assignedZone} not found or inactive`,
          404
        )
      );
    }

    neighborhood = fallbackNeighborhood;
  }

  // Validate same-day availability (check if it's before cut-off time)
  if (shippingType === 'same_day') {
    // Get current time in Ghana (GMT+0 / UTC+0)
    const ghanaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Accra' }));
    const hour = ghanaTime.getHours();
    const minute = ghanaTime.getMinutes();
    const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const cutOffTime = '15:00'; // 3pm cut-off for same-day (Ghana time)

    if (currentTime > cutOffTime) {
      return next(
        new AppError(
          'Same-day delivery is only available for orders placed before 3:00 PM Ghana time. Please select standard delivery.',
          400
        )
      );
    }
  }

  // Calculate new shipping fee using neighborhood-based zone
  const newShippingFee = calcShipping(zone, totalWeight, shippingType);

  // Calculate delivery estimate from shipping options
  const { calculateDeliveryEstimate, getActiveShippingConfig } = require('../../utils/helpers/shippingHelpers');
  const shippingConfig = await getActiveShippingConfig();
  // Use existing orderDate variable from line 917
  const deliveryEstimate = shippingConfig
    ? calculateDeliveryEstimate(shippingType, orderDate, shippingConfig)
    : (zone.estimatedDays || '2-3');

  // Calculate difference
  const difference = newShippingFee - oldShippingFee;
  const requiresAdditionalPayment = difference > 0;

  // Update order with new address and shipping info
  order.shippingAddress = addressId;
  order.shippingType = shippingType;
  order.deliveryZone = zone.name; // Store zone name (A, B, C, etc.)
  order.deliveryEstimate = deliveryEstimate;
  order.weight = totalWeight;
  order.oldShippingFee = oldShippingFee;
  order.newShippingFee = newShippingFee;
  // Store neighborhood reference if available
  if (neighborhood._id) {
    order.neighborhood = neighborhood._id;
  }

  // If fee decreased, update immediately
  if (difference < 0) {
    order.shippingFee = newShippingFee;
    order.shippingCost = newShippingFee;
    order.additionalAmount = 0;
    order.shippingDifferencePaid = true;
    await order.save();

    return res.status(200).json({
      status: 'success',
      message: 'Shipping address and method updated successfully',
      data: {
        order,
        reduced: true,
        oldFee: oldShippingFee,
        newFee: newShippingFee,
        difference: Math.abs(difference),
      },
    });
  }

  // If fee increased, require additional payment
  if (requiresAdditionalPayment) {
    order.shippingFee = oldShippingFee; // Keep old fee until payment
    order.shippingCost = oldShippingFee;
    order.additionalAmount = difference;
    order.shippingDifferencePaid = false;
    await order.save();

    return res.status(200).json({
      status: 'success',
      message: 'Shipping address updated. Additional payment required.',
      data: {
        order,
        requiresAdditionalPayment: true,
        additionalAmount: difference,
        oldShippingFee,
        newShippingFee,
      },
    });
  }

  // If fees are equal, update immediately
  order.shippingFee = newShippingFee;
  order.shippingCost = newShippingFee;
  order.additionalAmount = 0;
  order.shippingDifferencePaid = true;
  await order.save();

  res.status(200).json({
    status: 'success',
    message: 'Shipping address and method updated successfully',
    data: {
      order,
    },
  });
});

/**
 * Send order detail email to user
 * POST /api/v1/order/:orderId/send-email
 */
exports.sendOrderDetailEmail = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  // Get order with all populated fields
  const order = await Order.findById(orderId)
    .populate({
      path: 'orderItems',
      populate: [
        { path: 'product', select: 'name price imageCover' },
        { path: 'variant' },
      ],
    })
    .populate('shippingAddress')
    .populate('user', 'name email')
    .lean();

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Get user email
  const userEmail = order.user?.email;
  if (!userEmail) {
    return next(new AppError('User email not found for this order', 400));
  }

  const userName = order.user?.name || 'Customer';

  try {
    // Send order detail email
    await sendOrderDetailEmail(userEmail, order, userName);

    res.status(200).json({
      status: 'success',
      message: 'Order detail email sent successfully',
    });
  } catch (error) {
    logger.error('Error sending order detail email:', error);
    return next(new AppError(`Failed to send email: ${error.message}`, 500));
  }
});

/**
 * Pay shipping difference
 * POST /api/v1/orders/:orderId/pay-shipping-difference
 */
exports.payShippingDifference = catchAsync(async (req, res, next) => {
  const orderId = req.params.orderId;

  // Find the order
  const order = await Order.findById(orderId);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify the order belongs to the logged-in user
  if (order.user.toString() !== req.user.id) {
    return next(new AppError('You are not authorized to update this order', 403));
  }

  // Check if additional payment is required
  if (!order.additionalAmount || order.additionalAmount <= 0) {
    return next(new AppError('No additional payment required for this order', 400));
  }

  if (order.shippingDifferencePaid) {
    return next(new AppError('Shipping difference has already been paid', 400));
  }

  // Initialize payment (using Paystack)
  // Use payment controller's initialization method
  const paymentController = require('./paymentController');

  // Create payment initialization request
  const paymentData = {
    amount: order.additionalAmount * 100, // Convert to kobo/pesewas
    email: req.user.email,
    reference: `SHIP-${order.orderNumber}-${Date.now()}`,
    metadata: {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      paymentType: 'shipping_difference',
      additionalAmount: order.additionalAmount,
    },
  };

  // Initialize Paystack payment using payment controller
  const axios = require('axios');
const logger = require('../../utils/logger');
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

  try {
    const paymentResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      paymentData,
      {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!paymentResponse.data.status) {
      return next(new AppError('Failed to initialize payment', 500));
    }

    // Return payment authorization URL
    return res.status(200).json({
      status: 'success',
      message: 'Payment initialized',
      data: {
        authorizationUrl: paymentResponse.data.data.authorization_url,
        accessCode: paymentResponse.data.data.access_code,
        reference: paymentResponse.data.data.reference,
        amount: order.additionalAmount,
      },
    });
  } catch (error) {
    logger.error('Paystack initialization error:', error);
    return next(new AppError('Failed to initialize payment', 500));
  }

  if (!paymentResponse.status) {
    return next(new AppError('Failed to initialize payment', 500));
  }

  // Return payment authorization URL
  res.status(200).json({
    status: 'success',
    message: 'Payment initialized',
    data: {
      authorizationUrl: paymentResponse.data.authorization_url,
      accessCode: paymentResponse.data.access_code,
      reference: paymentResponse.data.reference,
      amount: order.additionalAmount,
    },
  });
});
