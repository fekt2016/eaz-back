const mongoose = require('mongoose');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Admin = require('../../models/user/adminModel');
const notificationService = require('../notification/notificationService');
const logger = require('../../utils/logger');

/**
 * Utility: get cutoff date N days ago.
 */
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Find admin recipients for system alerts.
 * We keep this lightweight and defensive – if anything fails, we just log.
 */
async function getAdminRecipients() {
  try {
    const admins = await Admin.find({}).select('_id role').lean();
    return admins || [];
  } catch (err) {
    logger.error('[internationalPreorderService] Failed to load admins for alerts:', err);
    return [];
  }
}

/**
 * Risk check 1:
 *  - International pre-orders stuck in customs_clearance longer than `maxDaysInCustoms`
 *  - Sends email alerts to all admins.
 *
 * This function is designed to be run from a scheduled job (e.g. cron).
 */
async function checkCustomsDelays(maxDaysInCustoms = 3) {
  const cutoff = daysAgo(maxDaysInCustoms);

  const delayedOrders = await Order.find({
    orderType: 'preorder_international',
    currentStatus: 'customs_clearance',
    customsClearedAt: { $exists: true, $lt: cutoff },
  })
    .select('_id orderNumber customsClearedAt supplierCountry supplierName')
    .lean();

  if (!delayedOrders.length) {
    return { checked: 0, alerted: 0 };
  }

  const admins = await getAdminRecipients();
  if (!admins.length) {
    logger.warn('[internationalPreorderService] No admin recipients found for customs delay alerts');
    return { checked: delayedOrders.length, alerted: 0 };
  }

  let alertsSent = 0;

  for (const order of delayedOrders) {
    for (const admin of admins) {
      try {
        await notificationService.createNotification({
          user: admin._id,
          role: 'admin',
          type: 'order_alert',
          title: `Customs delay for order ${order.orderNumber}`,
          message: `International pre-order ${order.orderNumber} has been in customs since ${order.customsClearedAt.toISOString()}. Supplier: ${order.supplierName || 'N/A'} (${order.supplierCountry || 'unknown'}).`,
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            alertType: 'customs_delay',
          },
          priority: 'high',
          actionUrl: `/dashboard/orders/${order._id}`,
        });
        alertsSent += 1;
      } catch (err) {
        logger.error('[internationalPreorderService] Failed to send customs delay alert:', err);
      }
    }
  }

  return { checked: delayedOrders.length, alerted: alertsSent };
}

/**
 * Risk check 2:
 *  - International pre-orders with no tracking update for more than `maxDaysWithoutUpdate`
 *  - Sends alerts to the associated sellers.
 *
 * This is also designed for a scheduled job.
 */
async function checkStaleInternationalOrders(maxDaysWithoutUpdate = 5) {
  const cutoff = daysAgo(maxDaysWithoutUpdate);

  // Fetch orders that are still active (not delivered/cancelled/refunded) and old last update
  const candidates = await Order.find({
    orderType: 'preorder_international',
    currentStatus: { $nin: ['delivered', 'cancelled', 'refunded'] },
    'trackingHistory.timestamp': { $exists: true },
  })
    .select('_id orderNumber trackingHistory')
    .lean();

  const staleOrders = candidates.filter((order) => {
    const history = order.trackingHistory || [];
    if (!history.length) return true; // No history at all
    const lastUpdate = history[history.length - 1].timestamp;
    if (!lastUpdate) return true;
    return new Date(lastUpdate) < cutoff;
  });

  if (!staleOrders.length) {
    return { checked: candidates.length, alerted: 0 };
  }

  let alertsSent = 0;

  for (const order of staleOrders) {
    try {
      const sellerOrders = await SellerOrder.find({ order: order._id })
        .populate('seller', '_id')
        .lean();

      for (const so of sellerOrders) {
        if (!so.seller || !so.seller._id) continue;

        await notificationService.createNotification({
          user: so.seller._id,
          role: 'seller',
          type: 'order_alert',
          title: `No tracking updates for order ${order.orderNumber}`,
          message: `International pre-order ${order.orderNumber} has not received any tracking updates for more than ${maxDaysWithoutUpdate} days. Please review and update the order status.`,
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            alertType: 'stale_tracking',
          },
          priority: 'high',
          actionUrl: `/dashboard/orders/${order._id}`,
        });

        alertsSent += 1;
      }
    } catch (err) {
      logger.error('[internationalPreorderService] Failed to send stale order alerts:', err);
    }
  }

  return { checked: candidates.length, alerted: alertsSent };
}

module.exports = {
  checkCustomsDelays,
  checkStaleInternationalOrders,
};

