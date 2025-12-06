/**
 * Withdrawal Cleanup Job
 * Automatically refunds stuck withdrawals that have been in processing/awaiting_otp status too long
 * Runs every hour via cron
 */

const cron = require('node-cron');
const mongoose = require('mongoose');
const PaymentRequest = require('../models/payment/paymentRequestModel');
const WithdrawalRequest = require('../models/payout/withdrawalRequestModel');
const Seller = require('../models/user/sellerModel');
const financeAudit = require('../services/financeAuditService');

// Stuck withdrawal timeout: 24 hours
const STUCK_WITHDRAWAL_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clean up stuck withdrawals
 * Refunds withdrawals that have been stuck in processing/awaiting_otp status for more than 24 hours
 */
async function cleanupStuckWithdrawals() {
  console.log('[WithdrawalCleanupJob] 🔍 Starting cleanup of stuck withdrawals...');
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const cutoffTime = new Date(Date.now() - STUCK_WITHDRAWAL_TIMEOUT_MS);
    
    // Find stuck PaymentRequests
    const stuckPaymentRequests = await PaymentRequest.find({
      status: { $in: ['awaiting_paystack_otp', 'processing', 'otp_expired'] },
      updatedAt: { $lt: cutoffTime },
      reversed: { $ne: true }, // Not already reversed
    }).session(session);
    
    // Find stuck WithdrawalRequests
    const stuckWithdrawalRequests = await WithdrawalRequest.find({
      status: { $in: ['awaiting_paystack_otp', 'processing', 'otp_expired'] },
      updatedAt: { $lt: cutoffTime },
      reversed: { $ne: true },
    }).session(session);
    
    const allStuck = [...stuckPaymentRequests, ...stuckWithdrawalRequests];
    
    console.log(`[WithdrawalCleanupJob] Found ${allStuck.length} stuck withdrawals`);
    
    const refunded = [];
    const errors = [];
    
    for (const withdrawal of allStuck) {
      try {
        const sellerId = withdrawal.seller?._id || withdrawal.seller;
        const seller = await Seller.findById(sellerId).session(session);
        
        if (!seller) {
          console.warn(`[WithdrawalCleanupJob] Seller ${sellerId} not found for withdrawal ${withdrawal._id}`);
          continue;
        }
        
        const amountRequested = withdrawal.amountRequested || withdrawal.amount || 0;
        const oldPendingBalance = seller.pendingBalance || 0;
        
        // Refund from pendingBalance
        if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
          seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
          seller.calculateWithdrawableBalance();
          await seller.save({ session });
          
          // Update withdrawal status
          withdrawal.status = 'failed';
          withdrawal.otpSessionStatus = 'abandoned';
          if (!withdrawal.metadata) {
            withdrawal.metadata = {};
          }
          withdrawal.metadata.autoRefundedAt = new Date();
          withdrawal.metadata.autoRefundReason = 'Stuck withdrawal auto-refunded after 24 hours';
          withdrawal.metadata.pendingBalanceBefore = oldPendingBalance;
          withdrawal.metadata.pendingBalanceAfter = seller.pendingBalance;
          await withdrawal.save({ session });
          
          // Log finance audit
          await financeAudit.logPayoutAbandoned(
            sellerId,
            amountRequested,
            withdrawal._id,
            oldPendingBalance,
            seller.pendingBalance
          );
          
          refunded.push({
            withdrawalId: withdrawal._id,
            sellerId,
            amount: amountRequested,
            oldPendingBalance,
            newPendingBalance: seller.pendingBalance,
          });
          
          console.log(`[WithdrawalCleanupJob] ✅ Refunded stuck withdrawal ${withdrawal._id} for seller ${sellerId}: GH₵${amountRequested}`);
        } else {
          console.warn(`[WithdrawalCleanupJob] ⚠️ Cannot refund withdrawal ${withdrawal._id}: pendingBalance (${oldPendingBalance}) < amount (${amountRequested})`);
        }
      } catch (error) {
        console.error(`[WithdrawalCleanupJob] ❌ Error processing withdrawal ${withdrawal._id}:`, error);
        errors.push({ withdrawalId: withdrawal._id, error: error.message });
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    console.log(`[WithdrawalCleanupJob] ✅ Cleanup complete: ${refunded.length} refunded, ${errors.length} errors`);
    
    return {
      success: true,
      refunded: refunded.length,
      errors: errors.length,
      details: { refunded, errors },
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('[WithdrawalCleanupJob] ❌ Error in cleanup:', error);
    throw error;
  }
}

/**
 * Start the cron job
 * Runs every hour at minute 0
 */
function startCleanupJob() {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log('[WithdrawalCleanupJob] 🕐 Running scheduled cleanup...');
    try {
      await cleanupStuckWithdrawals();
    } catch (error) {
      console.error('[WithdrawalCleanupJob] ❌ Scheduled cleanup failed:', error);
    }
  });
  
  console.log('[WithdrawalCleanupJob] ✅ Cleanup job scheduled (runs every hour)');
}

/**
 * Manual cleanup trigger (for testing or admin use)
 */
module.exports = {
  cleanupStuckWithdrawals,
  startCleanupJob,
};

