const Order = require('../Models/orderModel');
const catchAsync = require('../utils/catchAsync');
const OrderItems = require('../Models/OrderItemModel');
const SellerOrder = require('../Models/sellerOrderModel');
const Product = require('../Models/productModel');
const handleFactory = require('../Controllers/handleFactory');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const { generateOrderNumber } = require('../utils/helper');

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
    const { orderItems, address } = req.body;

    // console.log('orderItems', orderItems);
    if (!orderItems || orderItems.length === 0) {
      return next(new AppError('Order must contain at least one item', 400));
    }
    if (!address) {
      return next(new AppError('Shipping address is required', 400));
    }

    const orderNumber = await generateOrderNumber();

    const productIds = orderItems.map((item) => item.product);
    const uniqueIds = [...new Set(productIds)];

    // Find products with seller population
    const products = await Product.find({ _id: { $in: uniqueIds } })
      .populate('seller', '_id')
      .session(session);

    // Validate products
    if (products.length !== uniqueIds.length) {
      const foundIds = products.map((p) => p._id.toString());
      const missingProducts = productIds.filter((id) => !foundIds.includes(id));
      return next(
        new AppError(`Products not found: ${missingProducts.join(', ')}`, 404),
      );
    }

    // Create product map
    const productMap = new Map();

    products.forEach((product) => {
      productMap.set(product._id.toString(), {
        price: product.price,
        seller: product.seller?._id,
      });
    });
    // console.log('productMap', productMap);

    // Create OrderItems
    const orderItemDocs = await OrderItems.insertMany(
      orderItems.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        price: productMap.get(item.product.toString()).price,
      })),
      { session },
    );
    // console.log('orderItemDocs', orderItemDocs);
    // Group by seller
    const sellerGroups = new Map();

    for (const item of orderItemDocs) {
      const product = productMap.get(item.product.toString());

      if (!product.seller || !product.seller._id) {
        return next(
          new AppError(`Seller missing for product: ${product._id}`, 400),
        );
      }

      const sellerId = product.seller._id.toString();

      if (!sellerGroups.has(sellerId)) {
        sellerGroups.set(sellerId, {
          items: [],
          subtotal: 0,
        });
      }

      const group = sellerGroups.get(sellerId);
      group.items.push(item._id);
      group.subtotal += item.price * item.quantity;
    }

    // console.log('orderItemDocs', orderItemDocs);
    // CREATE MAIN ORDER FIRST
    const newOrder = new Order({
      orderNumber,
      user: req.user.id || user,
      shippingAddress: address,
      sellerOrders: [], // Will be filled later
      totalPrice: 0, // Temporary value
      orderItems: orderItemDocs.map((doc) => doc._id),
      orderStatus: 'pending',
      paymentStatus: 'pending',
    });
    await newOrder.save({ session });

    // Create SellerOrders with parent order reference
    const sellerOrders = [];
    let orderTotal = 0;

    for (const [sellerId, group] of sellerGroups) {
      const tax = group.subtotal * 0.08;
      const total = group.subtotal + tax;
      const shipping = 9.99;
      orderTotal += total + shipping;

      const sellerOrder = new SellerOrder({
        seller: sellerId,
        items: group.items,
        subtotal: group.subtotal,
        tax,
        total,
        shippingCost: shipping,
        status: 'pending',
        payoutStatus: 'pending',
        order: newOrder._id, // ADD PARENT ORDER REFERENCE
      });

      await sellerOrder.save({ session });
      sellerOrders.push(sellerOrder._id);
    }
    // console.log('sellerOrders', sellerOrders);
    // Update main order with seller orders and total price
    newOrder.sellerOrder = sellerOrders;
    newOrder.totalPrice = orderTotal;
    await newOrder.save({ session });

    // Commit transaction
    await session.commitTransaction();

    // Fetch populated order
    const fullOrder = await Order.findById(newOrder._id)
      .populate({
        path: 'sellerOrders',
        populate: [
          {
            path: 'seller',
            model: 'User',
            select: 'name email',
          },
          {
            path: 'items',
            model: 'OrderItems',
            populate: {
              path: 'product',
              model: 'Product',
            },
          },
        ],
      })
      .populate('user', 'name email')
      .populate({
        path: 'orderItems',
        populate: {
          path: 'product',
          model: 'Product',
          select: 'name price imageCover', // 👈 Also apply for direct orderItems
        },
      })
      .lean();

    console.log('fullOrder', fullOrder);

    res.status(201).json({
      status: 'success',
      data: { order: fullOrder },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Order creation error:', error);

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
        select: 'name email',
      },
    })
    .sort('-createdAt');

  const validSellerOrders = sellerOrders.filter((so) => so.order);
  if (validSellerOrders.length === 0) {
    return next(new AppError('No orders found for this seller', 404));
  }

  const formattedOrders = sellerOrders.map((so) => ({
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
// exports.getOrder = handleFactory.getOne(Order);
exports.updateOrder = handleFactory.updateOne(Order);
exports.deleteOrder = handleFactory.deleteOne(Order);
