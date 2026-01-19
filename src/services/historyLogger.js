const WalletHistory = require('../models/history/walletHistoryModel');
const SellerRevenueHistory = require('../models/history/sellerRevenueHistoryModel');
const Creditbalance = require('../models/user/creditbalanceModel');
const Seller = require('../models/user/sellerModel');
const logger = require('../utils/logger');

/**
 * Universal History Logger Service
 * Logs all balance changes for buyers (wallet) and sellers (revenue)
 * MUST NOT break main action if logging fails
 */

/**
 * Log buyer wallet transaction
 * @param {Object} params
 * @param {ObjectId} params.userId - User ID
 * @param {Number} params.amount - Transaction amount (positive for credits, negative for debits)
 * @param {String} params.type - Transaction type (TOPUP, PAYSTACK_TOPUP, ORDER_DEBIT, REFUND_CREDIT, ADMIN_ADJUST, TRANSFER)
 * @param {String} params.description - Human-readable description
 * @param {String} params.reference - Unique reference (for idempotency)
 * @param {ObjectId} params.orderId - Order ID if related to order
 * @param {ObjectId} params.refundId - Refund ID if related to refund
 * @param {ObjectId} params.adminId - Admin ID if initiated by admin
 * @param {Object} params.metadata - Additional metadata
 * @returns {Promise<Object|null>} - Created history entry or null if logging failed
 */
async function logBuyerWallet({
  userId,
  amount,
  type,
  description,
  reference = null,
  orderId = null,
  refundId = null,
  adminId = null,
  metadata = {},
}) {
  try {
    // Get current wallet balance
    const wallet = await Creditbalance.findOne({ user: userId }).lean();
    if (!wallet) {
      logger.warn(`[HistoryLogger] Wallet not found for user ${userId}, skipping history log`);
      return null;
    }

    const balanceBefore = wallet.balance || 0;
    
    // Calculate balance after (amount can be positive or negative)
    const balanceAfter = balanceBefore + amount;

    // Check for duplicate by reference (idempotency)
    if (reference) {
      const existing = await WalletHistory.findOne({ reference }).lean();
      if (existing) {
        logger.info(`[HistoryLogger] Duplicate wallet history entry found for reference ${reference}, skipping`);
        return existing;
      }
    }

    // Create history entry
    const historyEntry = await WalletHistory.create({
      userId,
      type,
      amount,
      balanceBefore,
      balanceAfter,
      reference,
      description,
      orderId,
      refundId,
      adminId,
      metadata,
    });

    logger.info(`[HistoryLogger] Wallet history logged: ${type} for user ${userId}, amount: ${amount}, balance: ${balanceBefore} → ${balanceAfter}`);
    return historyEntry;
  } catch (error) {
    // Log error but don't throw - don't break main action
    logger.error(`[HistoryLogger] Failed to log buyer wallet history:`, {
      userId,
      type,
      amount,
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Log seller revenue transaction
 * @param {Object} params
 * @param {ObjectId} params.sellerId - Seller ID
 * @param {Number} params.amount - Transaction amount (positive for credits, negative for debits)
 * @param {String} params.type - Transaction type (ORDER_EARNING, REFUND_DEDUCTION, PAYOUT, ADMIN_ADJUST, CORRECTION, REVERSAL)
 * @param {String} params.description - Human-readable description
 * @param {String} params.reference - Unique reference (for idempotency)
 * @param {ObjectId} params.orderId - Order ID if related to order
 * @param {ObjectId} params.refundId - Refund ID if related to refund
 * @param {ObjectId} params.adminId - Admin ID if initiated by admin
 * @param {ObjectId} params.payoutRequestId - Payout request ID if related to payout
 * @param {Number} params.balanceBefore - Optional: Balance before transaction (if provided, won't read from DB)
 * @param {Number} params.balanceAfter - Optional: Balance after transaction (if provided, won't calculate)
 * @param {Object} params.metadata - Additional metadata
 * @returns {Promise<Object|null>} - Created history entry or null if logging failed
 */
async function logSellerRevenue({
  sellerId,
  amount,
  type,
  description,
  reference = null,
  orderId = null,
  refundId = null,
  adminId = null,
  payoutRequestId = null,
  balanceBefore = null,
  balanceAfter = null,
  metadata = {},
}) {
  try {
    let finalBalanceBefore, finalBalanceAfter;
    
    // If balance values are provided, use them (more accurate, especially during transactions)
    if (balanceBefore !== null && balanceAfter !== null) {
      finalBalanceBefore = balanceBefore;
      finalBalanceAfter = balanceAfter;
    } else {
      // Otherwise, read from database (for backward compatibility)
      const seller = await Seller.findById(sellerId).select('balance').lean();
      if (!seller) {
        logger.warn(`[HistoryLogger] Seller not found for seller ${sellerId}, skipping history log`);
        return null;
      }

      finalBalanceBefore = seller.balance || 0;
      
      // Calculate balance after (amount can be positive or negative)
      finalBalanceAfter = finalBalanceBefore + amount;
    }

    // Check for duplicate by reference (idempotency)
    if (reference) {
      const existing = await SellerRevenueHistory.findOne({ reference }).lean();
      if (existing) {
        logger.info(`[HistoryLogger] Duplicate seller revenue history entry found for reference ${reference}, skipping`);
        return existing;
      }
    }

    // Create history entry
    const historyEntry = await SellerRevenueHistory.create({
      sellerId,
      type,
      amount,
      balanceBefore: finalBalanceBefore,
      balanceAfter: finalBalanceAfter,
      reference,
      description,
      orderId,
      refundId,
      adminId,
      payoutRequestId,
      metadata,
    });

    logger.info(`[HistoryLogger] Seller revenue history logged: ${type} for seller ${sellerId}, amount: ${amount}, balance: ${finalBalanceBefore} → ${finalBalanceAfter}`);
    return historyEntry;
  } catch (error) {
    // Log error but don't throw - don't break main action
    logger.error(`[HistoryLogger] Failed to log seller revenue history:`, {
      sellerId,
      type,
      amount,
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

module.exports = {
  logBuyerWallet,
  logSellerRevenue,
};

