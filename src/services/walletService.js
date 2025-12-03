const Creditbalance = require('../models/user/creditbalanceModel');
const WalletTransaction = require('../models/user/walletTransactionModel');
const AppError = require('../utils/errors/appError');
const mongoose = require('mongoose');
const { logBuyerWallet } = require('./historyLogger');

/**
 * Get or create wallet for user
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
    wallet.availableBalance = balanceAfter; // Assuming no holds for now
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
      console.error('[WalletService] Failed to log wallet history (non-critical):', err);
    });

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
      console.error('[WalletService] Failed to log wallet history (non-critical):', err);
    });

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

