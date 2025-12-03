const Order = require('../../models/order/orderModel');
const OrderItems = require('../../models/order/OrderItemModel');
const RefundRequest = require('../../models/refund/refundRequestModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const walletService = require('../../services/walletService');
const orderService = require('../../services/order/orderService');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const mongoose = require('mongoose');

/**
 * GET /api/v1/admin/refunds
 * Get all refund requests with filters and pagination (supports both RefundRequest model and legacy Order-based refunds)
 */
exports.getAllRefunds = catchAsync(async (req, res, next) => {
  const {
    status,
    page = 1,
    limit = 10,
    search = '',
    startDate = '',
    endDate = '',
    buyerEmail = '',
    sellerName = '',
    orderId = '',
  } = req.query;

  // Build query for RefundRequest model
  const refundRequestQuery = {};

  // Status filter
  if (status && status !== 'all') {
    refundRequestQuery.status = status;
  }

  // Date range filter
  if (startDate || endDate) {
    refundRequestQuery.createdAt = {};
    if (startDate) refundRequestQuery.createdAt.$gte = new Date(startDate);
    if (endDate) refundRequestQuery.createdAt.$lte = new Date(endDate);
  }

  // Search filter (search in order number via populated order)
  const searchConditions = [];
  if (search) {
    searchConditions.push({ 'order.orderNumber': { $regex: search, $options: 'i' } });
  }

  // Buyer email filter
  if (buyerEmail) {
    searchConditions.push({ 'buyer.email': { $regex: buyerEmail, $options: 'i' } });
  }

  // Order ID filter
  if (orderId) {
    refundRequestQuery.order = orderId;
  }

  if (searchConditions.length > 0) {
    refundRequestQuery.$or = searchConditions;
  }

  // Execute query with pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Fetch RefundRequests (new item-level refunds)
  const refundRequests = await RefundRequest.find(refundRequestQuery)
    .populate('order', 'orderNumber totalPrice paymentStatus currentStatus createdAt')
    .populate('buyer', 'name email phone')
    .populate('items.orderItemId', 'product price quantity')
    .populate('items.productId', 'name imageCover')
    .populate('items.sellerId', 'shopName email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  const total = await RefundRequest.countDocuments(refundRequestQuery);

  // Format response to include both new and legacy structure
  const formattedRefunds = refundRequests.map(rr => ({
    _id: rr._id,
    order: rr.order,
    buyer: rr.buyer,
    totalRefundAmount: rr.totalRefundAmount,
    status: rr.status,
    items: rr.items,
    reason: rr.reason,
    reasonText: rr.reasonText,
    images: rr.images,
    createdAt: rr.createdAt,
    // Backward compatibility fields
    refundRequested: true,
    refundStatus: rr.status,
    refundAmount: rr.totalRefundAmount,
    refundRequestDate: rr.createdAt,
  }));

  res.status(200).json({
    status: 'success',
    results: formattedRefunds.length,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      total,
      limit: parseInt(limit),
    },
    data: {
      refunds: formattedRefunds,
    },
  });
});

/**
 * GET /api/v1/admin/refunds/:refundId
 * Get a single refund request by ID (supports both RefundRequest model and legacy Order-based)
 */
exports.getRefundById = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;

  // Try to find RefundRequest first (new item-level refunds)
  let refundRequest = await RefundRequest.findById(refundId)
    .populate('order')
    .populate('buyer', 'name email phone')
    .populate('items.orderItemId')
    .populate('items.productId', 'name imageCover price description')
    .populate('items.sellerId', 'shopName email name')
    .lean();

  if (refundRequest) {
    // Get full order details
    const order = await Order.findById(refundRequest.order._id || refundRequest.order)
      .populate('user', 'name email phone')
      .populate('orderItems')
      .populate('sellerOrder')
      .lean();

    // Populate order items with product details
    if (order && order.orderItems) {
      await OrderItems.populate(order.orderItems, { path: 'product', select: 'name imageCover price description' });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        refund: {
          ...refundRequest,
          order: order,
          // Backward compatibility
          refundRequested: true,
          refundStatus: refundRequest.status,
          refundAmount: refundRequest.totalRefundAmount,
        },
      },
    });
  }

  // Fallback to legacy Order-based refund (backward compatibility)
  const order = await Order.findById(refundId)
    .populate('user', 'name email phone')
    .populate('sellerOrder.seller', 'name email shopName')
    .populate('orderItems.product', 'name imageCover price description')
    .lean();

  if (!order) {
    return next(new AppError('Refund request not found', 404));
  }

  // Check if it's actually a refund request
  if (!order.refundRequested && !order.refundStatus && order.currentStatus !== 'refunded') {
    return next(new AppError('This order does not have a refund request', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      refund: order,
    },
  });
});

/**
 * POST /api/v1/admin/refunds/:refundId/approve
 * Approve a refund (supports both item-level and whole-order refunds)
 * Request body: { notes, requireReturn, finalRefundAmount (optional, for partial) }
 */
exports.approveRefund = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const { notes, requireReturn, finalRefundAmount } = req.body;
  const adminId = req.user.id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Try to find RefundRequest first (item-level refund)
    let refundRequest = await RefundRequest.findById(refundId).session(session);

    if (refundRequest) {
      // ITEM-LEVEL REFUND APPROVAL
      if (refundRequest.status === 'approved' || refundRequest.status === 'completed') {
        await session.abortTransaction();
        return next(new AppError('Refund already approved', 400));
      }

      if (refundRequest.status === 'rejected') {
        await session.abortTransaction();
        return next(new AppError('Refund was already rejected', 400));
      }

      const order = await Order.findById(refundRequest.order).session(session);
      if (!order) {
        await session.abortTransaction();
        return next(new AppError('Order not found', 404));
      }

      // Determine final refund amount
      const approvedAmount = finalRefundAmount || refundRequest.totalRefundAmount;
      if (approvedAmount > refundRequest.totalRefundAmount) {
        await session.abortTransaction();
        return next(new AppError('Approved amount cannot exceed requested amount', 400));
      }

      // Update RefundRequest
      refundRequest.status = approvedAmount < refundRequest.totalRefundAmount ? 'approved' : 'approved';
      refundRequest.finalRefundAmount = approvedAmount;
      refundRequest.adminReviewed = true;
      refundRequest.adminReviewDate = new Date();
      refundRequest.adminDecision = approvedAmount < refundRequest.totalRefundAmount ? 'approve_partial' : 'approve';
      refundRequest.adminNote = notes || '';
      refundRequest.requireReturn = requireReturn || false;
      refundRequest.processedAt = new Date();
      refundRequest.processedBy = adminId;
      refundRequest.processedByModel = 'Admin';

      // Update item-level refund statuses
      const refundItems = [];
      for (const item of refundRequest.items) {
        const orderItem = await OrderItems.findById(item.orderItemId).session(session);
        if (!orderItem) continue;

        // Calculate proportional refund amount for this item
        const itemProportion = item.refundAmount / refundRequest.totalRefundAmount;
        const itemApprovedAmount = approvedAmount * itemProportion;

        // Update order item
        orderItem.refundStatus = 'approved';
        orderItem.refundApprovedQty = item.quantity;
        orderItem.refundAmount = itemApprovedAmount;
        orderItem.refundApprovedAt = new Date();
        orderItem.refundProcessedBy = adminId;
        orderItem.refundProcessedByModel = 'Admin';
        orderItem.refundAdminNote = notes || '';
        await orderItem.save({ session });

        // Update item status in RefundRequest
        item.status = 'approved';
        refundItems.push({
          orderItemId: item.orderItemId,
          sellerId: item.sellerId,
          refundAmount: itemApprovedAmount,
          quantity: item.quantity,
        });
      }

      await refundRequest.save({ session });

      // Credit buyer wallet
      if (order.paymentStatus === 'paid' || order.paymentStatus === 'completed') {
        const reference = `REFUND-APPROVED-${order.orderNumber}-${refundRequest._id}-${Date.now()}`;
        await walletService.creditWallet(
          refundRequest.buyer,
          approvedAmount,
          'CREDIT_REFUND',
          `Refund approved for Order #${order.orderNumber}${refundRequest.items.length > 0 ? ` (${refundRequest.items.length} items)` : ''}`,
          reference,
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            refundRequestId: refundRequest._id.toString(),
            refundedBy: adminId,
            refundedByRole: 'admin',
            requireReturn,
            itemCount: refundRequest.items.length,
          },
          order._id
        );
      }

      // Revert seller balances for refunded items
      if (refundItems.length > 0) {
        await orderService.revertSellerBalancesForItems(
          order._id,
          refundItems,
          `Item refund approved for Order #${order.orderNumber}`
        );
      }

      // Update order-level status (for backward compatibility)
      // Only mark as refunded if all items are refunded
      const allItemsRefunded = refundRequest.items.every(item => item.status === 'approved');
      if (allItemsRefunded && refundRequest.items.length > 0) {
        order.refundStatus = 'approved';
        order.refundProcessedAt = new Date();
        order.refundProcessedBy = adminId;
        order.refundProcessedByModel = 'Admin';
      }

      // Add tracking entry
      order.trackingHistory = order.trackingHistory || [];
      order.trackingHistory.push({
        status: 'refunded',
        message: `Refund approved by admin. Amount: GH₵${approvedAmount.toFixed(2)}${refundRequest.items.length > 0 ? ` (${refundRequest.items.length} items)` : ''}${requireReturn ? '. Item return required.' : ''}`,
        location: '',
        updatedBy: adminId,
        updatedByModel: 'Admin',
        timestamp: new Date(),
      });
      await order.save({ session });

      await session.commitTransaction();

      // Log activity
      logActivityAsync({
        userId: adminId,
        role: 'admin',
        action: 'REFUND_APPROVED',
        description: `Approved refund of GH₵${approvedAmount.toFixed(2)} for order #${order.orderNumber}${refundRequest.items.length > 0 ? ` (${refundRequest.items.length} items)` : ''}`,
        req,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          refundRequestId: refundRequest._id,
          refundAmount: approvedAmount,
          itemCount: refundRequest.items.length,
          requireReturn,
        },
      });

      return res.status(200).json({
        status: 'success',
        message: 'Refund approved successfully',
        data: {
          refund: refundRequest,
          order: {
            _id: order._id,
            orderNumber: order.orderNumber,
            refundStatus: order.refundStatus,
          },
        },
      });
    }

    // FALLBACK: Legacy whole-order refund (backward compatibility)
    const order = await Order.findById(refundId).session(session);

    if (!order) {
      await session.abortTransaction();
      return next(new AppError('Order not found', 404));
    }

    if (order.refundStatus === 'approved' || order.refundStatus === 'completed') {
      await session.abortTransaction();
      return next(new AppError('Refund already approved', 400));
    }

    if (order.refundStatus === 'rejected') {
      await session.abortTransaction();
      return next(new AppError('Refund was already rejected', 400));
    }

    const refundAmount = finalRefundAmount || order.refundAmount || order.totalPrice || 0;

    // Update order status
    order.refundStatus = 'approved';
    order.refundAmount = refundAmount;
    order.refundProcessedAt = new Date();
    order.refundProcessedBy = adminId;
    order.refundProcessedByModel = 'Admin';
    if (notes) {
      order.adminNotes = notes;
    }

    // Add tracking entry
    order.trackingHistory = order.trackingHistory || [];
    order.trackingHistory.push({
      status: 'refunded',
      message: `Refund approved by admin. Amount: GH₵${refundAmount.toFixed(2)}${requireReturn ? '. Item return required.' : ''}`,
      location: '',
      updatedBy: adminId,
      updatedByModel: 'Admin',
      timestamp: new Date(),
    });

    await order.save({ session });

    // Credit buyer wallet if order was paid
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'completed') {
      const reference = `REFUND-APPROVED-${order.orderNumber}-${Date.now()}`;
      await walletService.creditWallet(
        order.user,
        refundAmount,
        'CREDIT_REFUND',
        `Refund approved for Order #${order.orderNumber}`,
        reference,
        {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          refundedBy: adminId,
          refundedByRole: 'admin',
          requireReturn,
        },
        order._id
      );

      // Mark refund as completed after wallet credit
      order.refundStatus = 'completed';
      await order.save({ session });

      // Revert seller balances (whole order)
      await orderService.revertSellerBalancesOnRefund(order._id, 'Order Refunded');
    }

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId: adminId,
      role: 'admin',
      action: 'REFUND_APPROVED',
      description: `Approved refund of GH₵${refundAmount.toFixed(2)} for order #${order.orderNumber}`,
      req,
      metadata: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        refundAmount,
        requireReturn,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Refund approved successfully',
      data: {
        refund: order,
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
 * POST /api/v1/admin/refunds/:refundId/approve-partial
 * Approve a partial refund (now handled by approveRefund with finalRefundAmount parameter)
 * This endpoint is kept for backward compatibility
 */
exports.approvePartialRefund = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const { amount, notes, requireReturn } = req.body;

  // Call approveRefund with finalRefundAmount
  req.body.finalRefundAmount = amount;
  return exports.approveRefund(req, res, next);
});

/**
 * POST /api/v1/admin/refunds/:refundId/reject
 * Reject a refund request (supports both item-level and whole-order refunds)
 */
exports.rejectRefund = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const { reason, notes } = req.body;
  const adminId = req.user.id;

  if (!reason && !notes) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Try to find RefundRequest first (item-level refund)
    let refundRequest = await RefundRequest.findById(refundId).session(session);

    if (refundRequest) {
      // ITEM-LEVEL REFUND REJECTION
      if (refundRequest.status === 'approved' || refundRequest.status === 'completed') {
        await session.abortTransaction();
        return next(new AppError('Cannot reject an already approved refund', 400));
      }

      if (refundRequest.status === 'rejected') {
        await session.abortTransaction();
        return next(new AppError('Refund already rejected', 400));
      }

      const order = await Order.findById(refundRequest.order).session(session);
      if (!order) {
        await session.abortTransaction();
        return next(new AppError('Order not found', 404));
      }

      // Update RefundRequest
      refundRequest.status = 'rejected';
      refundRequest.adminReviewed = true;
      refundRequest.adminReviewDate = new Date();
      refundRequest.adminDecision = 'reject';
      refundRequest.adminNote = reason || notes || '';
      refundRequest.processedAt = new Date();
      refundRequest.processedBy = adminId;
      refundRequest.processedByModel = 'Admin';
      await refundRequest.save({ session });

      // Update item-level refund statuses
      for (const item of refundRequest.items) {
        const orderItem = await OrderItems.findById(item.orderItemId).session(session);
        if (!orderItem) continue;

        orderItem.refundStatus = 'rejected';
        orderItem.refundAdminNote = reason || notes || '';
        orderItem.refundProcessedBy = adminId;
        orderItem.refundProcessedByModel = 'Admin';
        await orderItem.save({ session });

        // Update item status in RefundRequest
        item.status = 'rejected';
      }

      await refundRequest.save({ session });

      // Update order-level status (for backward compatibility)
      order.refundStatus = 'rejected';
      order.refundRejectionReason = reason || notes;
      order.refundProcessedAt = new Date();
      order.refundProcessedBy = adminId;
      order.refundProcessedByModel = 'Admin';
      if (notes) {
        order.adminNotes = notes;
      }

      // Add tracking entry
      order.trackingHistory = order.trackingHistory || [];
      order.trackingHistory.push({
        status: 'cancelled',
        message: `Refund request rejected by admin. Reason: ${reason || notes}${refundRequest.items.length > 0 ? ` (${refundRequest.items.length} items)` : ''}`,
        location: '',
        updatedBy: adminId,
        updatedByModel: 'Admin',
        timestamp: new Date(),
      });
      await order.save({ session });

      await session.commitTransaction();

      // Log activity
      logActivityAsync({
        userId: adminId,
        role: 'admin',
        action: 'REFUND_REJECTED',
        description: `Rejected refund request for order #${order.orderNumber}${refundRequest.items.length > 0 ? ` (${refundRequest.items.length} items)` : ''}`,
        req,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          refundRequestId: refundRequest._id,
          rejectionReason: reason || notes,
          itemCount: refundRequest.items.length,
        },
      });

      return res.status(200).json({
        status: 'success',
        message: 'Refund request rejected',
        data: {
          refund: refundRequest,
          order: {
            _id: order._id,
            orderNumber: order.orderNumber,
            refundStatus: order.refundStatus,
          },
        },
      });
    }

    // FALLBACK: Legacy whole-order refund rejection (backward compatibility)
    const order = await Order.findById(refundId).session(session);

    if (!order) {
      await session.abortTransaction();
      return next(new AppError('Order not found', 404));
    }

    if (order.refundStatus === 'approved' || order.refundStatus === 'completed') {
      await session.abortTransaction();
      return next(new AppError('Cannot reject an already approved refund', 400));
    }

    if (order.refundStatus === 'rejected') {
      await session.abortTransaction();
      return next(new AppError('Refund already rejected', 400));
    }

    // Update order status
    order.refundStatus = 'rejected';
    order.refundRejectionReason = reason || notes;
    order.refundProcessedAt = new Date();
    order.refundProcessedBy = adminId;
    order.refundProcessedByModel = 'Admin';
    if (notes) {
      order.adminNotes = notes;
    }

    // Add tracking entry
    order.trackingHistory = order.trackingHistory || [];
    order.trackingHistory.push({
      status: 'cancelled',
      message: `Refund request rejected by admin. Reason: ${reason || notes}`,
      location: '',
      updatedBy: adminId,
      updatedByModel: 'Admin',
      timestamp: new Date(),
    });

    await order.save({ session });

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId: adminId,
      role: 'admin',
      action: 'REFUND_REJECTED',
      description: `Rejected refund request for order #${order.orderNumber}`,
      req,
      metadata: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        rejectionReason: reason || notes,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Refund request rejected',
      data: {
        refund: order,
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
 * PATCH /api/v1/admin/refunds/:refundId
 * Update refund (add notes, etc.)
 */
exports.updateRefund = catchAsync(async (req, res, next) => {
  const { refundId } = req.params;
  const { adminNotes } = req.body;

  const order = await Order.findById(refundId);

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (adminNotes !== undefined) {
    order.adminNotes = adminNotes;
  }

  await order.save();

  res.status(200).json({
    status: 'success',
    message: 'Refund updated successfully',
    data: {
      refund: order,
    },
  });
});

