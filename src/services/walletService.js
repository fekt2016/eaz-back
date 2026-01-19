const Creditbalance = require('../models/user/creditbalanceModel');
const WalletTransaction = require('../models/user/walletTransactionModel');
const AppError = require('../utils/errors/appError');
const mongoose = require('mongoose');
const { logBuyerWallet } = require('./historyLogger');

/**
 * Get or create wallet for user
 * Ensures availableBalance is always correctly calculated
 */
async function getOrCreateWallet(userId) {
  let wallet = await Creditbalance.findOne({ user: userId });
  
  if (!wallet) {
    wallet = await Creditbalance.create({
      user: userId,
      balance: 0,
      availableBalance: 0,
      holdAmount: 0,
      currency: 'GHS',
    });
  } else {
    // CRITICAL: Recalculate availableBalance to ensure it's always correct
    // This handles cases where the database might have stale availableBalance
    const calculatedAvailableBalance = Math.max(0, (wallet.balance || 0) - (wallet.holdAmount || 0));
    
    // Only update if there's a discrepancy (more than 0.01 to avoid floating point issues)
    if (Math.abs((wallet.availableBalance || 0) - calculatedAvailableBalance) > 0.01) {
      console.log(`[getOrCreateWallet] Recalculating availableBalance for user ${userId}:`, {
        oldAvailableBalance: wallet.availableBalance,
        newAvailableBalance: calculatedAvailableBalance,
        balance: wallet.balance,
        holdAmount: wallet.holdAmount,
      });
      wallet.availableBalance = calculatedAvailableBalance;
      // Save without validation to prevent triggering pre-save hook unnecessarily
      await wallet.save({ validateBeforeSave: false });
    }
  }
  
  return wallet;
}

/**
 * Credit wallet (add money)
 * @param {ObjectId} userId - User ID
 * @param {Number} amount - Amount to credit
 * @param {String} type - Transaction type (CREDIT_TOPUP, CREDIT_REFUND, CREDIT_ADJUSTMENT)
 * @param {String} description - Transaction description
 * @param {String} reference - Unique reference (for idempotency)
 * @param {Object} metadata - Additional metadata
 * @param {ObjectId} orderId - Order ID if related to order
 * @returns {Promise<Object>} - Updated wallet and transaction
 */
async function creditWallet(userId, amount, type, description, reference = null, metadata = {}, orderId = null) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check for duplicate transaction by reference (idempotency)
    if (reference) {
      const existingTransaction = await WalletTransaction.findOne({ reference }).session(session);
      if (existingTransaction) {
        await session.abortTransaction();
        return {
          wallet: await Creditbalance.findOne({ user: userId }),
          transaction: existingTransaction,
          isDuplicate: true,
        };
      }
    }

    // Get or create wallet
    const wallet = await getOrCreateWallet(userId);
    const balanceBefore = wallet.balance || 0;
    const balanceAfter = balanceBefore + amount;

    // Update wallet balance
    wallet.balance = balanceAfter;
    wallet.availableBalance = Math.max(0, balanceAfter - (wallet.holdAmount || 0)); // Calculate availableBalance (balance - holdAmount)
    wallet.lastUpdated = new Date();

    // Add to embedded transactions (for backward compatibility)
    wallet.transactions.push({
      date: new Date(),
      amount: amount,
      type: type === 'CREDIT_TOPUP' ? 'topup' : type === 'CREDIT_REFUND' ? 'refund' : 'bonus',
      description,
      reference: reference || `WALLET-${Date.now()}`,
    });

    await wallet.save({ session });

    // Create wallet transaction
    const transaction = await WalletTransaction.create(
      [
        {
          user: userId,
          amount,
          type,
          description,
          reference,
          orderId,
          balanceBefore,
          balanceAfter,
          metadata,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // Log to history (non-blocking - don't fail if logging fails)
    const historyType = type === 'CREDIT_TOPUP' ? 'PAYSTACK_TOPUP' : 
                       type === 'CREDIT_REFUND' ? 'REFUND_CREDIT' :
                       type === 'CREDIT_ADJUSTMENT' ? 'ADMIN_ADJUST' : 'TOPUP';
    
    logBuyerWallet({
      userId,
      amount,
      type: historyType,
      description,
      reference,
      orderId,
      refundId: metadata.refundRequestId ? mongoose.Types.ObjectId(metadata.refundRequestId) : null,
      adminId: metadata.adjustedBy ? mongoose.Types.ObjectId(metadata.adjustedBy) : null,
      metadata,
    }).catch(err => {
      logger.error('[WalletService] Failed to log wallet history (non-critical);:', err);
    });

    // Send wallet credit email for significant transactions (not for every small operation)
    // Only send for: topups, refunds, and adjustments (not for internal operations)
    if (type === 'CREDIT_TOPUP' || type === 'CREDIT_REFUND' || type === 'CREDIT_ADJUSTMENT') {
      try {
        const emailDispatcher = require('../emails/emailDispatcher');
        const User = require('../models/user/userModel');
        const user = await User.findById(userId).select('name email').lean();
        
        if (user && user.email) {
          await emailDispatcher.sendWalletCredit(user, amount, description);
          logger.info(`[WalletService] ✅ Wallet credit email sent to ${user.email}`);
        }
      } catch (emailError) {
        logger.error('[WalletService] Error sending wallet credit email:', emailError.message);
        // Don't fail wallet operation if email fails
      }
    }

    // Send push notification for wallet top-up
    if (type === 'CREDIT_TOPUP') {
      try {
        const pushNotificationService = require('../services/pushNotificationService');
        await pushNotificationService.sendWalletNotification(
          userId,
          reference || transaction[0]?._id?.toString(),
          'Wallet Top-up Successful',
          `GH₵${amount.toFixed(2)} has been added to your wallet.`,
          'topup'
        );
        console.log(`[WalletService] ✅ Push notification sent for wallet top-up: GH₵${amount}`);
      } catch (pushError) {
        console.error('[WalletService] Error sending push notification:', pushError.message);
        // Don't fail wallet operation if push notification fails
      }
    }

    return {
      wallet,
      transaction: transaction[0],
      isDuplicate: false,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Debit wallet (deduct money)
 * @param {ObjectId} userId - User ID
 * @param {Number} amount - Amount to debit
 * @param {String} type - Transaction type (DEBIT_ORDER, DEBIT_ADJUSTMENT)
 * @param {String} description - Transaction description
 * @param {String} reference - Unique reference (for idempotency)
 * @param {Object} metadata - Additional metadata
 * @param {ObjectId} orderId - Order ID if related to order
 * @returns {Promise<Object>} - Updated wallet and transaction
 */
async function debitWallet(userId, amount, type, description, reference = null, metadata = {}, orderId = null) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check for duplicate transaction by reference (idempotency)
    if (reference) {
      const existingTransaction = await WalletTransaction.findOne({ reference }).session(session);
      if (existingTransaction) {
        await session.abortTransaction();
        return {
          wallet: await Creditbalance.findOne({ user: userId }),
          transaction: existingTransaction,
          isDuplicate: true,
        };
      }
    }

    // Get wallet
    const wallet = await Creditbalance.findOne({ user: userId }).session(session);
    
    if (!wallet) {
      throw new AppError('Wallet not found', 404);
    }

    const balanceBefore = wallet.balance || 0;

    // Check sufficient balance
    if (balanceBefore < amount) {
      await session.abortTransaction();
      throw new AppError(
        `Insufficient balance. Your balance is GH₵${balanceBefore.toFixed(2)}, but required amount is GH₵${amount.toFixed(2)}`,
        400
      );
    }

    const balanceAfter = balanceBefore - amount;

    // Update wallet balance
    wallet.balance = balanceAfter;
    wallet.availableBalance = balanceAfter;
    wallet.lastUpdated = new Date();

    // Add to embedded transactions (for backward compatibility)
    wallet.transactions.push({
      date: new Date(),
      amount: -amount,
      type: type === 'DEBIT_ORDER' ? 'purchase' : 'withdrawal',
      description,
      reference: reference || `WALLET-${Date.now()}`,
    });

    await wallet.save({ session });

    // Create wallet transaction
    const transaction = await WalletTransaction.create(
      [
        {
          user: userId,
          amount: -amount, // Store as negative for debits
          type,
          description,
          reference,
          orderId,
          balanceBefore,
          balanceAfter,
          metadata,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // Send push notification for wallet debit
    try {
      const pushNotificationService = require('../services/pushNotificationService');
      await pushNotificationService.sendWalletNotification(
        userId,
        reference || transaction[0]?._id?.toString(),
        'Wallet Debit',
        `GH₵${amount.toFixed(2)} has been deducted from your wallet.`,
        'debit'
      );
      console.log(`[WalletService] ✅ Push notification sent for wallet debit: GH₵${amount}`);
    } catch (pushError) {
      console.error('[WalletService] Error sending push notification:', pushError.message);
      // Don't fail wallet operation if push notification fails
    }

    // Log to history (non-blocking - don't fail if logging fails)
    const historyType = type === 'DEBIT_ORDER' ? 'ORDER_DEBIT' : 'ADMIN_ADJUST';
    
    logBuyerWallet({
      userId,
      amount: -amount, // Store as negative for debits
      type: historyType,
      description,
      reference,
      orderId,
      adminId: metadata.adjustedBy ? mongoose.Types.ObjectId(metadata.adjustedBy) : null,
      metadata,
    }).catch(err => {
      logger.error('[WalletService] Failed to log wallet history (non-critical);:', err);
    });

    // Send wallet debit email for order payments (not for every small operation)
    // Only send for: order payments and significant adjustments
    if (type === 'DEBIT_ORDER' || (type === 'DEBIT_ADJUSTMENT' && amount >= 10)) {
      try {
        const emailDispatcher = require('../emails/emailDispatcher');
        const User = require('../models/user/userModel');
const logger = require('../utils/logger');
        const user = await User.findById(userId).select('name email').lean();
        
        if (user && user.email) {
          await emailDispatcher.sendWalletDebit(user, amount, description);
          logger.info(`[WalletService] ✅ Wallet debit email sent to ${user.email}`);
        }
      } catch (emailError) {
        logger.error('[WalletService] Error sending wallet debit email:', emailError.message);
        // Don't fail wallet operation if email fails
      }
    }

    return {
      wallet,
      transaction: transaction[0],
      isDuplicate: false,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Get wallet balance
 */
async function getWalletBalance(userId) {
  const wallet = await getOrCreateWallet(userId);
  return wallet;
}

/**
 * Get wallet transactions with pagination
 */
async function getWalletTransactions(userId, options = {}) {
  const {
    page = 1,
    limit = 10,
    type = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

  const query = { user: userId };
  if (type) {
    query.type = type;
  }

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    WalletTransaction.countDocuments(query),
  ]);

  return {
    transactions,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  getOrCreateWallet,
  creditWallet,
  debitWallet,
  getWalletBalance,
  getWalletTransactions,
};

