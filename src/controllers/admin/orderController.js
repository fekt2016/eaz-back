const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Seller = require('../../models/user/sellerModel');
const PlatformStats = require('../../models/platform/platformStatsModel');
const mongoose = require('mongoose');
const notificationService = require('../../services/notification/notificationService');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

/**
 * Admin manual payment confirmation
 * PATCH /api/v1/admin/orders/:orderId/confirm-payment
 * 
 * Confirms payment for bank transfer and cash on delivery orders
 * - Updates paymentStatus to "paid"
 * - Updates orderStatus based on payment method
 * - Credits seller pending balance
 * - Adds platform revenue
 * - Sends notification to seller
 */
exports.confirmPayment = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const adminId = req.user.id;

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find order with seller orders populated
    const order = await Order.findById(orderId)
      .populate({
        path: 'sellerOrder',
        populate: {
          path: 'seller',
          select: '_id name shopName balance pendingBalance',
        },
      })
      .session(session);

    if (!order) {
      await session.abortTransaction();
      return next(new AppError('Order not found', 404));
    }

    // Validate payment status
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'completed') {
      await session.abortTransaction();
      return next(new AppError('Payment has already been confirmed for this order', 400));
    }

    // Validate payment method
    const validPaymentMethods = ['bank_transfer', 'payment_on_delivery'];
    if (!validPaymentMethods.includes(order.paymentMethod)) {
      await session.abortTransaction();
      
      if (order.paymentMethod === 'paystack') {
        return next(new AppError('Paystack payments are automatically confirmed. Manual confirmation is not needed.', 400));
      }
      
      return next(new AppError(`Manual payment confirmation is only available for bank transfer and cash on delivery. Current method: ${order.paymentMethod}`, 400));
    }

    // Determine order status based on payment method
    // Note: orderStatus enum: ['pending', 'shipped', 'delievered', 'cancelled']
    //      currentStatus enum: ['pending_payment', 'payment_completed', 'processing', 'confirmed', 'preparing', 'ready_for_dispatch', 'out_for_delivery', 'delivered', 'cancelled', 'refunded']
    //      status enum: ['pending', 'paid', 'confirmed', 'processing', 'partially_shipped', 'completed', 'cancelled']
    let newCurrentStatus;
    let newStatus;
    let newOrderStatus;
    let trackingStatus;
    
    if (order.paymentMethod === 'bank_transfer') {
      newCurrentStatus = 'confirmed';
      newStatus = 'confirmed';
      newOrderStatus = 'pending'; // Keep as pending until shipped
      trackingStatus = 'confirmed';
    } else if (order.paymentMethod === 'payment_on_delivery') {
      newCurrentStatus = 'delivered'; // Use 'delivered' not 'completed' for currentStatus
      newStatus = 'completed'; // Use 'completed' for status field
      newOrderStatus = 'delievered'; // Note: typo in model enum
      trackingStatus = 'delivered';
    }

    // Update order payment and status
    order.paymentStatus = 'paid';
    order.currentStatus = newCurrentStatus;
    order.status = newStatus;
    order.orderStatus = newOrderStatus;
    order.paidAt = new Date();
    order.paymentConfirmedBy = adminId;
    order.paymentConfirmedAt = new Date();

    // Store revenue amount
    const orderTotal = order.totalPrice || 0;
    order.revenueAmount = orderTotal;
    order.revenueAdded = true;

    // Add tracking history entry
    if (!order.trackingHistory) {
      order.trackingHistory = [];
    }

    const paymentConfirmationMessage = order.paymentMethod === 'bank_transfer' 
      ? 'Bank transfer payment confirmed by admin'
      : 'Cash on delivery payment confirmed by admin';

    order.trackingHistory.push({
      status: trackingStatus,
      message: paymentConfirmationMessage,
      location: '',
      updatedBy: adminId,
      updatedByModel: 'Admin',
      timestamp: new Date(),
    });

    // Handle platform revenue and seller credits based on payment method
    const sellerBalanceUpdates = [];
    
    if (order.paymentMethod === 'bank_transfer') {
      // Bank transfer: Order is just confirmed (not delivered yet)
      // - Add platform revenue
      // - Credit seller pendingBalance (will be moved to balance when delivered)
      
      if (orderTotal > 0 && !order.revenueAdded) {
        const platformStats = await PlatformStats.getStats();
        platformStats.totalRevenue = (platformStats.totalRevenue || 0) + orderTotal;
        platformStats.addDailyRevenue(new Date(), orderTotal, 0);
        platformStats.lastUpdated = new Date();
        await platformStats.save({ session });
        
        console.log(`[confirmPayment] Added GH₵${orderTotal.toFixed(2)} to platform revenue for order ${orderId}`);
      }
      
      // Credit seller pending balances (order not delivered yet)
      if (order.sellerOrder && order.sellerOrder.length > 0) {
        const PlatformSettings = require('../../models/platform/platformSettingsModel');
        const platformSettings = await PlatformSettings.getSettings();
        const platformCommissionRate = platformSettings.platformCommissionRate || 0;

        for (const sellerOrderId of order.sellerOrder) {
          const sellerOrder = await SellerOrder.findById(sellerOrderId)
            .populate('seller')
            .session(session);

          if (!sellerOrder || !sellerOrder.seller) {
            continue;
          }

          const sellerId = sellerOrder.seller._id || sellerOrder.seller;
          const seller = await Seller.findById(sellerId).session(session);

          if (!seller) {
            console.warn(`[confirmPayment] Seller ${sellerId} not found for sellerOrder ${sellerOrderId}`);
            continue;
          }

          // Calculate seller earnings
          const totalBasePrice = sellerOrder.totalBasePrice || 0;
          const shippingCost = sellerOrder.shippingCost || 0;
          const commissionRate = sellerOrder.commissionRate !== undefined 
            ? sellerOrder.commissionRate 
            : platformCommissionRate;
          const commissionAmount = (totalBasePrice + shippingCost) * commissionRate;
          const sellerEarnings = (totalBasePrice + shippingCost) - commissionAmount;

          if (sellerEarnings <= 0) {
            continue;
          }

          // Credit to pendingBalance (order not delivered yet)
          const oldPendingBalance = seller.pendingBalance || 0;
          seller.pendingBalance = oldPendingBalance + sellerEarnings;
          seller.calculateWithdrawableBalance();
          await seller.save({ session });

          sellerBalanceUpdates.push({
            sellerId: sellerId.toString(),
            sellerName: seller.name || seller.shopName || 'Unknown',
            earnings: sellerEarnings,
            oldPendingBalance,
            newPendingBalance: seller.pendingBalance,
            creditedTo: 'pendingBalance',
          });

          console.log(`[confirmPayment] Credited seller ${sellerId} pendingBalance:`, {
            earnings: sellerEarnings,
            oldPendingBalance,
            newPendingBalance: seller.pendingBalance,
          });
        }
      }
    } else if (order.paymentMethod === 'payment_on_delivery') {
      // Payment on delivery: Order is already delivered
      // - Add platform revenue (if not already added)
      // - Credit seller actual balance (not pendingBalance) via creditSellerForOrder
      // - This is because the order is delivered, so seller should get paid immediately
      
      if (orderTotal > 0 && !order.revenueAdded) {
        const platformStats = await PlatformStats.getStats();
        platformStats.totalRevenue = (platformStats.totalRevenue || 0) + orderTotal;
        platformStats.addDailyRevenue(new Date(), orderTotal, 0);
        platformStats.lastUpdated = new Date();
        await platformStats.save({ session });
        
        console.log(`[confirmPayment] Added GH₵${orderTotal.toFixed(2)} to platform revenue for order ${orderId}`);
      }
      
      // For payment_on_delivery, order is delivered, so credit seller actual balance
      // Use the orderService to credit sellers (this credits balance, not pendingBalance)
      // Note: We need to save the order first so creditSellerForOrder can find it with status 'delivered'
      await order.save({ session });
      
      try {
        const orderService = require('../../services/order/orderService');
        const balanceUpdateResult = await orderService.creditSellerForOrder(orderId, adminId);
        
        if (balanceUpdateResult.success) {
          sellerBalanceUpdates.push(...balanceUpdateResult.updates.map(update => ({
            sellerId: update.sellerId,
            sellerName: update.sellerName || 'Unknown',
            earnings: update.amount,
            creditedTo: 'balance',
          })));
          console.log(`[confirmPayment] ✅ Credited sellers via creditSellerForOrder for delivered order ${orderId}`);
        } else {
          console.warn(`[confirmPayment] ⚠️ Seller credit failed: ${balanceUpdateResult.message}`);
        }
      } catch (creditError) {
        console.error(`[confirmPayment] ❌ Error crediting sellers:`, creditError);
        // Don't fail the transaction, but log the error
      }
    }

    // Send notifications to sellers
    if (order.sellerOrder && order.sellerOrder.length > 0) {
      for (const sellerOrderId of order.sellerOrder) {
        const sellerOrder = await SellerOrder.findById(sellerOrderId)
          .populate('seller')
          .session(session);

        if (!sellerOrder || !sellerOrder.seller) {
          continue;
        }

        const sellerId = sellerOrder.seller._id || sellerOrder.seller;

        try {
          await notificationService.createNotification({
            user: sellerId,
            role: 'seller',
            type: 'order',
            title: `Payment Confirmed: Order ${order.orderNumber}`,
            message: 'Your order payment has been confirmed by admin.',
            metadata: {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              paymentMethod: order.paymentMethod,
            },
            priority: 'high',
            actionUrl: `/dashboard/orders/${order._id}`,
          });
          console.log(`[confirmPayment] ✅ Notification sent to seller ${sellerId}`);
        } catch (notifError) {
          console.error(`[confirmPayment] ❌ Error sending notification to seller ${sellerId}:`, notifError);
        }
      }
    }

    // Save order (if not already saved for payment_on_delivery)
    if (order.paymentMethod !== 'payment_on_delivery') {
      await order.save({ session });
    }

    // Log activity
    await logActivityAsync({
      userId: adminId,
      role: 'admin',
      action: 'CONFIRM_PAYMENT',
      description: `Admin confirmed payment for order ${order.orderNumber} (${order.paymentMethod})`,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        orderTotal,
        sellerBalanceUpdates,
      },
      req,
    });

    // Commit transaction
    await session.commitTransaction();

    console.log(`[confirmPayment] ✅ Payment confirmed successfully for order ${orderId}`);

    res.status(200).json({
      status: 'success',
      message: `Payment confirmed successfully. Order status updated to ${newOrderStatus}.`,
      data: {
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          paymentStatus: order.paymentStatus,
          orderStatus: order.orderStatus,
          status: order.status,
          currentStatus: order.currentStatus,
        },
        sellerBalanceUpdates,
        platformRevenue: orderTotal,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[confirmPayment] Error:', error);
    throw error;
  } finally {
    session.endSession();
  }
});

