const Notification = require('../../models/notification/notificationModel');
const pushNotificationService = require('../pushNotificationService');

/**
 * Notification Service
 * Helper functions for creating notifications throughout the application
 * 
 * NOTE: This service automatically sends push notifications when creating database notifications
 * (if the user has registered device tokens)
 */

/**
 * Create a notification for a user
 * @param {Object} options - Notification options
 * @param {String|ObjectId} options.user - User ID
 * @param {String} options.role - User role ('buyer', 'seller', 'admin')
 * @param {String} options.type - Notification type
 * @param {String} options.title - Notification title
 * @param {String} options.message - Notification message
 * @param {Object} options.metadata - Additional metadata
 * @param {String} options.priority - Priority level ('low', 'medium', 'high', 'urgent')
 * @param {String} options.actionUrl - URL to navigate when notification is clicked
 * @param {Date} options.expiresAt - Optional expiration date
 * @returns {Promise<Notification>}
 */
exports.createNotification = async ({
  user,
  role,
  type,
  title,
  message,
  metadata = {},
  priority = 'medium',
  actionUrl = null,
  expiresAt = null,
}) => {
  try {
    // Determine userModel based on role
    let userModel = 'User';
    if (role === 'seller') {
      userModel = 'Seller';
    } else if (role === 'admin') {
      userModel = 'Admin';
    }

    // Ensure user ID is in correct format (ObjectId)
    const mongoose = require('mongoose');
    const userId = mongoose.Types.ObjectId.isValid(user) ? new mongoose.Types.ObjectId(user) : user;

    console.log(`[NotificationService] Creating notification:`, {
      user: userId.toString(),
      userModel,
      role,
      type,
      title
    });

    const notification = await Notification.create({
      user: userId,
      userModel,
      type,
      title,
      message,
      role,
      metadata,
      priority,
      actionUrl,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    console.log(`[NotificationService] ✅ Created notification:`, {
      id: notification._id,
      user: notification.user?.toString(),
      userModel: notification.userModel,
      role: notification.role,
      type: notification.type,
      title: notification.title
    });

    // Automatically send push notification (non-blocking)
    // This ensures users get real-time alerts when notifications are created
    setImmediate(async () => {
      try {
        const pushResult = await pushNotificationService.sendPushToUser(userId.toString(), {
          title: title,
          body: message,
          data: {
            type: type,
            referenceId: metadata?.orderId || metadata?.withdrawalId || metadata?.productId || metadata?.ticketId || metadata?.refundId || notification._id.toString(),
            notificationId: notification._id.toString(),
            actionUrl: actionUrl,
            ...metadata,
          },
          priority: priority === 'urgent' || priority === 'high' ? 'high' : 'default',
          badge: 1,
        });

        if (pushResult.success) {
          console.log(`[NotificationService] 📱 Push notification sent:`, {
            notificationId: notification._id,
            sent: pushResult.sent,
            total: pushResult.total,
          });
        } else {
          // Not an error - user may not have registered device token
          if (__DEV__) {
            console.debug(`[NotificationService] ℹ️ Push notification not sent:`, pushResult.message);
          }
        }
      } catch (pushError) {
        // Don't fail notification creation if push fails
        console.error('[NotificationService] ⚠️ Error sending push notification (non-critical):', pushError.message);
      }
    });

    return notification;
  } catch (error) {
    console.error('[NotificationService] Error creating notification:', error);
    throw error;
  }
};

/**
 * Create order notification for buyer
 */
exports.createOrderNotification = async (userId, orderId, orderNumber, status) => {
  const statusMessages = {
    pending: 'Your order has been placed successfully',
    confirmed: 'Your order has been confirmed',
    processing: 'Your order is being processed',
    shipped: 'Your order has been shipped',
    delivered: 'Your order has been delivered',
    cancelled: 'Your order has been cancelled',
  };

  return await exports.createNotification({
    user: userId,
    role: 'buyer',
    type: 'order',
    title: `Order ${orderNumber}`,
    message: statusMessages[status] || `Order ${orderNumber} status updated`,
    metadata: { orderId },
    priority: status === 'cancelled' ? 'high' : 'medium',
    actionUrl: `/orders/${orderId}`,
  });
};

/**
 * Create order notification for seller
 */
exports.createSellerOrderNotification = async (sellerId, orderId, orderNumber, status) => {
  const statusMessages = {
    pending: 'You have a new order',
    confirmed: 'Order has been confirmed',
    processing: 'Order is being processed',
    shipped: 'Order has been shipped',
    delivered: 'Order has been delivered',
    cancelled: 'Order has been cancelled',
  };

  return await exports.createNotification({
    user: sellerId,
    role: 'seller',
    type: 'order',
    title: `New Order: ${orderNumber}`,
    message: statusMessages[status] || `Order ${orderNumber} status updated`,
    metadata: { orderId },
    priority: status === 'pending' ? 'high' : 'medium',
    actionUrl: `/dashboard/orders/${orderId}`,
  });
};

/**
 * Create order notification for admin
 */
exports.createAdminOrderNotification = async (adminId, orderId, orderNumber, status) => {
  const statusMessages = {
    pending: 'A new order has been placed',
    confirmed: 'Order has been confirmed',
    processing: 'Order is being processed',
    shipped: 'Order has been shipped',
    delivered: 'Order has been delivered',
    cancelled: 'Order has been cancelled',
  };

  return await exports.createNotification({
    user: adminId,
    role: 'admin',
    type: 'order',
    title: `New Order: ${orderNumber}`,
    message: statusMessages[status] || `Order ${orderNumber} status updated`,
    metadata: { orderId },
    priority: status === 'pending' ? 'high' : 'medium',
    actionUrl: `/dashboard/orders/${orderId}`,
  });
};

/**
 * Create delivery notification
 */
exports.createDeliveryNotification = async (userId, orderId, trackingNumber, status) => {
  return await exports.createNotification({
    user: userId,
    role: 'buyer',
    type: 'delivery',
    title: 'Delivery Update',
    message: `Your order ${trackingNumber} is ${status}`,
    metadata: { orderId },
    priority: 'medium',
    actionUrl: `/orders/${orderId}`,
  });
};

/**
 * Create refund notification
 */
exports.createRefundNotification = async (userId, refundId, status, amount) => {
  return await exports.createNotification({
    user: userId,
    role: 'buyer',
    type: 'refund',
    title: 'Refund Update',
    message: `Your refund request for GH₵${amount} is ${status}`,
    metadata: { refundId },
    priority: 'high',
    actionUrl: `/refunds/${refundId}`,
  });
};

/**
 * Create payout notification for seller
 */
exports.createPayoutNotification = async (sellerId, withdrawalId, status, amount) => {
  return await exports.createNotification({
    user: sellerId,
    role: 'seller',
    type: 'payout',
    title: 'Withdrawal Update',
    message: `Your withdrawal request for GH₵${amount} is ${status}`,
    metadata: { withdrawalId },
    priority: 'high',
    actionUrl: `/dashboard/finance/payment-requests`,
  });
};

/**
 * Create refund request notification for seller
 */
exports.createSellerRefundRequestNotification = async (sellerId, refundId, orderId, orderNumber, amount, buyerName) => {
  return await exports.createNotification({
    user: sellerId,
    role: 'seller',
    type: 'refund',
    title: 'Refund Request Received',
    message: `${buyerName} has requested a refund of GH₵${amount} for Order ${orderNumber}`,
    metadata: { refundId, orderId },
    priority: 'high',
    actionUrl: `/dashboard/orders/${orderId}`,
  });
};

/**
 * Create refund status notification for seller
 */
exports.createSellerRefundStatusNotification = async (sellerId, refundId, orderId, orderNumber, status, amount) => {
  const statusMessages = {
    approved: `Refund of GH₵${amount} for Order ${orderNumber} has been approved`,
    rejected: `Refund request for Order ${orderNumber} has been rejected`,
    completed: `Refund of GH₵${amount} for Order ${orderNumber} has been completed`,
  };

  return await exports.createNotification({
    user: sellerId,
    role: 'seller',
    type: 'refund',
    title: 'Refund Status Update',
    message: statusMessages[status] || `Refund status for Order ${orderNumber} updated to ${status}`,
    metadata: { refundId, orderId },
    priority: 'high',
    actionUrl: `/dashboard/orders/${orderId}`,
  });
};

/**
 * Create support ticket notification
 */
exports.createSupportNotification = async (userId, ticketId, role, message) => {
  return await exports.createNotification({
    user: userId,
    role: role,
    type: 'support',
    title: 'Support Ticket Update',
    message: message,
    metadata: { ticketId },
    priority: 'medium',
    actionUrl: role === 'buyer' ? `/support/${ticketId}` : role === 'seller' ? `/dashboard/support/tickets/${ticketId}` : `/dashboard/support/tickets/${ticketId}`,
  });
};

/**
 * Create product notification (approval/rejection)
 */
exports.createProductNotification = async (sellerId, productId, status, productName) => {
  const messages = {
    approved: `Your product "${productName}" has been approved`,
    rejected: `Your product "${productName}" has been rejected`,
    pending: `Your product "${productName}" is under review`,
  };

  return await exports.createNotification({
    user: sellerId,
    role: 'seller',
    type: 'product',
    title: 'Product Status Update',
    message: messages[status] || `Product "${productName}" status updated`,
    metadata: { productId },
    priority: status === 'rejected' ? 'high' : 'medium',
    actionUrl: `/dashboard/products/${productId}/edit`,
  });
};

/**
 * Create verification notification
 */
exports.createVerificationNotification = async (userId, role, verificationId, status) => {
  const messages = {
    approved: 'Your verification request has been approved',
    rejected: 'Your verification request has been rejected',
    pending: 'Your verification request is under review',
  };

  return await exports.createNotification({
    user: userId,
    role: role,
    type: 'verification',
    title: 'Verification Update',
    message: messages[status] || 'Verification status updated',
    metadata: { verificationId },
    priority: 'high',
    actionUrl: role === 'seller' ? '/dashboard/profile' : '/admin/verifications',
  });
};

/**
 * Create system announcement
 */
exports.createAnnouncement = async (userIds, role, title, message, actionUrl = null) => {
  const notifications = [];
  
  for (const userId of userIds) {
    try {
      const notification = await exports.createNotification({
        user: userId,
        role: role,
        type: 'announcement',
        title,
        message,
        priority: 'medium',
        actionUrl,
      });
      notifications.push(notification);
    } catch (error) {
      console.error(`[NotificationService] Error creating announcement for user ${userId}:`, error);
    }
  }

  return notifications;
};

/**
 * Create notification for all active admins
 * @param {String} type - Notification type
 * @param {String} title - Notification title
 * @param {String} message - Notification message
 * @param {Object} metadata - Additional metadata
 * @param {String} priority - Priority level
 * @param {String} actionUrl - URL to navigate when notification is clicked
 */
exports.createNotificationForAllAdmins = async ({
  type,
  title,
  message,
  metadata = {},
  priority = 'medium',
  actionUrl = null,
}) => {
  try {
    const Admin = require('../../models/user/adminModel');
    
    // CRITICAL FIX: 'active' field has select: false, so we need to explicitly include it with +active
    const allAdmins = await Admin.find({ 
      status: 'active' 
    }).select('+active _id').lean();
    
    // Filter to only active admins (active defaults to true, but we check explicitly)
    const activeAdmins = allAdmins.filter(admin => admin.active !== false);
    
    console.log(`[NotificationService] 🔔 Creating ${type} notification for ${activeAdmins.length} active admins (out of ${allAdmins.length} total with status 'active')`);
    
    if (activeAdmins.length === 0) {
      console.warn(`[NotificationService] ⚠️ No active admins found to send ${type} notification`);
      return [];
    }
    
    const notifications = [];
    for (const admin of activeAdmins) {
      try {
        console.log(`[NotificationService] 📧 Creating ${type} notification for admin ${admin._id}`);
        const notification = await exports.createNotification({
          user: admin._id,
          role: 'admin',
          type,
          title,
          message,
          metadata,
          priority,
          actionUrl,
        });
        notifications.push(notification);
        console.log(`[NotificationService] ✅ Successfully created ${type} notification for admin ${admin._id}`);
      } catch (error) {
        console.error(`[NotificationService] ❌ Error creating ${type} notification for admin ${admin._id}:`, error.message);
        console.error(`[NotificationService] Full error:`, error);
      }
    }
    
    console.log(`[NotificationService] ✅ Created ${notifications.length} ${type} notifications for admins`);
    return notifications;
  } catch (error) {
    console.error('[NotificationService] ❌ Error creating notifications for admins:', error);
    throw error;
  }
};

/**
 * Create seller registration notification for admins
 */
exports.createSellerRegistrationNotification = async (sellerId, sellerName, sellerEmail) => {
  return await exports.createNotificationForAllAdmins({
    type: 'seller',
    title: 'New Seller Registration',
    message: `${sellerName || sellerEmail} has registered as a seller and requires verification`,
    metadata: { sellerId },
    priority: 'high',
    actionUrl: `/dashboard/sellers/detail/${sellerId}`,
  });
};

/**
 * Create seller verification submission notification for admins
 */
exports.createSellerVerificationSubmissionNotification = async (sellerId, sellerName) => {
  return await exports.createNotificationForAllAdmins({
    type: 'seller',
    title: 'Seller Verification Submitted',
    message: `${sellerName} has submitted verification documents for review`,
    metadata: { sellerId },
    priority: 'high',
    actionUrl: `/dashboard/sellers/detail/${sellerId}`,
  });
};

/**
 * Create product creation notification for admins
 */
exports.createProductCreationNotification = async (productId, productName, sellerId, sellerName) => {
  return await exports.createNotificationForAllAdmins({
    type: 'product',
    title: 'New Product Submitted',
    message: `New product "${productName}" submitted by ${sellerName} requires approval`,
    metadata: { productId, sellerId },
    priority: 'medium',
    actionUrl: `/dashboard/product-details/${productId}`,
  });
};

/**
 * Create refund request notification for admins
 */
exports.createRefundRequestNotification = async (refundId, orderId, orderNumber, amount, requestedBy) => {
  return await exports.createNotificationForAllAdmins({
    type: 'refund',
    title: 'New Refund Request',
    message: `Refund request for Order ${orderNumber} (GH₵${amount}) from ${requestedBy}`,
    metadata: { refundId, orderId },
    priority: 'high',
    actionUrl: `/dashboard/refunds/${refundId}`,
  });
};

/**
 * Create withdrawal request notification for admins
 */
exports.createWithdrawalRequestNotification = async (withdrawalId, sellerId, sellerName, amount) => {
  return await exports.createNotificationForAllAdmins({
    type: 'payout',
    title: 'New Withdrawal Request',
    message: `${sellerName} has requested withdrawal of GH₵${amount}`,
    metadata: { withdrawalId, sellerId },
    priority: 'high',
    actionUrl: `/dashboard/payment-request/detail/${withdrawalId}`,
  });
};

/**
 * Create support ticket notification for admins
 */
exports.createSupportTicketNotification = async (ticketId, ticketNumber, title, createdBy, role) => {
  return await exports.createNotificationForAllAdmins({
    type: 'support',
    title: 'New Support Ticket',
    message: `Ticket #${ticketNumber}: ${title} from ${createdBy} (${role})`,
    metadata: { ticketId },
    priority: 'medium',
    actionUrl: `/dashboard/support/tickets/${ticketId}`,
  });
};

/**
 * Create review flag notification for admins
 */
exports.createReviewFlagNotification = async (reviewId, productId, productName, reason) => {
  return await exports.createNotificationForAllAdmins({
    type: 'product',
    title: 'Review Flagged',
    message: `Review for "${productName}" has been flagged: ${reason || 'Inappropriate content'}`,
    metadata: { reviewId, productId },
    priority: 'medium',
    actionUrl: `/dashboard/reviews`,
  });
};

/**
 * Create seller return decision notification for admins
 */
exports.createSellerReturnDecisionNotification = async (refundId, orderId, orderNumber, sellerName, decision, itemCount, reason) => {
  const decisionMessages = {
    approve: `Seller ${sellerName} approved return request for ${itemCount} item(s) in Order ${orderNumber}. Awaiting admin review.`,
    reject: `Seller ${sellerName} rejected return request for ${itemCount} item(s) in Order ${orderNumber}. Reason: ${reason || 'No reason provided'}. Awaiting admin review.`,
  };

  return await exports.createNotificationForAllAdmins({
    type: 'refund',
    title: decision === 'approve' ? 'Return Request Approved by Seller' : 'Return Request Rejected by Seller',
    message: decisionMessages[decision] || `Seller ${sellerName} made a decision on return request for Order ${orderNumber}`,
    metadata: { refundId, orderId },
    priority: 'high',
    actionUrl: `/dashboard/refunds/${refundId}`,
  });
};

/**
 * Create seller verification notification (convenience wrapper)
 */
exports.createSellerVerificationNotification = async (sellerId, verificationId, status) => {
  return await exports.createVerificationNotification(sellerId, 'seller', verificationId, status);
};

/**
 * Create seller product notification (convenience wrapper - already exists as createProductNotification)
 */
exports.createSellerProductNotification = async (sellerId, productId, status, productName) => {
  return await exports.createProductNotification(sellerId, productId, status, productName);
};

/**
 * Create coupon creation notification for admins
 */
exports.createCouponCreationNotification = async (couponBatchId, sellerId, sellerName, couponName, discountType, discountValue, quantity) => {
  const discountText = discountType === 'percentage' 
    ? `${discountValue}% off` 
    : `GH₵${discountValue} off`;
  
  return await exports.createNotificationForAllAdmins({
    type: 'product',
    title: 'New Coupon Batch Created',
    message: `${sellerName} created a new coupon batch "${couponName}" with ${discountText} discount (${quantity} coupons)`,
    metadata: { 
      couponBatchId, 
      sellerId,
      discountType,
      discountValue,
      quantity
    },
    priority: discountValue > 90 && discountType === 'percentage' ? 'high' : 'medium',
    actionUrl: `/dashboard/coupons/${couponBatchId}`,
  });
};

/**
 * Create seller support reply notification (convenience wrapper)
 */
exports.createSellerSupportReplyNotification = async (sellerId, ticketId, message) => {
  return await exports.createSupportNotification(sellerId, ticketId, 'seller', message);
};

/**
 * Create seller refund notification (convenience wrapper - already exists)
 */
exports.createSellerRefundNotification = async (sellerId, refundId, orderId, orderNumber, status, amount) => {
  return await exports.createSellerRefundStatusNotification(sellerId, refundId, orderId, orderNumber, status, amount);
};

module.exports = exports;

