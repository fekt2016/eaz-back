const mongoose = require('mongoose');

/**
 * WalletHistory Model
 * Tracks complete balance history for buyer wallets
 * Every wallet transaction creates a history entry with balanceBefore and balanceAfter
 */
const walletHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'TOPUP',
        'PAYSTACK_TOPUP',
        'ORDER_DEBIT',
        'REFUND_CREDIT',
        'ADMIN_ADJUST',
        'TRANSFER',
      ],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      comment: 'Transaction amount (positive for credits, negative for debits)',
    },
    balanceBefore: {
      type: Number,
      required: true,
      default: 0,
      comment: 'Wallet balance before this transaction',
    },
    balanceAfter: {
      type: Number,
      required: true,
      default: 0,
      comment: 'Wallet balance after this transaction',
    },
    reference: {
      type: String,
      index: true,
      sparse: true,
      comment: 'Unique reference for idempotency (Paystack ref, order ref, etc.)',
    },
    description: {
      type: String,
      required: true,
      comment: 'Human-readable description of the transaction',
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
      sparse: true,
      comment: 'Related order ID if transaction is order-related',
    },
    refundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RefundRequest',
      index: true,
      sparse: true,
      comment: 'Related refund ID if transaction is refund-related',
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      index: true,
      sparse: true,
      comment: 'Admin ID if transaction was initiated by admin',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      comment: 'Additional metadata (Paystack details, etc.)',
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
walletHistorySchema.index({ userId: 1, createdAt: -1 });
walletHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });
walletHistorySchema.index({ reference: 1 }, { unique: true, sparse: true });
walletHistorySchema.index({ orderId: 1 });
walletHistorySchema.index({ refundId: 1 });

// Virtual for transaction direction
walletHistorySchema.virtual('isCredit').get(function () {
  return ['TOPUP', 'PAYSTACK_TOPUP', 'REFUND_CREDIT', 'ADMIN_ADJUST', 'TRANSFER'].includes(this.type);
});

walletHistorySchema.virtual('isDebit').get(function () {
  return this.type === 'ORDER_DEBIT';
});

const WalletHistory = mongoose.model('WalletHistory', walletHistorySchema);

module.exports = WalletHistory;

