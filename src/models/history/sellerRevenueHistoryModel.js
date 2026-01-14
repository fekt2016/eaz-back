const mongoose = require('mongoose');

/**
 * SellerRevenueHistory Model
 * Tracks complete balance history for seller revenue
 * Every revenue change creates a history entry with balanceBefore and balanceAfter
 */
const sellerRevenueHistorySchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'ORDER_EARNING',
        'REFUND_DEDUCTION',
        'PAYOUT',
        'ADMIN_ADJUST',
        'CORRECTION',
        'REVERSAL',
        'WITHDRAWAL_CREATED',
        'WITHDRAWAL_REFUNDED',
        'WITHDRAWAL_FAILED',
        'WITHDRAWAL_PAID',
        'OTP_EXPIRED',
        'OTP_FAILED',
        'PAYOUT_ABANDONED',
      ],
      required: true,
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
      comment: 'Seller balance before this transaction',
    },
    balanceAfter: {
      type: Number,
      required: true,
      default: 0,
      comment: 'Seller balance after this transaction',
    },
    reference: {
      type: String,
      sparse: true,
      comment: 'Unique reference for idempotency (order ref, payout ref, etc.)',
    },
    description: {
      type: String,
      required: true,
      comment: 'Human-readable description of the transaction',
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      sparse: true,
      comment: 'Related order ID if transaction is order-related',
    },
    refundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RefundRequest',
      sparse: true,
      comment: 'Related refund ID if transaction is refund-related',
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      sparse: true,
      comment: 'Admin ID if transaction was initiated by admin',
    },
    payoutRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentRequest',
      sparse: true,
      comment: 'Related payout request ID if transaction is payout-related',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      comment: 'Additional metadata (commission details, etc.)',
    },
  },
  {
    timestamps: true,
  }
);




// Virtual for transaction direction
sellerRevenueHistorySchema.virtual('isCredit').get(function () {
  return ['ORDER_EARNING', 'ADMIN_ADJUST', 'CORRECTION'].includes(this.type);
});

sellerRevenueHistorySchema.virtual('isDebit').get(function () {
  return ['REFUND_DEDUCTION', 'PAYOUT', 'REVERSAL'].includes(this.type);
});

const SellerRevenueHistory = mongoose.model('SellerRevenueHistory', sellerRevenueHistorySchema);

module.exports = SellerRevenueHistory;

