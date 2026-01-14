const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    },
    description: {
      type: String,
      required: true,
    },
    reference: {
      type: String,
      sparse: true, // Allow null but index when present
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
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



// Virtual for transaction direction (credit/debit)
walletTransactionSchema.virtual('isCredit').get(function () {
  return this.type.startsWith('CREDIT_');
});

walletTransactionSchema.virtual('isDebit').get(function () {
  return this.type.startsWith('DEBIT_');
});

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = WalletTransaction;

