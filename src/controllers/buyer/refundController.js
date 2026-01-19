const Order = require('../../models/order/orderModel');
const OrderItems = require('../../models/order/OrderItemModel');
const RefundRequest = require('../../models/refund/refundRequestModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const mongoose = require('mongoose');

/**
 * POST /api/v1/orders/:orderId/request-refund
 * Buyer requests a refund for an order (supports both whole-order and item-level refunds)
 * 
 * Request body for item-level refund:
 * {
 *   items: [
 *     {
 *       orderItemId: "item_id",
 *       quantity: 1,
 *       reason: "defective_product",
 *       reasonText: "Product is broken",
 *       images: ["url1", "url2"]
 *     }
 *   ],
 *   reason: "defective_product", // Main reason (for backward compatibility)
 *   reasonText: "Main reason text",
 *   images: ["url1"] // Main images (for backward compatibility)
 * }
 * 
 * Request body for whole-order refund (backward compatible):
 * {
 *   reason: "defective_product",
 *   reasonText: "Reason text",
 *   amount: 100.00,
 *   images: ["url1"]
 * }
 */
exports.requestRefund = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { items, reason, reasonText, amount, images } = req.body;
  const userId = req.user.id;

  // Validate input
  if (!reason && (!items || items.length === 0)) {
    return next(new AppError('Refund reason is required', 400));
  }

  const validReasons = [
    'defective_product',
    'wrong_item',
    'not_as_described',
    'damaged_during_shipping',
    'late_delivery',
    'changed_mind',
    'duplicate_order',
    'other',
  ];

  // Find order with populated items
  const order = await Order.findById(orderId).populate('orderItems');

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify order belongs to user
  if (!order.user || order.user.toString() !== userId.toString()) {
    return next(new AppError('You are not authorized to request refund for this order', 403));
  }

  // Check if order is eligible for refund
  const isEligible = checkRefundEligibility(order);
  if (!isEligible.eligible) {
    return next(new AppError(isEligible.message, 400));
  }

  // Start transaction for item-level refunds
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let refundRequest;
    let totalRefundAmount = 0;
    const refundItems = [];

    // ITEM-LEVEL REFUND (new flow)
    if (items && items.length > 0) {
      // Validate each item
      for (const item of items) {
        if (!item.orderItemId || !item.quantity || !item.reason) {
          await session.abortTransaction();
          return next(new AppError('Each item must have orderItemId, quantity, and reason', 400));
        }

        if (!validReasons.includes(item.reason)) {
          await session.abortTransaction();
          return next(new AppError(`Invalid refund reason: ${item.reason}`, 400));
        }

        // Find order item
        const orderItem = await OrderItems.findById(item.orderItemId).session(session);
        if (!orderItem) {
          await session.abortTransaction();
          return next(new AppError(`Order item ${item.orderItemId} not found`, 404));
        }

        // Verify item belongs to order
        const itemInOrder = order.orderItems.some(
          oi => oi._id.toString() === item.orderItemId.toString()
        );
        if (!itemInOrder) {
          await session.abortTransaction();
          return next(new AppError(`Item ${item.orderItemId} does not belong to this order`, 400));
        }

        // Validate quantity
        if (item.quantity > orderItem.quantity) {
          await session.abortTransaction();
          return next(new AppError(`Requested quantity (${item.quantity}) exceeds purchased quantity (${orderItem.quantity})`, 400));
        }

        // Check if item already fully refunded
        const alreadyRefundedQty = orderItem.refundApprovedQty || 0;
        if (alreadyRefundedQty >= orderItem.quantity) {
          await session.abortTransaction();
          return next(new AppError(`Item ${item.orderItemId} has already been fully refunded`, 400));
        }

        // Check if item already has pending refund request
        if (orderItem.refundStatus === 'requested' || orderItem.refundStatus === 'seller_review' || orderItem.refundStatus === 'admin_review') {
          await session.abortTransaction();
          return next(new AppError(`Item ${item.orderItemId} already has a pending refund request`, 400));
        }

        // Get seller ID from order item (need to find which sellerOrder contains this item)
        const sellerOrder = await SellerOrder.findOne({
          order: orderId,
          items: item.orderItemId,
        }).session(session);

        if (!sellerOrder) {
          await session.abortTransaction();
          return next(new AppError(`Seller not found for item ${item.orderItemId}`, 404));
        }

        // Calculate refund amount (price * quantity)
        const itemRefundAmount = orderItem.price * item.quantity;
        totalRefundAmount += itemRefundAmount;

        // Update order item refund status
        orderItem.refundStatus = 'requested';
        orderItem.refundRequestedQty = item.quantity;
        orderItem.refundReason = item.reason;
        orderItem.refundReasonText = item.reasonText || '';
        orderItem.refundImages = item.images || [];
        orderItem.refundRequestedAt = new Date();
        orderItem.sellerId = sellerOrder.seller;
        await orderItem.save({ session });

        // Add to refund items array
        refundItems.push({
          orderItemId: orderItem._id,
          productId: orderItem.product,
          sellerId: sellerOrder.seller,
          quantity: item.quantity,
          price: orderItem.price,
          refundAmount: itemRefundAmount,
          reason: item.reason,
          reasonText: item.reasonText || '',
          images: item.images || [],
          status: 'requested',
        });
      }

      // Create RefundRequest document
      refundRequest = await RefundRequest.create([{
        order: orderId,
        buyer: userId,
        items: refundItems,
        totalRefundAmount,
        reason: reason || refundItems[0].reason, // Use main reason or first item's reason
        reasonText: reasonText || '',
        images: images || [],
        status: 'pending',
      }], { session });

      refundRequest = refundRequest[0];

      // Update order-level refund status (for backward compatibility)
      order.refundRequested = true;
      order.refundRequestDate = new Date();
      order.refundStatus = 'pending';
      await order.save({ session });

    } else {
      // WHOLE-ORDER REFUND (backward compatible flow)
      if (!validReasons.includes(reason)) {
        await session.abortTransaction();
        return next(new AppError('Invalid refund reason', 400));
      }

      // Check if refund already requested
      if (order.refundRequested && order.refundStatus === 'pending') {
        await session.abortTransaction();
        return next(new AppError('Refund request already submitted and is pending review', 400));
      }

      if (order.refundRequested && order.refundStatus === 'approved') {
        await session.abortTransaction();
        return next(new AppError('Refund request already approved and is being processed', 400));
      }

      const refundAmount = amount || order.totalPrice;
      totalRefundAmount = refundAmount;

      // Create RefundRequest for whole order (backward compatible)
      refundRequest = await RefundRequest.create([{
        order: orderId,
        buyer: userId,
        items: [], // Empty for whole-order refunds
        totalRefundAmount: refundAmount,
        reason,
        reasonText: reasonText || '',
        images: images || [],
        status: 'pending',
      }], { session });

      refundRequest = refundRequest[0];

      // Set refund request details on order (backward compatible)
      order.refundRequested = true;
      order.refundRequestDate = new Date();
      order.refundReason = reason;
      order.refundReasonText = reasonText || '';
      order.refundAmount = refundAmount;
      order.refundStatus = 'pending';
      await order.save({ session });
    }

    // Add tracking entry
    order.trackingHistory = order.trackingHistory || [];
    order.trackingHistory.push({
      status: 'refunded',
      message: items && items.length > 0 
        ? `Refund request submitted for ${items.length} item(s). Awaiting review.`
        : 'Refund request submitted. Awaiting admin review.',
      location: '',
      updatedBy: userId,
      updatedByModel: 'User',
      timestamp: new Date(),
    });
    await order.save({ session });

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId,
      role: 'buyer',
      action: 'REFUND_REQUEST',
      description: items && items.length > 0
        ? `Item-level refund requested for order #${order.orderNumber} (${items.length} items)`
        : `Refund requested for order #${order.orderNumber}`,
      req,
      metadata: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        refundRequestId: refundRequest._id,
        refundReason: reason,
        refundAmount: totalRefundAmount,
        itemCount: items ? items.length : 0,
        isItemLevel: !!(items && items.length > 0),
      },
    });

    // Notify all admins about refund request
    try {
      const notificationService = require('../../services/notification/notificationService');
      const user = await User.findById(userId).select('name email');
      await notificationService.createRefundRequestNotification(
        refundRequest._id,
        order._id,
        order.orderNumber,
        totalRefundAmount,
        user?.name || user?.email || 'Customer'
      );
      logger.info(`[Refund Request] Admin notification created for refund ${refundRequest._id}`);
    } catch (notificationError) {
      logger.error('[Refund Request] Error creating admin notification:', notificationError);
      // Don't fail refund request if notification fails
    }

    // Notify sellers about refund request
    try {
      const notificationService = require('../../services/notification/notificationService');
      const SellerOrder = require('../../models/order/sellerOrderModel');
const logger = require('../../utils/logger');
      const user = await User.findById(userId).select('name email');
      
      // Get unique seller IDs from refund items
      const sellerIds = new Set();
      if (items && items.length > 0) {
        for (const item of items) {
          const orderItem = await OrderItems.findById(item.orderItemId);
          if (orderItem) {
            // Find which seller this item belongs to
            const sellerOrder = await SellerOrder.findOne({
              order: orderId,
              items: item.orderItemId,
            }).populate('seller', '_id');
            
            if (sellerOrder && sellerOrder.seller && sellerOrder.seller._id) {
              sellerIds.add(sellerOrder.seller._id.toString());
            }
          }
        }
      } else {
        // For whole-order refund, get all sellers from the order
        const sellerOrders = await SellerOrder.find({ order: orderId }).populate('seller', '_id');
        sellerOrders.forEach(so => {
          if (so.seller && so.seller._id) {
            sellerIds.add(so.seller._id.toString());
          }
        });
      }

      // Notify each seller
      for (const sellerId of sellerIds) {
        try {
          await notificationService.createSellerRefundRequestNotification(
            sellerId,
            refundRequest._id,
            order._id,
            order.orderNumber,
            totalRefundAmount,
            user?.name || user?.email || 'Customer'
          );
          logger.info(`[Refund Request] Seller notification created for seller ${sellerId}`);
        } catch (sellerNotifError) {
          logger.error(`[Refund Request] Error creating notification for seller ${sellerId}:`, sellerNotifError);
        }
      }
    } catch (sellerNotificationError) {
      logger.error('[Refund Request] Error creating seller notifications:', sellerNotificationError);
      // Don't fail refund request if seller notification fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Refund request submitted successfully',
      data: {
        refundRequest: {
          _id: refundRequest._id,
          order: order._id,
          orderNumber: order.orderNumber,
          totalRefundAmount,
          status: refundRequest.status,
          items: refundRequest.items,
          createdAt: refundRequest.createdAt,
        },
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          refundRequested: order.refundRequested,
          refundStatus: order.refundStatus,
          refundRequestDate: order.refundRequestDate,
        },
      },
    });

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/v1/orders/:orderId/refund-status
 * Get refund status for an order (supports both whole-order and item-level refunds)
 */
exports.getRefundStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  const order = await Order.findById(orderId)
    .select('refundRequested refundStatus refundReason refundReasonText refundAmount refundRequestDate refundProcessedAt refundRejectionReason orderNumber totalPrice user orderItems')
    .populate('orderItems');

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  // Verify order belongs to user
  if (!order.user || order.user.toString() !== userId.toString()) {
    return next(new AppError('You are not authorized to view this order', 403));
  }

  // Find RefundRequest(s) for this order
  const refundRequests = await RefundRequest.find({ order: orderId })
    .sort({ createdAt: -1 })
    .populate('items.orderItemId', 'product price quantity')
    .populate('items.productId', 'name images')
    .populate('items.sellerId', 'shopName email');

  // Get item-level refund statuses
  const itemRefunds = [];
  if (order.orderItems && order.orderItems.length > 0) {
    for (const item of order.orderItems) {
      if (item.refundStatus && item.refundStatus !== 'none') {
        itemRefunds.push({
          orderItemId: item._id,
          productId: item.product,
          quantity: item.quantity,
          refundStatus: item.refundStatus,
          refundRequestedQty: item.refundRequestedQty || 0,
          refundApprovedQty: item.refundApprovedQty || 0,
          refundAmount: item.refundAmount || 0,
          refundReason: item.refundReason,
          refundReasonText: item.refundReasonText,
        });
      }
    }
  }

  // Calculate total refund amount (from refund requests or order-level)
  let totalRefundAmount = order.refundAmount || 0;
  if (refundRequests.length > 0) {
    totalRefundAmount = refundRequests.reduce((sum, rr) => sum + (rr.totalRefundAmount || 0), 0);
  }

  res.status(200).json({
    status: 'success',
    data: {
      refund: {
        requested: order.refundRequested || false,
        status: order.refundStatus || null,
        reason: order.refundReason || null,
        reasonText: order.refundReasonText || null,
        amount: totalRefundAmount, // Total from all refund requests
        requestDate: order.refundRequestDate || null,
        processedAt: order.refundProcessedAt || null,
        rejectionReason: order.refundRejectionReason || null,
        // Item-level refunds (new)
        itemRefunds: itemRefunds.length > 0 ? itemRefunds : null,
        refundRequests: refundRequests.length > 0 ? refundRequests.map(rr => ({
          _id: rr._id,
          status: rr.status,
          totalRefundAmount: rr.totalRefundAmount,
          items: rr.items,
          createdAt: rr.createdAt,
        })) : null,
      },
    },
  });
});

/**
 * Helper function to check if order is eligible for refund
 */
function checkRefundEligibility(order) {
  // Order must be paid
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'completed') {
    return {
      eligible: false,
      message: 'Order must be paid before requesting a refund',
    };
  }

  // Order cannot already be refunded
  if (order.paymentStatus === 'refunded' || order.currentStatus === 'refunded') {
    return {
      eligible: false,
      message: 'Order has already been refunded',
    };
  }

  // Order cannot be cancelled (cancelled orders are different from refunds)
  if (order.currentStatus === 'cancelled' || order.status === 'cancelled') {
    return {
      eligible: false,
      message: 'Cancelled orders cannot be refunded',
    };
  }

  // Order must be within refund window (e.g., 30 days from delivery or order date)
  const refundWindowDays = 30;
  const orderDate = order.deliveredAt || order.createdAt;
  const daysSinceOrder = (Date.now() - new Date(orderDate).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceOrder > refundWindowDays) {
    return {
      eligible: false,
      message: `Refund request must be submitted within ${refundWindowDays} days of delivery`,
    };
  }

  return { eligible: true };
}

