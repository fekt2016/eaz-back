const SellerOrder = require('../../models/order/sellerOrderModel');
const logger = require('../logger');

/**
 * Maps Order currentStatus to SellerOrder status
 * @param {string} orderStatus - The Order's currentStatus
 * @returns {string} - The corresponding SellerOrder status
 */
const mapOrderStatusToSellerOrderStatus = (orderStatus) => {
  const statusMap = {
    'pending_payment': 'pending',
    'payment_completed': 'confirmed',
    'processing': 'processing',
    'confirmed': 'confirmed',
    'preparing': 'processing',
    'ready_for_dispatch': 'processing',
    'out_for_delivery': 'shipped',
    'delivered': 'delivered',
    'cancelled': 'cancelled',
    'refunded': 'cancelled',
  };

  return statusMap[orderStatus] || 'pending';
};

/**
 * Sync SellerOrder status with Order status
 * Updates all SellerOrder documents associated with an Order
 * @param {string} orderId - The Order ID
 * @param {string} orderStatus - The Order's currentStatus
 * @param {object} session - Optional MongoDB session for transactions
 * @returns {Promise<{success: boolean, updated: number, errors: Array}>}
 */
const syncSellerOrderStatus = async (orderId, orderStatus, session = null) => {
  try {
    const sellerOrderStatus = mapOrderStatusToSellerOrderStatus(orderStatus);
    
    // Find all SellerOrder documents for this order
    const sellerOrders = await SellerOrder.find({ order: orderId }).session(session || null);
    
    if (!sellerOrders || sellerOrders.length === 0) {
      logger.info(`[syncSellerOrderStatus] No SellerOrder documents found for order ${orderId}`);
      return { success: true, updated: 0, errors: [] };
    }

    const updatePromises = sellerOrders.map(async (sellerOrder) => {
      try {
        // Only update if status is different to avoid unnecessary writes
        if (sellerOrder.status !== sellerOrderStatus) {
          sellerOrder.status = sellerOrderStatus;
          if (session) {
            await sellerOrder.save({ session });
          } else {
            await sellerOrder.save();
          }
          logger.info(`[syncSellerOrderStatus] Updated SellerOrder ${sellerOrder._id} status to ${sellerOrderStatus}`);
        }
        return { success: true, sellerOrderId: sellerOrder._id };
      } catch (error) {
        logger.error(`[syncSellerOrderStatus] Error updating SellerOrder ${sellerOrder._id}:`, error);
        return { success: false, sellerOrderId: sellerOrder._id, error: error.message };
      }
    });

    const results = await Promise.all(updatePromises);
    const successful = results.filter(r => r.success).length;
    const errors = results.filter(r => !r.success);

    return {
      success: errors.length === 0,
      updated: successful,
      total: sellerOrders.length,
      errors: errors,
    };
  } catch (error) {
    logger.error('[syncSellerOrderStatus] Error syncing SellerOrder status:', error);
    return {
      success: false,
      updated: 0,
      errors: [{ error: error.message }],
    };
  }
};

module.exports = {
  syncSellerOrderStatus,
  mapOrderStatusToSellerOrderStatus,
};

