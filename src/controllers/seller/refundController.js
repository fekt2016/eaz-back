const RefundRequest = require('../../models/refund/refundRequestModel');
const Order = require('../../models/order/orderModel');
const OrderItems = require('../../models/order/OrderItemModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const mongoose = require('mongoose');

/**
 * GET /api/v1/seller/refunds
 * Get all refund requests for seller's items
 */
exports.getSellerRefunds = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const {
    status,
    page = 1,
    limit = 10,
    search = '',
    startDate = '',
    endDate = '',
  } = req.query;

  // Build query - only refund requests that have items belonging to this seller
  // Use $elemMatch to find refund requests where at least one item belongs to this seller
  const query = {
    'items.sellerId': new mongoose.Types.ObjectId(sellerId),
  };

  // Status filter
  if (status && status !== 'all') {
    // For seller, we care about item-level statuses
    // We'll filter in the application layer since we need to check seller's items specifically
  }

  // Date range filter
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Search filter
  if (search) {
    query['order.orderNumber'] = { $regex: search, $options: 'i' };
  }

  // Execute query with pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Fetch RefundRequests that have items for this seller
  // Note: We fetch all matching refunds, then filter by seller's items in application layer
  const allRefundRequests = await RefundRequest.find(query)
    .populate('order', 'orderNumber totalPrice paymentStatus currentStatus createdAt')
    .populate('buyer', 'name email phone')
    .populate('items.orderItemId', 'product price quantity')
    .populate('items.productId', 'name imageCover')
    .populate('items.sellerId', 'shopName email')
    .sort({ createdAt: -1 })
    .lean();

  // Filter to only show items belonging to this seller and apply status filter
  let filteredRefunds = allRefundRequests.map(rr => {
    let sellerItems = rr.items.filter(item => 
      item.sellerId && (
        (item.sellerId._id && item.sellerId._id.toString() === sellerId.toString()) ||
        (item.sellerId.toString && item.sellerId.toString() === sellerId.toString())
      )
    );

    // Apply status filter if specified
    if (status && status !== 'all') {
      sellerItems = sellerItems.filter(item => item.status === status);
    }
    
    return {
      ...rr,
      items: sellerItems,
      totalRefundAmount: sellerItems.reduce((sum, item) => sum + (item.refundAmount || 0), 0),
    };
  }).filter(rr => rr.items.length > 0); // Only include refunds that have items for this seller

  // Apply pagination after filtering
  const total = filteredRefunds.length;
  const paginatedRefunds = filteredRefunds.slice(skip, skip + parseInt(limit));

  res.status(200).json({
    status: 'success',
    results: paginatedRefunds.length,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      total,
      limit: parseInt(limit),
    },
    data: {
      refunds: paginatedRefunds,
    },
  });
});

/**
 * GET /api/v1/seller/refunds/:refundId
 * Get a single refund request by ID (only if it contains seller's items)
 */
exports.getSellerRefundById = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const sellerId = req.user.id;

  const refundRequest = await RefundRequest.findById(refundId)
    .populate('order')
    .populate('buyer', 'name email phone')
    .populate('items.orderItemId')
    .populate('items.productId', 'name imageCover price description')
    .lean();

  if (!refundRequest) {
    return next(new AppError('Refund request not found', 404));
  }

  // Filter to only show items belonging to this seller
  const sellerItems = refundRequest.items.filter(item => 
    item.sellerId && item.sellerId.toString() === sellerId.toString()
  );

  if (sellerItems.length === 0) {
    return next(new AppError('This refund request does not contain any items from your shop', 403));
  }

  // Get full order details
  const order = await Order.findById(refundRequest.order._id || refundRequest.order)
    .populate('orderItems')
    .populate('user', 'name email phone')
    .lean();

  // Populate order items with product details
  if (order && order.orderItems) {
    await OrderItems.populate(order.orderItems, { path: 'product', select: 'name imageCover price description' });
  }

  res.status(200).json({
    status: 'success',
    data: {
      refund: {
        ...refundRequest,
        items: sellerItems, // Only seller's items
        order: order,
      },
    },
  });
});

/**
 * POST /api/v1/seller/refunds/:refundId/approve-return
 * Seller approves the return (not the refund amount - that's admin's decision)
 */
exports.approveReturn = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const { notes } = req.body;
  const sellerId = req.user.id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const refundRequest = await RefundRequest.findById(refundId).session(session);

    if (!refundRequest) {
      await session.abortTransaction();
      return next(new AppError('Refund request not found', 404));
    }

    // Check if seller has items in this refund request
    const sellerItems = refundRequest.items.filter(item => 
      item.sellerId && item.sellerId.toString() === sellerId.toString()
    );

    if (sellerItems.length === 0) {
      await session.abortTransaction();
      return next(new AppError('This refund request does not contain any items from your shop', 403));
    }

    // Check if already reviewed
    if (refundRequest.sellerReviewed && refundRequest.sellerDecision) {
      await session.abortTransaction();
      return next(new AppError('You have already reviewed this refund request', 400));
    }

    const order = await Order.findById(refundRequest.order).session(session);
    if (!order) {
      await session.abortTransaction();
      return next(new AppError('Order not found', 404));
    }

    // Update RefundRequest
    refundRequest.sellerReviewed = true;
    refundRequest.sellerReviewDate = new Date();
    refundRequest.sellerDecision = 'approve_return';
    refundRequest.sellerNote = notes || '';
    
    // Update item statuses for seller's items
    for (const item of sellerItems) {
      item.status = 'seller_review';
      
      // Update order item
      const orderItem = await OrderItems.findById(item.orderItemId).session(session);
      if (orderItem) {
        orderItem.refundStatus = 'seller_review';
        orderItem.refundSellerNote = notes || '';
        await orderItem.save({ session });
      }
    }

    // Update overall status
    if (refundRequest.status === 'pending') {
      refundRequest.status = 'seller_review';
    }

    await refundRequest.save({ session });

    // Add tracking entry to order
    order.trackingHistory = order.trackingHistory || [];
    order.trackingHistory.push({
      status: 'refunded',
      message: `Seller approved return request for ${sellerItems.length} item(s). Awaiting admin review.`,
      location: '',
      updatedBy: sellerId,
      updatedByModel: 'Seller',
      timestamp: new Date(),
    });
    await order.save({ session });

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId: sellerId,
      role: 'seller',
      action: 'REFUND_RETURN_APPROVED',
      description: `Approved return request for ${sellerItems.length} item(s) in refund request ${refundId}`,
      req,
      metadata: {
        refundRequestId: refundRequest._id,
        orderId: order._id,
        orderNumber: order.orderNumber,
        itemCount: sellerItems.length,
      },
    });

    // Notify all admins about seller's return approval decision
    try {
      const notificationService = require('../../services/notification/notificationService');
      const seller = await Seller.findById(sellerId).select('shopName name');
      await notificationService.createSellerReturnDecisionNotification(
        refundRequest._id,
        order._id,
        order.orderNumber,
        seller?.shopName || seller?.name || 'Seller',
        'approve',
        sellerItems.length,
        notes || ''
      );
      logger.info(`[Seller Return Approval] Admin notification created for refund ${refundRequest._id}`);
    } catch (notificationError) {
      logger.error('[Seller Return Approval] Error creating admin notification:', notificationError);
      // Don't fail the operation if notification fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Return request approved. Awaiting admin review for refund processing.',
      data: {
        refund: refundRequest,
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
 * POST /api/v1/seller/refunds/:refundId/reject-return
 * Seller rejects the return request
 */
exports.rejectReturn = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const { reason, notes } = req.body;
  const sellerId = req.user.id;

  if (!reason && !notes) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const refundRequest = await RefundRequest.findById(refundId).session(session);

    if (!refundRequest) {
      await session.abortTransaction();
      return next(new AppError('Refund request not found', 404));
    }

    // Check if seller has items in this refund request
    const sellerItems = refundRequest.items.filter(item => 
      item.sellerId && item.sellerId.toString() === sellerId.toString()
    );

    if (sellerItems.length === 0) {
      await session.abortTransaction();
      return next(new AppError('This refund request does not contain any items from your shop', 403));
    }

    // Check if already reviewed
    if (refundRequest.sellerReviewed && refundRequest.sellerDecision) {
      await session.abortTransaction();
      return next(new AppError('You have already reviewed this refund request', 400));
    }

    const order = await Order.findById(refundRequest.order).session(session);
    if (!order) {
      await session.abortTransaction();
      return next(new AppError('Order not found', 404));
    }

    // Update RefundRequest
    refundRequest.sellerReviewed = true;
    refundRequest.sellerReviewDate = new Date();
    refundRequest.sellerDecision = 'reject_return';
    refundRequest.sellerNote = reason || notes || '';

    // Update item statuses for seller's items
    for (const item of sellerItems) {
      // Note: Seller rejection doesn't automatically reject the refund
      // Admin can still override, but we mark it for admin review
      item.status = 'seller_review';
      
      // Update order item
      const orderItem = await OrderItems.findById(item.orderItemId).session(session);
      if (orderItem) {
        orderItem.refundStatus = 'seller_review';
        orderItem.refundSellerNote = reason || notes || '';
        await orderItem.save({ session });
      }
    }

    // Update overall status
    if (refundRequest.status === 'pending') {
      refundRequest.status = 'seller_review';
    }

    await refundRequest.save({ session });

    // Add tracking entry to order
    order.trackingHistory = order.trackingHistory || [];
    order.trackingHistory.push({
      status: 'refunded',
      message: `Seller rejected return request for ${sellerItems.length} item(s). Reason: ${reason || notes}. Awaiting admin review.`,
      location: '',
      updatedBy: sellerId,
      updatedByModel: 'Seller',
      timestamp: new Date(),
    });
    await order.save({ session });

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId: sellerId,
      role: 'seller',
      action: 'REFUND_RETURN_REJECTED',
      description: `Rejected return request for ${sellerItems.length} item(s) in refund request ${refundId}`,
      req,
      metadata: {
        refundRequestId: refundRequest._id,
        orderId: order._id,
        orderNumber: order.orderNumber,
        itemCount: sellerItems.length,
        rejectionReason: reason || notes,
      },
    });

    // Notify all admins about seller's return rejection decision
    try {
      const notificationService = require('../../services/notification/notificationService');
const logger = require('../../utils/logger');
      const seller = await Seller.findById(sellerId).select('shopName name');
      await notificationService.createSellerReturnDecisionNotification(
        refundRequest._id,
        order._id,
        order.orderNumber,
        seller?.shopName || seller?.name || 'Seller',
        'reject',
        sellerItems.length,
        reason || notes || ''
      );
      logger.info(`[Seller Return Rejection] Admin notification created for refund ${refundRequest._id}`);
    } catch (notificationError) {
      logger.error('[Seller Return Rejection] Error creating admin notification:', notificationError);
      // Don't fail the operation if notification fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Return request rejected. Admin will review your decision.',
      data: {
        refund: refundRequest,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

