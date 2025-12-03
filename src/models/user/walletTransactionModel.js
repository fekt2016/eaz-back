const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: [
        'CREDIT_TOPUP',      // Money added via Paystack
        'DEBIT_ORDER',       // Money deducted for order
        'CREDIT_REFUND',     // Money refunded from order
        'DEBIT_ADJUSTMENT',  // Admin deducted money
        'CREDIT_ADJUSTMENT', // Admin added money
      ],
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    reference: {
      type: String,
      index: true,
      sparse: true, // Allow null but index when present
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
      sparse: true,
    },
    balanceBefore: {
      type: Number,
      default: 0,
    },
    balanceAfter: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ user: 1, type: 1, createdAt: -1 });
walletTransactionSchema.index({ reference: 1 }, { unique: true, sparse: true });
walletTransactionSchema.index({ orderId: 1 });

// Virtual for transaction direction (credit/debit)
walletTransactionSchema.virtual('isCredit').get(function () {
  return this.type.startsWith('CREDIT_');
});

walletTransactionSchema.virtual('isDebit').get(function () {
  return this.type.startsWith('DEBIT_');
});

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = WalletTransaction;

