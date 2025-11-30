const Order = require('../../models/order/orderModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const OrderItems = require('../../models/order/OrderItemModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Product = require('../../models/product/productModel');
const Address = require('../../models/user/addressModel');
const handleFactory = require('../shared/handleFactory');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');
const { generateOrderNumber } = require('../../utils/helpers/helper');
const { generateTrackingNumber } = require('../../services/order/shippingService');
const { populate } = require('../../models/category/categoryModel');
const CouponBatch = require('../../models/coupon/couponBatchModel');
const CouponUsage = require('../../models/coupon/couponUsageModel');
const { sendOrderDetailEmail } = require('../../utils/email/sendGridService');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

/**
 * Reduce product stock for order items after payment is confirmed
 * @param {Object} order - The order document with populated orderItems
 * @param {Object} session - MongoDB session (optional)
 */
exports.reduceOrderStock = async (order, session = null) => {
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
        })
        .session(session || null);
      orderItems = populatedOrder.orderItems;
    }

    if (!orderItems || orderItems.length === 0) {
      console.log(`[reduceOrderStock] No order items found for order ${order._id}`);
      return;
    }

    // Process each order item
    for (const orderItem of orderItems) {
      const productId = orderItem.product?._id || orderItem.product;
      const variantId = orderItem.variant?._id || orderItem.variant;
      const quantity = orderItem.quantity;

      if (!productId || !quantity) {
        console.warn(`[reduceOrderStock] Skipping invalid order item:`, orderItem);
        continue;
      }

      // Find product
      const product = await Product.findById(productId).session(session || null);
      if (!product) {
        console.warn(`[reduceOrderStock] Product ${productId} not found`);
        continue;
      }

      // Reduce stock from variant if variant exists
      if (variantId && product.variants && product.variants.length > 0) {
        const variant = product.variants.id(variantId);
        if (variant) {
          const oldStock = variant.stock;
          variant.stock = Math.max(0, variant.stock - quantity);
          console.log(`[reduceOrderStock] Product ${product.name} - Variant ${variant.name}: ${oldStock} - ${quantity} = ${variant.stock}`);
        } else {
          console.warn(`[reduceOrderStock] Variant ${variantId} not found in product ${product.name}`);
          // Fallback: reduce from first variant if variant not found
          if (product.variants.length > 0) {
            const firstVariant = product.variants[0];
            const oldStock = firstVariant.stock;
            firstVariant.stock = Math.max(0, firstVariant.stock - quantity);
            console.log(`[reduceOrderStock] Fallback: Product ${product.name} - First variant ${firstVariant.name}: ${oldStock} - ${quantity} = ${firstVariant.stock}`);
          }
        }
      } else if (product.variants && product.variants.length > 0) {
        // No variant specified, reduce from first variant
        const firstVariant = product.variants[0];
        const oldStock = firstVariant.stock;
        firstVariant.stock = Math.max(0, firstVariant.stock - quantity);
        console.log(`[reduceOrderStock] Product ${product.name} - First variant ${firstVariant.name}: ${oldStock} - ${quantity} = ${firstVariant.stock}`);
      } else {
        console.warn(`[reduceOrderStock] Product ${product.name} has no variants`);
        continue;
      }

      // Update product status based on total stock
      const totalStock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
      if (totalStock === 0 && product.status !== 'draft') {
        product.status = 'out_of_stock';
      } else if (totalStock > 0 && product.status === 'out_of_stock') {
        product.status = 'active';
      }

      // Save product
      if (session) {
        await product.save({ session });
      } else {
        await product.save();
      }
    }

    // Mark inventory as reduced in order metadata to prevent double reduction
    if (!order.metadata) {
      order.metadata = {};
    }
    order.metadata.inventoryReduced = true;
    order.metadata.inventoryReducedAt = new Date();
    
    if (session) {
      await order.save({ session, validateBeforeSave: false });
    } else {
      await order.save({ validateBeforeSave: false });
    }

    console.log(`[reduceOrderStock] ✅ Stock reduced successfully for order ${order._id}`);
  } catch (error) {
    console.error(`[reduceOrderStock] Error reducing stock for order ${order._id}:`, error);
    // Don't throw - log error but don't fail the payment process
  }
};

// import { path } from '../app.js';

// const calculateSubtotal = (items) => {
//   return items.reduce((total, item) => {
//     return total + item.product.price * item.quantity;
//   }, 0);
// };

exports.getAllOrder = handleFactory.getAll(Order, [
  {
    path: 'orderItems',
    select: 'quantity product',
    populate: {
      path: 'product',
      select: 'name price', // Add any other product fields you need
    },
  },
  {
    path: 'user',
    select: 'name email',
  },
]);
// creating orders
exports.createOrder = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderItems, address, couponCode } = req.body;
    console.log('Received couponCode:', couponCode);

    // Validate input
    if (!orderItems || orderItems.length === 0) {
      return next(new AppError('Order must contain at least one item', 400));
    }
    if (!address) {
      return next(new AppError('Shipping address is required', 400));
    }

    // Generate order number and tracking number
    const orderNumber = await generateOrderNumber();
    const trackingNumber = generateTrackingNumber();
    console.log('Generated order number:', orderNumber);
    console.log('Generated tracking number:', trackingNumber);

    // Import tax service and platform settings
    const taxService = require('../../services/tax/taxService');
    const PlatformSettings = require('../../models/platform/platformSettingsModel');
    
    // Get platform settings once for all items (cached)
    const platformSettings = await PlatformSettings.getSettings();
    const platformCommissionRate = platformSettings.platformCommissionRate || 0;
    
    // Create OrderItems with tax breakdown (using async tax calculations)
    const orderItemsWithTax = await Promise.all(
      orderItems.map(async (item) => {
        const vatInclusivePrice = item.price || 0;
        const taxBreakdown = await taxService.extractTaxFromPrice(vatInclusivePrice, platformSettings);
        const covidLevy = await taxService.calculateCovidLevy(taxBreakdown.basePrice, platformSettings);
        
        return {
          product: item.product,
          variant: item.variant?._id,
          quantity: item.quantity,
          price: vatInclusivePrice, // VAT-inclusive price
          basePrice: taxBreakdown.basePrice,
          vat: taxBreakdown.vat,
          nhil: taxBreakdown.nhil,
          getfund: taxBreakdown.getfund,
          covidLevy: covidLevy,
          totalTaxes: taxBreakdown.totalVATComponents + covidLevy,
          isVATInclusive: true,
        };
      })
    );
    
    const orderItemDocs = await OrderItems.insertMany(orderItemsWithTax, { session });
   

    // Get products with sellers
    const productIds = [...new Set(orderItems.map((item) => item.product))];
    const products = await Product.find({ _id: { $in: productIds } })
      .populate('seller', '_id role')
      .select('isEazShopProduct seller')
      .session(session);
    console.log('Found products:', products.length);
    
    // EazShop Seller ID constant
    const EAZSHOP_SELLER_ID = '000000000000000000000001';

    // Create product-seller map
    const productSellerMap = new Map();
    products.forEach((product) => {
      let sellerId;
      
      // Priority 1: If product is marked as EazShop product, use EazShop seller ID
      if (product.isEazShopProduct) {
        sellerId = EAZSHOP_SELLER_ID;
      } 
      // Priority 2: Use the product's seller field
      else if (product.seller?._id) {
        sellerId = product.seller._id.toString();
      }
      // Priority 3: Check if seller field is EazShop seller ID (for backward compatibility)
      else if (product.seller?.toString() === EAZSHOP_SELLER_ID) {
        sellerId = EAZSHOP_SELLER_ID;
      }
      
      productSellerMap.set(
        product._id.toString(),
        sellerId,
      );
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

    // COUPON VALIDATION AND PROCESSING - FIXED
    let couponUsed = null;
    let totalDiscount = 0;
    let couponUsageDoc = null;

    if (couponCode) {
      // Extract IDs from request
      const batchId = new mongoose.Types.ObjectId(req.body.batchId);
      const couponId = new mongoose.Types.ObjectId(req.body.couponId);

      // Find the coupon batch
      const couponBatch = await CouponBatch.findOne({
        _id: batchId,
        isActive: true,
        validFrom: { $lte: new Date() },
        expiresAt: { $gte: new Date() },
      }).session(session);

      if (!couponBatch) {
        console.log('No valid coupon batch found');
        throw new AppError('Invalid or expired coupon batch', 400);
      }

      

      // Find the specific coupon within the batch
      const coupon = couponBatch.coupons.find(
        (c) => c._id.toString() === couponId.toString(),
      );

      if (!coupon) {
        console.log('Coupon not found in batch');
        throw new AppError('Invalid coupon code', 400);
      }

      if (coupon.used) {
        console.log('Coupon already used');
        throw new AppError('This coupon has already been used', 400);
      }

   

      // Validate minimum order amount
      if (
        couponBatch.minOrderAmount &&
        overallSubtotal < couponBatch.minOrderAmount
      ) {
        console.log('Coupon minimum not met:', {
          minOrderAmount: couponBatch.minOrderAmount,
          overallSubtotal,
        });
        throw new AppError(
          `Coupon requires minimum order of GH₵${couponBatch.minOrderAmount.toFixed(2)}`,
          400,
        );
      }

      // Check batch-level usage limit
      if (couponBatch.coupons.usageCount >= couponBatch.maxUsage) {
        console.log('Batch usage limit exceeded:', {
          usageCount: couponBatch.usageCount,
          maxUsage: couponBatch.maxUsage,
        });
        throw new AppError(
          'This coupon batch has reached its usage limit',
          400,
        );
      }
      const currentUsage = couponBatch.coupons.reduce(
        (count, c) => (c.used ? count + 1 : count),
        0,
      );
      // if (currentUsage >= couponBatch.maxUsage) {
      //   console.log('Batch usage limit exceeded:', {
      //     currentUsage,
      //     maxUsage: couponBatch.maxUsage,
      //   });
      //   throw new AppError(
      //     'This coupon batch has reached its usage limit',
      //     400,
      //   );
      // }

      // Calculate discount
      if (couponBatch.discountType === 'percentage') {
        totalDiscount = (overallSubtotal * couponBatch.discountValue) / 100;
      } else {
        totalDiscount = Math.min(couponBatch.discountValue, overallSubtotal);
      }

      // Mark coupon as used and update batch
      coupon.used = true;
      coupon.usedAt = new Date();
      couponBatch.usageCount += 1;
      await couponBatch.save({ session });

      // Set couponUsed reference for the order
      couponUsed = couponBatch;
    }

    // Get delivery method from request body
    const deliveryMethod = req.body.deliveryMethod || 'seller_delivery';
    const pickupCenterId = req.body.pickupCenterId || null;
    const buyerCity = address?.city?.toUpperCase() || 'ACCRA';
    
    // Validate buyer city
    if (!['ACCRA', 'TEMA'].includes(buyerCity)) {
      return next(new AppError('EazShop currently delivers only in Accra and Tema.', 400));
    }

    // Calculate shipping using the shipping quote service
    const { calculateShippingQuote } = require('../../services/shipping/shippingCalculationService');
    
    // Prepare items for shipping calculation
    const shippingItems = orderItemDocs.map(item => ({
      productId: item.product,
      sellerId: productSellerMap.get(item.product.toString()),
      quantity: item.quantity,
    }));

    // Calculate shipping quote based on delivery method
    const shippingQuote = await calculateShippingQuote(
      buyerCity,
      shippingItems,
      deliveryMethod,
      pickupCenterId
    );

    // Create SellerOrders
    const sellerOrders = [];
    let orderTotal = 0;
    const shippingBreakdown = shippingQuote.perSeller || [];

    // For dispatch method, shipping is calculated at order level, not per seller
    const isDispatchMethod = deliveryMethod === 'dispatch';
    const orderLevelShipping = isDispatchMethod ? shippingQuote.totalShippingFee : 0;

    for (const [sellerId, group] of sellerGroups) {
      const sellerDiscount =
        totalDiscount > 0
          ? (group.subtotal / overallSubtotal) * totalDiscount
          : 0;

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
      
      sellerItems.forEach(item => {
        const quantity = item.quantity || 1;
        sellerTotalBasePrice += (item.basePrice || 0) * quantity;
        sellerTotalVAT += (item.vat || 0) * quantity;
        sellerTotalNHIL += (item.nhil || 0) * quantity;
        sellerTotalGETFund += (item.getfund || 0) * quantity;
        sellerTotalCovidLevy += (item.covidLevy || 0) * quantity;
      });
      
      // Round to 2 decimal places
      sellerTotalBasePrice = Math.round(sellerTotalBasePrice * 100) / 100;
      sellerTotalVAT = Math.round(sellerTotalVAT * 100) / 100;
      sellerTotalNHIL = Math.round(sellerTotalNHIL * 100) / 100;
      sellerTotalGETFund = Math.round(sellerTotalGETFund * 100) / 100;
      sellerTotalCovidLevy = Math.round(sellerTotalCovidLevy * 100) / 100;
      const sellerTotalTax = Math.round((sellerTotalVAT + sellerTotalNHIL + sellerTotalGETFund + sellerTotalCovidLevy) * 100) / 100;
      
      // Get shipping fee for this seller from the quote
      const sellerShippingInfo = shippingBreakdown.find(s => s.sellerId === sellerId.toString());
      const shipping = sellerShippingInfo?.shippingFee || 0;
      
      // Total for seller order: VAT-inclusive subtotal + shipping + COVID levy
      // Note: VAT, NHIL, GETFund are already in the subtotal (VAT-inclusive)
      const total = sellerSubtotal + shipping + sellerTotalCovidLevy;
      orderTotal += total;

      // Determine if this is an EazShop order
      const isEazShopStore = sellerId === EAZSHOP_SELLER_ID;
      const sellerProduct = products.find(p => 
        p.seller?._id?.toString() === sellerId || 
        p.seller?.toString() === sellerId
      );
      const isEazShopProduct = sellerProduct?.isEazShopProduct || 
        sellerProduct?.seller?.role === 'eazshop_store' ||
        isEazShopStore;
      
      // Determine delivery method for this seller
      // Map 'dispatch' to 'eazshop_dispatch' for SellerOrder model
      let sellerDeliveryMethod = deliveryMethod;
      if (deliveryMethod === 'dispatch') {
        sellerDeliveryMethod = 'eazshop_dispatch';
      } else if (isEazShopProduct && deliveryMethod === 'seller_delivery') {
        // EazShop products should use dispatch if seller_delivery was selected
        sellerDeliveryMethod = 'eazshop_dispatch';
      }
      
      const sellerOrder = new SellerOrder({
        seller: sellerId,
        items: group.items,
        subtotal: sellerSubtotal, // VAT-inclusive subtotal
        originalSubtotal: group.subtotal,
        discountAmount: sellerDiscount,
        tax: 0, // Deprecated - use tax breakdown fields
        shippingCost: shipping,
        total: total, // Includes VAT-inclusive subtotal + shipping + COVID levy
        // Tax breakdown fields
        totalBasePrice: sellerTotalBasePrice, // Seller revenue (VAT exclusive)
        totalVAT: sellerTotalVAT,
        totalNHIL: sellerTotalNHIL,
        totalGETFund: sellerTotalGETFund,
        totalCovidLevy: sellerTotalCovidLevy,
        totalTax: sellerTotalTax,
        isVATInclusive: true,
        commissionRate: platformCommissionRate, // Use platform settings commission rate
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

    // Calculate total shipping fee
    // For dispatch, add order-level shipping; for others, sum per-seller fees
    const totalShippingFee = isDispatchMethod 
      ? orderLevelShipping 
      : shippingBreakdown.reduce((sum, item) => sum + item.shippingFee, 0);
    
    // Add order-level shipping to total if dispatch method
    if (isDispatchMethod) {
      orderTotal += orderLevelShipping;
    }
    
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
        console.warn('Could not determine neighborhood/zone for order:', error.message);
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
      shippingAddress: address,
      orderItems: orderItemDocs.map((doc) => doc._id),
      orderStatus: 'pending',
      paymentStatus: 'pending',
      sellerOrder: sellerOrders,
      totalPrice: orderTotal, // Grand total (VAT-inclusive + shipping + COVID levy)
      coupon: couponUsed?._id,
      discountAmount: totalDiscount,
      paymentMethod: req.body.paymentMethod || 'mobile_money',
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
        const paymentMethod = req.body.paymentMethod || 'mobile_money';
        // Cash on Delivery - payment pending until delivery
        if (paymentMethod === 'payment_on_delivery' || paymentMethod === 'cod') {
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
      const paymentMethod = req.body.paymentMethod || 'mobile_money';
      if (paymentMethod === 'payment_on_delivery' || paymentMethod === 'cod') {
        // COD orders - payment pending until delivery
        newOrder.paymentStatus = 'pending';
        newOrder.status = 'pending';
        newOrder.currentStatus = 'pending_payment';
      } else if (paymentMethod === 'credit_balance') {
        // Credit balance payment - process immediately
        const Creditbalance = require('../../models/user/creditbalanceModel');
        const creditBalance = await Creditbalance.findOne({ user: req.user.id }).session(session);
        
        if (!creditBalance) {
          throw new AppError('Credit balance account not found', 404);
        }
        
        if (creditBalance.balance < orderTotal) {
          throw new AppError(
            `Insufficient balance. Your balance is GH₵${creditBalance.balance.toFixed(2)}, but order total is GH₵${orderTotal.toFixed(2)}`,
            400
          );
        }
        
        // Deduct from credit balance
        creditBalance.balance -= orderTotal;
        creditBalance.availableBalance = creditBalance.balance;
        creditBalance.transactions.push({
          amount: -orderTotal,
          type: 'purchase',
          description: `Order #${orderNumber} - Payment via credit balance`,
          reference: orderNumber,
        });
        creditBalance.lastUpdated = new Date();
        await creditBalance.save({ session });
        
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
      } else {
        // Paystack orders wait for payment
        newOrder.paymentStatus = 'pending';
        newOrder.status = 'pending';
        newOrder.currentStatus = 'pending_payment';
      }
    }
    
    await newOrder.save({ session });
    
    // Update sellerOrders with order reference
    for (const sellerOrderId of sellerOrders) {
      await SellerOrder.findByIdAndUpdate(
        sellerOrderId,
        { order: newOrder._id },
        { session }
      );
    }

    // Record coupon usage
    if (couponUsed) {
      couponUsageDoc = new CouponUsage({
        couponId: couponUsed._id,
        userId: req.user.id,
        orderId: newOrder._id,
        discountApplied: totalDiscount,
        usedAt: new Date(),
      });
      await couponUsageDoc.save({ session });
    }

    // Check product stock availability (but don't reduce yet - will reduce on order completion)
    // This ensures we validate stock at order creation but reduce inventory only when order is delivered
    for (const item of orderItems) {
      const product = await Product.findById(item.product).session(session);
      if (!product) continue;

      const variant = product.variants.id(item.variant?._id);
      if (variant) {
        // Only validate stock availability, don't reduce yet
        if (variant.stock < item.quantity) {
          throw new AppError(
            `Insufficient stock for ${product.name} (${variant.name})`,
            400,
          );
        }
        // Stock will be reduced when order is marked as completed/delivered
      }
    }

    // Commit transaction
    await session.commitTransaction();

    // Fetch populated order
    const fullOrder = await Order.findById(newOrder._id)
      .populate({
        path: 'sellerOrder',
        populate: [
          { path: 'seller', select: 'name email' },
          {
            path: 'items',
            populate: { path: 'product', select: 'name price imageCover' },
          },
        ],
      })
      .populate({
        path: 'orderItems',
        populate: [
          { path: 'product', select: 'name price imageCover' },
          { path: 'variant' },
        ],
      })
      .populate({
        path: 'coupon',
        select: 'code discountType discountValue',
      })
      .populate('user', 'name email')
      .lean();

    // Log activity
    logActivityAsync({
      userId: req.user.id,
      role: 'buyer',
      action: 'PLACE_ORDER',
      description: `User placed order #${newOrder.orderNumber} with total GH₵${newOrder.totalPrice?.toFixed(2) || '0.00'}`,
      req,
      metadata: {
        orderId: newOrder._id,
        orderNumber: newOrder.orderNumber,
        totalPrice: newOrder.totalPrice,
        itemCount: orderItems.length,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { order: fullOrder },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Order creation error:', error.message);
    console.error('Error stack:', error.stack);

    if (error.code === 11000 && error.keyPattern?.orderNumber) {
      return next(
        new AppError('Duplicate order number detected. Please try again.', 400),
      );
    }

    return next(new AppError(`Order creation failed: ${error.message}`, 500));
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
      select: 'orderNumber trackingNumber user createdAt paymentMethod paymentStatus paidAt shippingAddress deliveryMethod pickupCenterId dispatchType',
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

  const validSellerOrders = sellerOrders.filter((so) => so.order);
  if (validSellerOrders.length === 0) {
    return next(new AppError('No orders found for this seller', 404));
  }

  const formattedOrders = validSellerOrders.map((so) => ({
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
  
  console.log('[getOrderBySeller] Authorization check:', {
    orderId: orderId,
    orderSellerId: sellerId,
    userId: userId,
    match: sellerId === userId,
    orderSellerType: typeof order.seller,
    userType: typeof req.user.id,
    userRole: req.user.role,
  });
  
  if (sellerId !== userId) {
    console.error('[getOrderBySeller] Authorization failed:', {
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
  const order = await Order.findById(req.params.id);

  order.orderItems.map(async (item) => {
    await OrderItems.findByIdAndDelete(item);
  });
  next();
});
exports.getUserOrders = catchAsync(async (req, res, next) => {
  const orders = await Order.find({ user: req.user._id });
  if (!orders) return next(new AppError('Order not found', 404));
  res.status(200).json({ status: 'success', data: { orders } });
});
exports.getUserOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
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

  if (!order) return next(new AppError('Order not found', 404));
  
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
        console.warn(`[getUserOrder] Address not found for ID: ${orderData.shippingAddress}`);
        orderData.shippingAddress = null;
      }
    } catch (error) {
      console.error(`[getUserOrder] Error populating address:`, error);
      // If address population fails, keep the ID or set to null
      orderData.shippingAddress = orderData.shippingAddress || null;
    }
  }
  
  // Ensure shippingAddress is included (even if null)
  if (!orderData.shippingAddress) {
    console.warn(`[getUserOrder] Shipping address missing for order ${req.params.id}`);
  }
  
  res.status(200).json({ 
    status: 'success', 
    data: { 
      order: orderData
    } 
  });
});
exports.getOrder = handleFactory.getOne(Order, [
  {
    path: 'orderItems',
    select: 'quantity product',
    populate: {
      path: 'product',
      select: 'name price', // Add any other product fields you need
    },
  },
  // Second population: User information
  {
    path: 'user',
    select: 'name email phone',
  },
  // Third population: Seller orders with additional details
  {
    path: 'sellerOrder',
    populate: {
      path: 'seller',
      select: 'name email businessName',
    },
  },
]);
// Override updateOrder to handle status sync and seller balance updates
exports.updateOrder = catchAsync(async (req, res, next) => {
  const orderId = req.params.id;
  const updateData = req.body;

  // Find order
  const order = await Order.findById(orderId);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Store previous status
  const previousStatus = order.currentStatus;
  const wasCompleted = order.currentStatus === 'delivered' || order.status === 'completed';

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

  await order.save();

  // Sync SellerOrder status with Order status if currentStatus was updated
  if (updateData.currentStatus) {
    try {
      const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
      const syncResult = await syncSellerOrderStatus(orderId, updateData.currentStatus);
      console.log('[updateOrder] SellerOrder sync result:', syncResult);
    } catch (error) {
      console.error('[updateOrder] Error syncing SellerOrder status:', error);
      // Don't fail the order update if SellerOrder sync fails
    }
  }

  // CRITICAL: Credit sellers ONLY when order status becomes "delivered"
  // This is the ONLY place where sellers should be credited
  if (updateData.currentStatus === 'delivered' && !wasCompleted) {
    try {
      const orderService = require('../../services/order/orderService');
      const balanceUpdateResult = await orderService.creditSellerForOrder(
        orderId,
        req.user.id
      );
      console.log('[updateOrder] Seller balance credit result:', balanceUpdateResult);
      if (!balanceUpdateResult.success) {
        console.warn('[updateOrder] Seller credit failed:', balanceUpdateResult.message);
      }
    } catch (error) {
      // Log error but don't fail the status update
      console.error('[updateOrder] Error crediting seller balances:', error);
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
      console.log('[updateOrder] Seller balance reversal result:', reversalResult);
    } catch (error) {
      // Log error but don't fail the status update
      console.error('[updateOrder] Error reverting seller balances:', error);
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

  // Save backup to a collection (we'll create a DeletedOrder model)
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
    
    console.log(`[deleteOrder] Deducted GH₵${deductionAmount.toFixed(2)} from admin revenue for deleted order ${orderId}`);
    console.log(`[deleteOrder] Revenue: GH₵${oldRevenue.toFixed(2)} → GH₵${platformStats.totalRevenue.toFixed(2)}`);
    
    // Log activity
    const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
    logActivityAsync({
      userId: adminId,
      role: req.user?.role || 'admin',
      action: 'ORDER_DELETED',
      description: `Order ${order.orderNumber || orderId} deleted. Revenue deducted: GH₵${deductionAmount.toFixed(2)}`,
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
    console.error('Error sending order detail email:', error);
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
    console.error('Paystack initialization error:', error);
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
