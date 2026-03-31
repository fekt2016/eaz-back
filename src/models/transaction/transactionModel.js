const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: false,
      default: null,
    },
    sellerOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SellerOrder',
      required: false,
      default: null,
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'completed',
    },
    payoutRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentRequest',
      required: false,
      default: null,
    },
    // What generated this transaction — replaces querying metadata or checking field existence
    source: {
      type: String,
      enum: [
        'order_delivery',      // credit: seller earned from a delivered order
        'admin_adjustment',    // credit/debit: admin reconciliation or correction
        'withdrawal',          // debit: seller payout (pending → completed when paid)
        'withdrawal_refund',   // credit: refund back to seller when withdrawal deleted/reversed
        'refund_reversal',     // debit: order refund claws back seller earnings
      ],
      required: false,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
transactionSchema.index({ seller: 1, createdAt: -1 });
transactionSchema.index({ seller: 1, type: 1, status: 1 });
transactionSchema.index({ seller: 1, source: 1, status: 1 });
transactionSchema.index({ seller: 1, order: 1 });
transactionSchema.index({ order: 1 });
transactionSchema.index({ sellerOrder: 1 });
transactionSchema.index({ payoutRequest: 1 });
// Idempotency: one delivery credit per seller per sellerOrder
transactionSchema.index(
  { sellerOrder: 1, seller: 1, source: 1 },
  { unique: true, partialFilterExpression: { source: 'order_delivery' } }
);


const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;

