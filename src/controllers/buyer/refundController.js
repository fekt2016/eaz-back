const Order = require('../../models/order/orderModel');
const OrderItems = require('../../models/order/OrderItemModel');
const RefundRequest = require('../../models/refund/refundRequestModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Transaction = require('../../models/transaction/transactionModel');
const User = require('../../models/user/userModel');
const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');
const { sendCustomEmail, brandConfig } = require('../../utils/email/emailService');

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
      message:
        items && items.length > 0
          ? `Refund request submitted for ${items.length} item(s). Awaiting review.`
          : 'Refund request submitted. Awaiting admin review.',
      location: '',
      updatedBy: userId,
      updatedByModel: 'User',
      timestamp: new Date(),
    });
    await order.save({ session });

    // BUSINESS RULE:
    // When a buyer requests a refund/return, the seller's earnings for that order
    // should be moved into "locked" balance so they cannot be withdrawn until
    // the dispute is resolved.
    //
    // Implementation (first version):
    // - For each SellerOrder on this order, find the completed CREDIT transaction
    //   that credited the seller when the order was delivered.
    // - Lock that credited amount by:
    //   lockedBalance += creditedAmount
    //   withdrawableBalance = balance - lockedBalance - pendingBalance
    //
    // NOTE:
    // - This locks the FULL credited earnings for the seller order, even if the
    //   refund is only for some items. This is safer for now and matches the
    //   requirement that "the amount" is locked until the issue is resolved.
    try {
      const sellerOrdersForLock = await SellerOrder.find({ order: orderId }).session(session);

      for (const so of sellerOrdersForLock) {
        if (!so || !so.seller) continue;

        // Find the credit transaction for this seller order (seller payout)
        const creditTx = await Transaction.findOne({
          sellerOrder: so._id,
          type: 'credit',
          status: 'completed',
        }).session(session);

        if (!creditTx || !creditTx.amount || creditTx.amount <= 0) continue;

        const sellerDoc = await Seller.findById(so.seller).session(session);
        if (!sellerDoc) continue;

        const amountToLock = creditTx.amount;

        // Increase locked balance by credited amount
        sellerDoc.lockedBalance = (sellerDoc.lockedBalance || 0) + amountToLock;

        // Recalculate withdrawableBalance = balance - lockedBalance - pendingBalance
        const currentBalance = sellerDoc.balance || 0;
        const lockedBalance = sellerDoc.lockedBalance || 0;
        const pendingBalance = sellerDoc.pendingBalance || 0;
        sellerDoc.withdrawableBalance = Math.max(
          0,
          currentBalance - lockedBalance - pendingBalance,
        );

        await sellerDoc.save({ session });

        logger.info(
          `[Refund Request] Locked GH₵${amountToLock.toFixed(
            2,
          )} for seller ${sellerDoc._id} due to refund request on order ${order.orderNumber}`,
        );
      }
    } catch (lockError) {
      // Do NOT abort the refund if locking fails; log for diagnostics
      logger.error('[Refund Request] Error locking seller balances for refund:', lockError);
    }

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

    // Send email notifications instead of in-app notifications
    try {
      const user = await User.findById(userId).select('name email');
      const buyerName = user?.name || user?.email || 'Customer';

      // Admin email (use support email / configured from-address)
      const adminEmail = brandConfig.supportEmail || process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM;

      if (adminEmail) {
        await sendCustomEmail({
          email: adminEmail,
          subject: `New refund request for Order #${order.orderNumber}`,
          message: `${buyerName} requested a refund of GH₵${totalRefundAmount.toFixed(
            2,
          )} for order #${order.orderNumber}.`,
          html: `
            <h2>New Refund Request</h2>
            <p><strong>Order:</strong> ${order.orderNumber}</p>
            <p><strong>Buyer:</strong> ${buyerName}</p>
            <p><strong>Amount:</strong> GH₵${totalRefundAmount.toFixed(2)}</p>
            <p><strong>Refund ID:</strong> ${refundRequest._id}</p>
          `,
        });
      }

      // Collect seller IDs involved in this refund
      const sellerIds = new Set();
      if (items && items.length > 0) {
        for (const item of items) {
          const orderItem = await OrderItems.findById(item.orderItemId);
          if (orderItem) {
            const sellerOrder = await SellerOrder.findOne({
              order: orderId,
              items: item.orderItemId,
            }).populate('seller', '_id');

            if (sellerOrder?.seller?._id) {
              sellerIds.add(sellerOrder.seller._id.toString());
            }
          }
        }
      } else {
        const sellerOrders = await SellerOrder.find({ order: orderId }).populate('seller', '_id');
        sellerOrders.forEach((so) => {
          if (so.seller && so.seller._id) {
            sellerIds.add(so.seller._id.toString());
          }
        });
      }

      // Email each seller
      if (sellerIds.size > 0) {
        const sellers = await Seller.find({ _id: { $in: Array.from(sellerIds) } }).select(
          'name shopName email',
        );

        for (const seller of sellers) {
          if (!seller.email) continue;
          try {
            await sendCustomEmail({
              email: seller.email,
              subject: `Refund request for Order #${order.orderNumber}`,
              message: `A refund request of GH₵${totalRefundAmount.toFixed(
                2,
              )} has been submitted for an order containing your items.`,
              html: `
                <h2>Refund Request Submitted</h2>
                <p>Hello ${seller.shopName || seller.name || 'Seller'},</p>
                <p>A refund request has been submitted for order <strong>${order.orderNumber}</strong> that contains your items.</p>
                <p><strong>Buyer:</strong> ${buyerName}</p>
                <p><strong>Total refund amount (order level):</strong> GH₵${totalRefundAmount.toFixed(2)}</p>
                <p>Please review this refund in your seller dashboard.</p>
              `,
            });
          } catch (sellerEmailError) {
            logger.error(
              `[Refund Request] Error sending refund email to seller ${seller._id}:`,
              sellerEmailError,
            );
          }
        }
      }
    } catch (emailError) {
      logger.error('[Refund Request] Error sending refund emails:', emailError);
      // Do not fail the refund request if email sending fails
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
    try {
      // Only abort if the session still has an active transaction
      if (session && typeof session.inTransaction === 'function' && session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      // Swallow double-abort errors but log for diagnostics
      logger.error('[Refund Request] Error aborting transaction:', abortError);
    }
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

  // Verify order belongs to user (buyers only) - allow admins/superadmins to bypass
  const userRole = req.user && req.user.role;
  const isAdminLike = userRole === 'admin' || userRole === 'superadmin';
  if (!isAdminLike) {
    if (!order.user || order.user.toString() !== userId.toString()) {
      return next(new AppError('You are not authorized to view this order', 403));
    }
  }

  // Find RefundRequest(s) for this order
  const refundRequests = await RefundRequest.find({ order: orderId })
    .sort({ createdAt: -1 })
    .populate('items.orderItemId', 'product price quantity')
    .populate('items.productId', 'name imageCover images')
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
        // Expose full latest RefundRequest metadata (used by buyer refund detail page)
        refundRequests: refundRequests.length > 0 ? refundRequests.map(rr => ({
          _id: rr._id,
          status: rr.status,
          totalRefundAmount: rr.totalRefundAmount,
          items: rr.items,
          createdAt: rr.createdAt,
          sellerReviewed: rr.sellerReviewed,
          sellerDecision: rr.sellerDecision,
          sellerReviewDate: rr.sellerReviewDate,
          sellerNote: rr.sellerNote,
          adminReviewed: rr.adminReviewed,
          adminDecision: rr.adminDecision,
          adminReviewDate: rr.adminReviewDate,
          adminNote: rr.adminNote,
          requireReturn: rr.requireReturn,
          returnShippingMethod: rr.returnShippingMethod,
          returnShippingSelectedAt: rr.returnShippingSelectedAt,
          finalRefundAmount: rr.finalRefundAmount,
          resolutionType: rr.resolutionType || 'refund',
          resolutionNote: rr.resolutionNote || null,
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

/**
 * PATCH /api/v1/orders/:orderId/refunds/:refundId/select-return-shipping
 * Buyer selects return shipping method (drop-off or pickup)
 */
exports.selectReturnShippingMethod = catchAsync(async (req, res, next) => {
  const { orderId, refundId } = req.params;
  const { returnShippingMethod } = req.body;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

  // Validate input
  if (!returnShippingMethod || !['drop_off', 'pickup'].includes(returnShippingMethod)) {
    return next(new AppError('Valid return shipping method is required (drop_off or pickup)', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find refund request
    const refundRequest = await RefundRequest.findById(refundId).session(session);

    if (!refundRequest) {
      await session.abortTransaction();
      return next(new AppError('Refund request not found', 404));
    }

    // Verify refund belongs to user (skip for admin/superadmin)
    if (!isAdmin) {
      const buyerId = refundRequest.buyer && (refundRequest.buyer._id ? refundRequest.buyer._id.toString() : refundRequest.buyer.toString());
      if (buyerId !== userId.toString()) {
        await session.abortTransaction();
        return next(new AppError('You are not authorized to modify this refund request', 403));
      }
    }

    // Verify order matches
    if (refundRequest.order.toString() !== orderId.toString()) {
      await session.abortTransaction();
      return next(new AppError('Order ID mismatch', 400));
    }

    // Check if seller has already approved the return
    if (!refundRequest.sellerReviewed || refundRequest.sellerDecision !== 'approve_return') {
      await session.abortTransaction();
      return next(new AppError('Seller must approve the return before selecting shipping method', 400));
    }

    // Check if already selected
    if (refundRequest.returnShippingMethod) {
      await session.abortTransaction();
      return next(new AppError('Return shipping method has already been selected', 400));
    }

    // Update refund request
    refundRequest.returnShippingMethod = returnShippingMethod;
    refundRequest.returnShippingSelectedAt = new Date();
    await refundRequest.save({ session });

    await session.commitTransaction();

    // Notify admin that buyer has selected shipping method
    try {
      const notificationService = require('../../services/notification/notificationService');
      const order = await Order.findById(orderId).select('orderNumber').lean();
      await notificationService.createNotification({
        user: null, // Will notify all admins
        role: 'admin',
        type: 'REFUND_SHIPPING_SELECTED',
        title: 'Buyer Selected Return Shipping Method',
        message: `Buyer has selected ${returnShippingMethod === 'drop_off' ? 'drop-off' : 'pickup'} as return shipping method for refund request #${refundId.toString().slice(-8)} (Order #${order?.orderNumber || orderId.slice(-8)})`,
        metadata: {
          refundId: refundRequest._id,
          orderId: orderId,
          returnShippingMethod,
        },
      });
      logger.info(`[Select Return Shipping] Admin notification created for refund ${refundRequest._id}`);
    } catch (notificationError) {
      logger.error('[Select Return Shipping] Error creating admin notification:', notificationError);
      // Don't fail the operation if notification fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Return shipping method selected successfully',
      data: {
        refund: refundRequest,
      },
    });

  } catch (error) {
    if (session && typeof session.inTransaction === 'function' && session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
});