const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Order = require('../../models/order/orderModel');
const orderService = require('../../services/order/orderService');
const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');
const {
  validateStatusTransition,
  mapRoleToUpdatedByRole,
} = require('../../utils/helpers/orderStatusTransitions');

/**
 * Update order status
 * POST /api/v1/orders/:orderId/status
 * Only admin or seller can update
 */
exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { status, message, location } = req.body;
  const user = req.user;

  // Validate status (generic tracking system)
  const validStatuses = [
    'pending_payment',
    'payment_completed',
    'processing',
    'confirmed',
    'preparing',
    'ready_for_dispatch',
    // International pre-order specific statuses
    'supplier_confirmed',
    'awaiting_dispatch',
    'international_shipped',
    'customs_clearance',
    'arrived_destination',
    'local_dispatch',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'refunded',
  ];

  if (!status || !validStatuses.includes(status)) {
    return next(new AppError('Invalid status', 400));
  }

  // Find order
  const order = await Order.findById(orderId);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check authorization: admin or seller (who owns items in the order)
  const isAdmin = user.role === 'admin';
  const isSeller = user.role === 'seller';

  if (!isAdmin && !isSeller) {
    return next(new AppError('You are not authorized to update order status', 403));
  }

  // If seller, verify they have items in this order
  if (isSeller && !isAdmin) {
    const sellerOrders = await Order.findById(orderId)
      .populate({
        path: 'sellerOrder',
        populate: { path: 'seller' },
      })
      .lean();

    const hasItems = sellerOrders.sellerOrder?.some(
      (so) => so.seller?._id?.toString() === user.id
    );

    if (!hasItems) {
      return next(
        new AppError('You can only update status for orders containing your products', 403)
      );
    }
  }

  // Determine updatedByModel
  let updatedByModel = 'Admin';
  if (user.role === 'seller') {
    updatedByModel = 'Seller';
  } else if (user.role === 'user') {
    updatedByModel = 'User';
  }

  // Enforce safe status flow & order-type specific rules
  const transitionCheck = validateStatusTransition(order, status, user.role);
  if (!transitionCheck.allowed) {
    return next(new AppError(transitionCheck.reason || 'Invalid status transition', 400));
  }

  // Do not allow progressing unpaid orders beyond cancellation.
  const rawPaymentStatus = (order.paymentStatus || '').toString().toLowerCase();
  const isPaid =
    rawPaymentStatus === 'paid' || rawPaymentStatus === 'completed';
  if (!isPaid && status !== order.currentStatus && status !== 'cancelled') {
    return next(
      new AppError(
        'Cannot update order status while payment is pending. You may only cancel unpaid orders.',
        400,
      ),
    );
  }

  // For international pre-orders, certain steps are admin-only
  const isInternational = order.orderType === 'preorder_international';
  const isAdminLike = ['admin', 'superadmin', 'moderator'].includes(user.role);

  if (
    isInternational &&
    isSeller &&
    !isAdminLike &&
    ['customs_clearance', 'arrived_destination', 'delivered'].includes(status)
  ) {
    return next(
      new AppError('Only admin can update customs, arrival, or delivered status for international pre-orders', 403),
    );
  }

  // Add to tracking history
  const trackingEntry = {
    status,
    message: message || '',
    location: location || '',
    updatedBy: user.id,
    updatedByModel,
    updatedByRole: mapRoleToUpdatedByRole(user.role),
    timestamp: new Date(),
  };

  // Store previous status to check if we're transitioning to completed
  const previousStatus = order.currentStatus;
  const wasCompleted = order.currentStatus === 'delivered' || order.status === 'completed';

  // Update order - currentStatus is the single source of truth
  order.currentStatus = status;
  order.trackingHistory.push(trackingEntry);

  // Attach international pre-order metadata when relevant
  if (isInternational) {
    if (status === 'supplier_confirmed') {
      if (req.body.supplierCountry) order.supplierCountry = req.body.supplierCountry;
      if (req.body.supplierName) order.supplierName = req.body.supplierName;
      if (req.body.estimatedArrivalDate) {
        order.estimatedArrivalDate = new Date(req.body.estimatedArrivalDate);
      }
    }

    if (status === 'awaiting_dispatch' || status === 'international_shipped') {
      if (req.body.internationalTrackingNumber) {
        order.internationalTrackingNumber = req.body.internationalTrackingNumber;
      }
    }

    if (status === 'customs_clearance' && !order.customsClearedAt) {
      order.customsClearedAt = new Date();
    }
  }

  // Sync legacy status fields for backward compatibility (but currentStatus is primary)
  if (status === 'delivered') {
    order.orderStatus = 'delievered';
    order.FulfillmentStatus = 'delievered';
    order.status = 'completed';
  } else if (status === 'cancelled') {
    order.orderStatus = 'cancelled';
    order.FulfillmentStatus = 'cancelled';
    order.status = 'cancelled';
  } else if (status === 'refunded') {
    order.status = 'cancelled';
    order.orderStatus = 'cancelled';
    order.FulfillmentStatus = 'cancelled';
  } else if (status === 'out_for_delivery') {
    order.orderStatus = 'shipped';
    order.FulfillmentStatus = 'shipped';
    order.status = 'processing';
  } else if (status === 'confirmed' || status === 'payment_completed') {
    // Confirmed status means payment is complete - set status to confirmed
    order.status = 'confirmed';
    order.paymentStatus = 'completed';
    order.orderStatus = 'confirmed';
    order.FulfillmentStatus = 'confirmed';
  } else if (status === 'processing' || status === 'preparing' || status === 'ready_for_dispatch') {
    order.status = 'processing';
  }

  await order.save();

  // Send push notification to buyer for important status changes
  try {
    const pushNotificationService = require('../../services/pushNotificationService');
    const orderPopulated = await Order.findById(orderId).populate('user', 'id').lean();
    
    if (orderPopulated?.user?.id && ['out_for_delivery', 'delivered'].includes(status)) {
      let title, body;
      
      if (status === 'out_for_delivery') {
        title = 'Order Out for Delivery';
        body = `Your order #${order.orderNumber} is out for delivery and will arrive soon!`;
      } else if (status === 'delivered') {
        title = 'Order Delivered';
        body = `Your order #${order.orderNumber} has been delivered. Thank you for shopping with us!`;
      }
      
      await pushNotificationService.sendOrderNotification(
        orderPopulated.user.id,
        orderId,
        title,
        body,
        status
      );
      console.log(`[updateOrderStatus] ✅ Push notification sent for order ${orderId} status: ${status}`);
    }
  } catch (pushError) {
    console.error('[updateOrderStatus] Error sending push notification:', pushError.message);
    // Don't fail the order update if push notification fails
  }

  // Create notifications for order status change
  try {
    const notificationService = require('../../services/notification/notificationService');
    
    // Notify buyer
    await notificationService.createOrderNotification(
      order.user,
      order._id,
      order.orderNumber,
      status
    );

    // Notify sellers if order is confirmed or delivered
    if (status === 'confirmed' || status === 'delivered') {
      const SellerOrder = require('../../models/order/sellerOrderModel');
      const sellerOrders = await SellerOrder.find({ order: order._id }).populate('seller');
      
      for (const sellerOrder of sellerOrders) {
        if (sellerOrder.seller && sellerOrder.seller._id) {
          await notificationService.createSellerOrderNotification(
            sellerOrder.seller._id,
            order._id,
            order.orderNumber,
            status
          );
        }
      }
    }

    // Create delivery notification if status is out_for_delivery or delivered
    if (status === 'out_for_delivery' || status === 'delivered') {
      await notificationService.createDeliveryNotification(
        order.user,
        order._id,
        order.trackingNumber || order.orderNumber,
        status
      );
    }
  } catch (notificationError) {
    // Don't fail the order update if notification creation fails
    logger.error('[updateOrderStatus] Error creating notifications:', notificationError);
  }

  // Send email notifications for order status changes (buyer + seller)
  try {
    const emailDispatcher = require('../../emails/emailDispatcher');
    const User = require('../../models/user/userModel');
    const SellerOrder = require('../../models/order/sellerOrderModel');
    
    // Populate buyer for email
    const buyer = await User.findById(order.user).select('name email').lean();
    
    if (buyer && buyer.email) {
      // Buyer: shipped email
      if (status === 'out_for_delivery') {
        await emailDispatcher.sendOrderShipped(order, buyer);
        logger.info('[updateOrderStatus] ✅ Order shipped email sent to buyer %s', buyer.email);
      }
      
      // Buyer: delivered email
      if (status === 'delivered') {
        await emailDispatcher.sendOrderDelivered(order, buyer);
        logger.info('[updateOrderStatus] ✅ Order delivered email sent to buyer %s', buyer.email);
      }
    }

    // Sellers: status update email (for key milestones)
    if (['out_for_delivery', 'delivered', 'cancelled', 'refunded', 'confirmed'].includes(status)) {
      const sellerOrders = await SellerOrder.find({ order: order._id })
        .populate('seller', 'email name shopName')
        .lean();

      for (const so of sellerOrders) {
        const seller = so.seller;
        if (seller && seller.email) {
          await emailDispatcher.sendSellerOrderStatusUpdate(seller, order, status);
          logger.info(
            '[updateOrderStatus] ✅ Seller order status email sent to %s for order %s (status=%s)',
            seller.email,
            order.orderNumber || order._id,
            status
          );
        }
      }
    }
  } catch (emailError) {
    logger.error('[updateOrderStatus] Error sending order status emails:', emailError.message || emailError);
    // Don't fail the order update if email fails
  }

  // Sync SellerOrder status with Order status
  try {
    const syncResult = await syncSellerOrderStatus(orderId, status);
    logger.info('[updateOrderStatus] SellerOrder sync result:', syncResult);
  } catch (error) {
    logger.error('[updateOrderStatus] Error syncing SellerOrder status:', error);
    // Don't fail the order update if SellerOrder sync fails
  }

  // CRITICAL: Credit sellers ONLY when order status becomes "delivered"
  // This is the ONLY place where sellers should be credited
  if (status === 'delivered' && !wasCompleted) {
    try {
      const balanceUpdateResult = await orderService.creditSellerForOrder(
        orderId,
        user.id
      );
      logger.info('[updateOrderStatus] Seller balance credit result:', balanceUpdateResult);
      if (!balanceUpdateResult.success) {
        logger.warn('[updateOrderStatus] Seller credit failed:', balanceUpdateResult.message);
      }
    } catch (error) {
      // Log error but don't fail the status update
      logger.error('[updateOrderStatus] Error crediting seller balances:', error);
    }
  }

  // If order is being refunded, revert seller balances and refund buyer wallet
  if (status === 'refunded' && wasCompleted) {
    try {
      // Revert seller balances
      const reversalResult = await orderService.revertSellerBalancesOnRefund(
        orderId,
        'Order Refunded'
      );
      logger.info('[updateOrderStatus] Seller balance reversal result:', reversalResult);

      // Refund buyer wallet if order was paid with wallet
      if (order.paymentMethod === 'credit_balance' && order.paymentStatus === 'paid') {
        try {
          const walletService = require('../../services/walletService');
          const refundAmount = order.totalPrice || 0;
          const reference = `REFUND-${order.orderNumber}-${Date.now()}`;

          if (refundAmount > 0) {
            const refundResult = await walletService.creditWallet(
              order.user,
              refundAmount,
              'CREDIT_REFUND',
              `Refund for Order #${order.orderNumber}`,
              reference,
              {
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                refundedBy: user.id,
                refundedByRole: user.role,
              },
              order._id
            );

            logger.info(`[updateOrderStatus] Wallet refund successful: GH₵${refundAmount} credited to user ${order.user}`);
          }
        } catch (walletError) {
          logger.error('[updateOrderStatus] Error refunding wallet:', walletError);
          // Don't fail the order update if wallet refund fails
        }
      }
    } catch (error) {
      // Log error but don't fail the status update
      logger.error('[updateOrderStatus] Error reverting seller balances:', error);
    }
  }

  // Log activity
  const role = user.role === 'admin' ? 'admin' : 'seller';
  logActivityAsync({
    userId: user.id,
    role,
    action: 'UPDATE_ORDER_STATUS',
    description: `${role === 'admin' ? 'Admin' : 'Seller'} updated order #${order.orderNumber} status to ${status}`,
    req,
    metadata: {
      orderId: order._id,
      orderNumber: order.orderNumber,
      oldStatus: wasCompleted ? 'delivered' : order.currentStatus,
      newStatus: status,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Order status updated successfully',
    data: {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        currentStatus: order.currentStatus,
        trackingHistory: order.trackingHistory,
      },
    },
  });
});

/**
 * Update driver location
 * PATCH /api/v1/orders/:orderId/driver-location
 * Called by driver app every 10-20 seconds
 */
exports.updateDriverLocation = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  // Validate coordinates
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return next(new AppError('Invalid coordinates', 400));
  }

  const order = await Order.findById(orderId);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Update driver location
  order.driverLocation = {
    lat,
    lng,
    lastUpdated: new Date(),
  };

  await order.save();

  res.status(200).json({
    status: 'success',
    message: 'Driver location updated',
    data: {
      driverLocation: order.driverLocation,
    },
  });
});

/**
 * Get order tracking information
 * GET /api/v1/orders/:orderId/tracking
 * User can access only their own order tracking
 */
exports.getOrderTracking = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const user = req.user;

  const order = await Order.findById(orderId)
    .populate('user', 'name email')
    .populate('trackingHistory.updatedBy', 'name email')
    .lean();

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Check authorization: user can only access their own orders
  // Admin and seller can access any order
  const isAdmin = user.role === 'admin';
  const isSeller = user.role === 'seller';
  const isOwner = order.user._id.toString() === user.id;

  if (!isAdmin && !isSeller && !isOwner) {
    return next(new AppError('You are not authorized to view this order tracking', 403));
  }

  // Sort tracking history by timestamp (oldest first)
  const sortedHistory = [...(order.trackingHistory || [])].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  res.status(200).json({
    status: 'success',
    data: {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        trackingNumber: order.trackingNumber,
        orderType: order.orderType || 'normal',
        currentStatus: order.currentStatus || 'pending_payment',
        trackingHistory: sortedHistory,
        driverLocation: order.driverLocation || null,
        supplierCountry: order.supplierCountry || null,
        supplierName: order.supplierName || null,
        internationalTrackingNumber: order.internationalTrackingNumber || null,
        estimatedArrivalDate: order.estimatedArrivalDate || null,
        customsClearedAt: order.customsClearedAt || null,
        user: {
          name: order.user?.name,
          email: order.user?.email,
        },
      },
    },
  });
});

/**
 * Get order by tracking number (public endpoint)
 * GET /api/v1/orders/track/:trackingNumber
 */
exports.getOrderByTrackingNumber = catchAsync(async (req, res, next) => {
  const { trackingNumber } = req.params;

  if (!trackingNumber) {
    return next(new AppError('Tracking number is required', 400));
  }

  const order = await Order.findOne({ trackingNumber })
    .populate('user', 'name email')
    .populate('orderItems', 'quantity price')
    .populate({
      path: 'orderItems',
      populate: {
        path: 'product',
        // Include isPreOrder so tracking page can show
        // "Pre-Order" even if orderType is missing/legacy
        select: 'name imageCover isPreOrder preOrderAvailableDate preOrderNote',
      },
    })
    .populate('trackingHistory.updatedBy', 'name email')
    .populate({
      path: 'pickupCenterId',
      select: 'pickupName address city area openingHours googleMapLink instructions',
    })
    .lean();

  if (!order) {
    return next(new AppError('Order not found with this tracking number', 404));
  }

  // Handle shippingAddress - check if it's a reference (ObjectId string) or embedded object
  let shippingAddress = order.shippingAddress;
  
  // Check if shippingAddress is an ObjectId (string or ObjectId instance) rather than an embedded object
  if (shippingAddress && (typeof shippingAddress === 'string' || mongoose.Types.ObjectId.isValid(shippingAddress))) {
    // If it's a string/ObjectId (reference to Address model), populate from Address model
    try {
      const Address = require('../../models/user/addressModel');
      const addressId = typeof shippingAddress === 'string' ? shippingAddress : shippingAddress.toString();
      const address = await Address.findById(addressId).lean();
      if (address) {
        shippingAddress = address;
      } else {
        logger.warn('[getOrderByTrackingNumber] Address not found for ID:', addressId);
        shippingAddress = null; // Set to null if address not found
      }
    } catch (error) {
      logger.error('[getOrderByTrackingNumber] Error populating address:', error);
      // Keep the ID if population fails, but log the issue
      shippingAddress = typeof shippingAddress === 'string' ? shippingAddress : shippingAddress.toString();
    }
  }

  // Auto-fix tracking history: Ensure confirmed entry exists for paid orders
  if (order.paymentStatus === 'completed' && order.paidAt) {
    const hasConfirmed = (order.trackingHistory || []).some(
      entry => entry.status === 'confirmed'
    );
    
    if (!hasConfirmed) {
      // Insert confirmed entry after order_placed (pending_payment)
      order.trackingHistory = order.trackingHistory || [];
      
      // Find the index of the first entry (should be pending_payment/order_placed)
      const firstEntryIndex = order.trackingHistory.findIndex(
        entry => entry.status === 'pending_payment'
      );
      
      if (firstEntryIndex !== -1) {
        // Insert confirmed right after pending_payment
        order.trackingHistory.splice(firstEntryIndex + 1, 0, {
          status: 'confirmed',
          message: 'Your order has been confirmed and payment received.',
          location: '',
          updatedBy: order.user,
          updatedByModel: 'User',
          timestamp: order.paidAt,
        });
      } else {
        // If no pending_payment found, add confirmed at the beginning
        order.trackingHistory.unshift({
          status: 'confirmed',
          message: 'Your order has been confirmed and payment received.',
          location: '',
          updatedBy: order.user,
          updatedByModel: 'User',
          timestamp: order.paidAt,
        });
      }
    }
  }

  // Sort tracking history by timestamp (oldest first)
  const sortedHistory = [...(order.trackingHistory || [])].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  // Get latest update
  const latestUpdate = sortedHistory.length > 0 
    ? sortedHistory[sortedHistory.length - 1]
    : null;

  res.status(200).json({
    status: 'success',
    data: {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        trackingNumber: order.trackingNumber,
        orderType: order.orderType || 'normal',
        currentStatus: order.currentStatus || 'pending_payment',
        trackingHistory: sortedHistory,
        latestUpdateTimestamp: latestUpdate?.timestamp || order.createdAt,
        shippingAddress: shippingAddress,
        orderItems: order.orderItems,
        totalPrice: order.totalPrice,
        subtotal: order.subtotal || 0,
        tax: order.tax || 0,
        shippingCost: order.shippingCost || 0,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paidAt: order.paidAt,
        deliveryMethod: order.deliveryMethod,
        deliveryEstimate: order.deliveryEstimate,
        createdAt: order.createdAt,
        deliveryZone: order.deliveryZone,
        pickupCenter: order.pickupCenterId || null,
        supplierCountry: order.supplierCountry || null,
        supplierName: order.supplierName || null,
        internationalTrackingNumber: order.internationalTrackingNumber || null,
        estimatedArrivalDate: order.estimatedArrivalDate || null,
        customsClearedAt: order.customsClearedAt || null,
        user: {
          name: order.user?.name,
          email: order.user?.email,
        },
      },
    },
  });
});

/**
 * Add tracking update to order
 * POST /api/v1/orders/:id/tracking
 * Admin and seller can add tracking updates
 */
exports.addTrackingUpdate = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { status, message } = req.body;
  const user = req.user;

  // Validate input
  if (!status || !message) {
    return next(new AppError('Status and message are required', 400));
  }

  // Validate status
  const validStatuses = [
    'pending_payment',
    'payment_completed',
    'processing',
    'confirmed',
    'preparing',
    'ready_for_dispatch',
    // International pre-order specific statuses
    'supplier_confirmed',
    'awaiting_dispatch',
    'international_shipped',
    'customs_clearance',
    'arrived_destination',
    'local_dispatch',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'refunded',
  ];

  if (!validStatuses.includes(status)) {
    return next(new AppError('Invalid status', 400));
  }

  // Check authorization: admin (admin, superadmin, moderator) or seller
  const isAdmin = ['admin', 'superadmin', 'moderator'].includes(user.role);
  const isSeller = user.role === 'seller';

  if (!isAdmin && !isSeller) {
    return next(new AppError('You are not authorized to add tracking updates', 403));
  }

  // Find order
  const order = await Order.findById(id);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // If seller, verify they have items in this order
  if (isSeller && !isAdmin) {
    const SellerOrder = require('../../models/order/sellerOrderModel');
    const sellerOrders = await Order.findById(id)
      .populate({
        path: 'sellerOrder',
        populate: { path: 'seller' },
      })
      .lean();

    const hasItems = sellerOrders.sellerOrder?.some(
      (so) => so.seller?._id?.toString() === user.id
    );

    if (!hasItems) {
      return next(
        new AppError('You can only add tracking updates for orders containing your products', 403)
      );
    }
  }

  // Determine updatedByModel
  let updatedByModel = 'Admin';
  if (user.role === 'seller') {
    updatedByModel = 'Seller';
  }

  // Ensure updatedBy is ObjectId (schema expects ObjectId; user may be Admin/Seller doc)
  const updatedById = user._id || (mongoose.Types.ObjectId.isValid(user.id) ? new mongoose.Types.ObjectId(user.id) : user.id);

  // Enforce safe status flow & order-type specific rules
  const transitionCheck = validateStatusTransition(order, status, user.role);
  if (!transitionCheck.allowed) {
    return next(new AppError(transitionCheck.reason || 'Invalid status transition', 400));
  }

  const isInternational = order.orderType === 'preorder_international';
  const isAdminLike = isAdmin;

  if (
    isInternational &&
    isSeller &&
    !isAdminLike &&
    ['customs_clearance', 'arrived_destination', 'delivered'].includes(status)
  ) {
    return next(
      new AppError('Only admin can update customs, arrival, or delivered status for international pre-orders', 403),
    );
  }

  // Add to tracking history
  const trackingEntry = {
    status,
    message: message.trim(),
    location: '',
    updatedBy: updatedById,
    updatedByModel,
    updatedByRole: mapRoleToUpdatedByRole(user.role),
    timestamp: new Date(),
  };

  // Store previous status to check if we're transitioning to completed
  const previousStatus = order.currentStatus;
  const wasCompleted = order.currentStatus === 'delivered' || order.status === 'completed';

  // Update order - currentStatus is the single source of truth
  order.currentStatus = status;
  if (!Array.isArray(order.trackingHistory)) {
    order.trackingHistory = [];
  }
  order.trackingHistory.push(trackingEntry);

  // Attach international pre-order metadata when relevant
  if (isInternational) {
    if (status === 'supplier_confirmed') {
      if (req.body.supplierCountry) order.supplierCountry = req.body.supplierCountry;
      if (req.body.supplierName) order.supplierName = req.body.supplierName;
      if (req.body.estimatedArrivalDate) {
        order.estimatedArrivalDate = new Date(req.body.estimatedArrivalDate);
      }
    }

    if (status === 'awaiting_dispatch' || status === 'international_shipped') {
      if (req.body.internationalTrackingNumber) {
        order.internationalTrackingNumber = req.body.internationalTrackingNumber;
      }
    }

    if (status === 'customs_clearance' && !order.customsClearedAt) {
      order.customsClearedAt = new Date();
    }
  }

  // Sync legacy status fields for backward compatibility (but currentStatus is primary)
  if (status === 'delivered') {
    order.orderStatus = 'delievered';
    order.FulfillmentStatus = 'delievered';
    order.status = 'completed';
  } else if (status === 'cancelled') {
    order.orderStatus = 'cancelled';
    order.FulfillmentStatus = 'cancelled';
    order.status = 'cancelled';
  } else if (status === 'refunded') {
    order.status = 'cancelled';
    order.orderStatus = 'cancelled';
    order.FulfillmentStatus = 'cancelled';
  } else if (status === 'out_for_delivery') {
    order.orderStatus = 'shipped';
    order.FulfillmentStatus = 'shipped';
    order.status = 'processing';
  } else if (status === 'confirmed' || status === 'payment_completed') {
    // Confirmed status means payment is complete - set status to confirmed
    order.status = 'confirmed';
    order.paymentStatus = 'completed';
    order.orderStatus = 'confirmed';
    order.FulfillmentStatus = 'confirmed';
  } else if (status === 'processing' || status === 'preparing' || status === 'ready_for_dispatch') {
    order.status = 'processing';
  }

  await order.save();

  // Sync SellerOrder status with Order status
  try {
    const syncResult = await syncSellerOrderStatus(id, status);
    logger.info('[addTrackingUpdate] SellerOrder sync result:', syncResult);
  } catch (error) {
    logger.error('[addTrackingUpdate] Error syncing SellerOrder status:', error);
    // Don't fail the order update if SellerOrder sync fails
  }

  // CRITICAL: Credit sellers ONLY when order status becomes "delivered"
  // This is the ONLY place where sellers should be credited
  if (status === 'delivered' && !wasCompleted) {
    try {
      const balanceUpdateResult = await orderService.creditSellerForOrder(
        id,
        user.id
      );
      logger.info('[addTrackingUpdate] Seller balance credit result:', balanceUpdateResult);
      if (!balanceUpdateResult.success) {
        logger.warn('[addTrackingUpdate] Seller credit failed:', balanceUpdateResult.message);
      }
    } catch (error) {
      // Log error but don't fail the status update
      logger.error('[addTrackingUpdate] Error crediting seller balances:', error);
    }
  }

  // If order is being refunded, revert seller balances and refund buyer wallet
  if (status === 'refunded' && wasCompleted) {
    try {
      // Revert seller balances
      const reversalResult = await orderService.revertSellerBalancesOnRefund(
        id,
        'Order Refunded'
      );
      logger.info('[addTrackingUpdate] Seller balance reversal result:', reversalResult);

      // Refund buyer wallet if order was paid with wallet
      if (order.paymentMethod === 'credit_balance' && (order.paymentStatus === 'paid' || order.paymentStatus === 'completed')) {
        try {
          const walletService = require('../../services/walletService');
          const refundAmount = order.totalPrice || 0;
          const reference = `REFUND-${order.orderNumber}-${Date.now()}`;

          if (refundAmount > 0) {
            const refundResult = await walletService.creditWallet(
              order.user,
              refundAmount,
              'CREDIT_REFUND',
              `Refund for Order #${order.orderNumber}`,
              reference,
              {
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                refundedBy: user.id,
                refundedByRole: user.role,
              },
              order._id
            );

            logger.info(`[addTrackingUpdate] Wallet refund successful: GH₵${refundAmount} credited to user ${order.user}`);
          }
        } catch (walletError) {
          logger.error('[addTrackingUpdate] Error refunding wallet:', walletError);
          // Don't fail the order update if wallet refund fails
        }
      }
    } catch (error) {
      // Log error but don't fail the status update
      logger.error('[addTrackingUpdate] Error reverting seller balances:', error);
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Tracking update added successfully',
    data: {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        trackingNumber: order.trackingNumber,
        currentStatus: order.currentStatus,
        trackingHistory: order.trackingHistory,
      },
    },
  });
});
