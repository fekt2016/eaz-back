const Order = require('../Models/orderModel');
const catchAsync = require('../utils/catchAsync');
const OrderItems = require('../Models/OrderItemModel');
const SellerOrder = require('../Models/sellerOrderModel');
const Product = require('../Models/productModel');
const handleFactory = require('../Controllers/handleFactory');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const { generateOrderNumber } = require('../utils/helper');
const { populate } = require('../Models/categoryModel');
const CouponBatch = require('../Models/couponBatchModel');
const CouponUsage = require('../Models/couponUsageModel');

// const { path } = require('../app');

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
  console.log('createOrder initiated');
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

    // Generate order number
    const orderNumber = await generateOrderNumber();
    console.log('Generated order number:', orderNumber);

    // Create OrderItems
    const orderItemDocs = await OrderItems.insertMany(
      orderItems.map((item) => ({
        product: item.product,
        variant: item.variant?._id,
        quantity: item.quantity,
        price: item.price,
      })),
      { session },
    );
    console.log('Created order items:', orderItemDocs.length);

    // Get products with sellers
    const productIds = [...new Set(orderItems.map((item) => item.product))];
    const products = await Product.find({ _id: { $in: productIds } })
      .populate('seller', '_id')
      .session(session);
    console.log('Found products:', products.length);

    // Create product-seller map
    const productSellerMap = new Map();
    products.forEach((product) => {
      productSellerMap.set(
        product._id.toString(),
        product.seller?._id?.toString(),
      );
    });

    // Group items by seller and calculate subtotal
    const sellerGroups = new Map();
    let overallSubtotal = 0;

    orderItemDocs.forEach((item) => {
      const sellerId = productSellerMap.get(item.product.toString());

      if (!sellerId) {
        throw new AppError(`Seller missing for product: ${item.product}`, 400);
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

      console.log('Coupon batch found:', couponBatch.name);

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

      console.log('Coupon found:', coupon.code);

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

      console.log('Discount applied:', totalDiscount);

      // Mark coupon as used and update batch
      coupon.used = true;
      coupon.usedAt = new Date();
      couponBatch.usageCount += 1;
      await couponBatch.save({ session });
      console.log('Coupon marked as used and batch updated');

      // Set couponUsed reference for the order
      couponUsed = couponBatch;
    }

    // Create main order
    const newOrder = new Order({
      orderNumber,
      user: req.user.id,
      shippingAddress: address,
      orderItems: orderItemDocs.map((doc) => doc._id),
      orderStatus: 'pending',
      paymentStatus: 'pending',
      sellerOrder: [],
      totalPrice: 0,
      coupon: couponUsed?._id,
      discountAmount: totalDiscount,
    });
    await newOrder.save({ session });
    console.log('Main order created:', newOrder._id);

    // Create SellerOrders
    const sellerOrders = [];
    let orderTotal = 0;

    for (const [sellerId, group] of sellerGroups) {
      const sellerDiscount =
        totalDiscount > 0
          ? (group.subtotal / overallSubtotal) * totalDiscount
          : 0;

      const sellerSubtotal = group.subtotal - sellerDiscount;
      const tax = sellerSubtotal * 0.08;
      const shipping = 9.99;
      const total = sellerSubtotal + tax + shipping;
      orderTotal += total;

      const sellerOrder = new SellerOrder({
        seller: sellerId,
        items: group.items,
        originalSubtotal: group.subtotal,
        discountAmount: sellerDiscount,
        tax,
        shippingCost: shipping,
        total,
        status: 'pending',
        payoutStatus: 'pending',
        order: newOrder._id,
      });

      await sellerOrder.save({ session });
      sellerOrders.push(sellerOrder._id);
    }
    console.log('Created seller orders:', sellerOrders.length);

    // Update main order
    newOrder.sellerOrder = sellerOrders;
    newOrder.totalPrice = orderTotal;
    await newOrder.save({ session });
    console.log('Main order updated with totals');

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
      console.log('Coupon usage recorded');
    }

    // Update product stock
    for (const item of orderItems) {
      const product = await Product.findById(item.product).session(session);
      if (!product) continue;

      const variant = product.variants.id(item.variant?._id);
      if (variant) {
        if (variant.stock < item.quantity) {
          throw new AppError(
            `Insufficient stock for ${product.name} (${variant.name})`,
            400,
          );
        }
        variant.stock -= item.quantity;
        await product.save({ session });
      }
    }
    console.log('Product stock updated');

    // Commit transaction
    await session.commitTransaction();
    console.log('Transaction committed successfully');

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
      select: 'orderNumber user createdAt paymentMethod shippingAddress',
      populate: {
        path: 'user',
        select: 'name email phone',
      },
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
    user: so.order.user,
    createdAt: so.order.createdAt,
    paymentMethod: so.order.paymentMethod,
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
  console.log('fetching seller order by ID');
  // Get order ID from URL params
  const orderId = req.params.id;
  console.log('orderId', req.params.id);

  // Validate MongoDB ID format
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new AppError('Invalid order ID format', 400));
  }

  // Find order and populate necessary data
  const order = await SellerOrder.findById(orderId)
    .populate({
      path: 'order',
      populate: {
        path: 'user',
        model: 'User',
        select: 'name email',
      },
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
  if (order.seller.toString() !== req.user.id) {
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
  const orders = await Order.find({ user: req.user._id }).populate(
    'user',
    'name email',
  );
  if (!orders) return next(new AppError('Order not found', 404));
  res.status(200).json({ status: 'success', data: { orders } });
});
exports.getUserOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate({
      path: 'user',
      select: 'name email',
    })
    .populate({
      path: 'orderItems', // Populate orderItems array
      // Optional: populate nested fields within orderItems
      populate: {
        path: 'product', // Example: if orderItems have a 'product' reference
        select: 'name price imageCover', // Select specific product fields
      },
    })
    .populate({
      path: 'sellerOrder',
      populate: [
        {
          path: 'seller',
          select: 'name email',
        },
        {
          path: 'items.product',
          model: 'Product',
          select: 'name imageCover price',
        },
      ],
    });

  if (!order) return next(new AppError('Order not found', 404));
  res.status(200).json({ status: 'success', data: { order } });
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
exports.updateOrder = handleFactory.updateOne(Order);
exports.deleteOrder = handleFactory.deleteOne(Order);
