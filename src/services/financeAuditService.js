/**
 * Finance Audit Service
 * Comprehensive logging for all finance-related operations
 */

const SellerRevenueHistory = require('../models/history/sellerRevenueHistoryModel');
const fs = require('fs');
const path = require('path');

/**
 * Log finance operation with comprehensive details
 * @param {Object} params - Audit log parameters
 * @param {String} params.type - Operation type
 * @param {String} params.sellerId - Seller ID
 * @param {Number} params.amount - Amount involved
 * @param {Number} params.oldBalance - Balance before operation
 * @param {Number} params.newBalance - Balance after operation
 * @param {Number} params.oldPendingBalance - Pending balance before
 * @param {Number} params.newPendingBalance - Pending balance after
 * @param {String} params.requestId - Withdrawal request ID
 * @param {String} params.description - Human-readable description
 * @param {Object} params.metadata - Additional metadata
 */
exports.logFinanceOperation = async ({
  type,
  sellerId,
  amount = 0,
  oldBalance = 0,
  newBalance = 0,
  oldPendingBalance = 0,
  newPendingBalance = 0,
  requestId = null,
  description = '',
  metadata = {},
}) => {
  try {
    // Create audit log entry
    const auditLog = {
      type,
      sellerId,
      amount,
      balanceBefore: oldBalance,
      balanceAfter: newBalance,
      description,
      metadata: {
        ...metadata,
        oldPendingBalance,
        newPendingBalance,
        requestId: requestId?.toString(),
        timestamp: new Date(),
      },
    };

    // Save to database
    await SellerRevenueHistory.create(auditLog);

    // Also log to file for backup
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...auditLog,
    };

    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'finance-audit.log');
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');

    console.log(`[FinanceAudit] ✅ Logged ${type} for seller ${sellerId}:`, {
      amount,
      oldBalance,
      newBalance,
      oldPendingBalance,
      newPendingBalance,
      requestId,
    });
  } catch (error) {
    console.error('[FinanceAudit] ❌ Error logging finance operation:', error);
    // Don't throw - logging failures shouldn't break the operation
  }
};

/**
 * Log withdrawal creation
 */
exports.logWithdrawalCreated = async (sellerId, amount, requestId, oldPendingBalance, newPendingBalance) => {
  return exports.logFinanceOperation({
    type: 'WITHDRAWAL_CREATED',
    sellerId,
    amount,
    oldPendingBalance,
    newPendingBalance,
    requestId,
    description: `Withdrawal request created: GH₵${amount.toFixed(2)}`,
  });
};

/**
 * Log withdrawal refund
 */
exports.logWithdrawalRefunded = async (sellerId, amount, requestId, oldPendingBalance, newPendingBalance, reason = '') => {
  return exports.logFinanceOperation({
    type: 'WITHDRAWAL_REFUNDED',
    sellerId,
    amount,
    oldPendingBalance,
    newPendingBalance,
    requestId,
    description: `Withdrawal refunded: GH₵${amount.toFixed(2)}${reason ? ` - ${reason}` : ''}`,
    metadata: { reason },
  });
};

/**
 * Log withdrawal failure
 */
exports.logWithdrawalFailed = async (sellerId, amount, requestId, oldPendingBalance, newPendingBalance, reason = '') => {
  return exports.logFinanceOperation({
    type: 'WITHDRAWAL_FAILED',
    sellerId,
    amount,
    oldPendingBalance,
    newPendingBalance,
    requestId,
    description: `Withdrawal failed: GH₵${amount.toFixed(2)}${reason ? ` - ${reason}` : ''}`,
    metadata: { reason },
  });
};

/**
 * Log OTP expired
 */
exports.logOtpExpired = async (sellerId, amount, requestId, oldPendingBalance, newPendingBalance) => {
  return exports.logFinanceOperation({
    type: 'OTP_EXPIRED',
    sellerId,
    amount,
    oldPendingBalance,
    newPendingBalance,
    requestId,
    description: `OTP expired - refunded: GH₵${amount.toFixed(2)}`,
  });
};

/**
 * Log payout abandoned
 */
exports.logPayoutAbandoned = async (sellerId, amount, requestId, oldPendingBalance, newPendingBalance) => {
  return exports.logFinanceOperation({
    type: 'PAYOUT_ABANDONED',
    sellerId,
    amount,
    oldPendingBalance,
    newPendingBalance,
    requestId,
    description: `Payout abandoned - refunded: GH₵${amount.toFixed(2)}`,
  });
};

module.exports = exports;

