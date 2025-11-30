const mongoose = require('mongoose');

const paymentRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: false,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'GHS',
  },
  paymentMethod: {
    type: String,
    enum: ['bank', 'mtn_momo', 'vodafone_cash', 'airtel_tigo_money'],
  },
  paymentDetails: {
    type: Object,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'rejected', 'success', 'failed', 'processing', 'approved', 'awaiting_paystack_otp'],
    default: 'pending',
  },
  transactionId: String,
  rejectionReason: String,
  processedAt: Date,
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  // Paystack transfer details (for mobile money transfers)
  paystackRecipientCode: {
    type: String,
    default: null,
  },
  paystackTransferId: {
    type: String,
    default: null,
  },
  paystackTransferCode: {
    type: String,
    default: null,
  },
  paystackReference: {
    type: String,
    default: null,
  },
  // PIN requirement for mobile money transfers
  requiresPin: {
    type: Boolean,
    default: false,
  },
  pinSubmitted: {
    type: Boolean,
    default: false,
  },
  // Metadata for additional information
  metadata: {
    type: Object,
    default: {},
  },
  // Withholding tax fields
  withholdingTax: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Withholding tax amount deducted from withdrawal',
  },
  withholdingTaxRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 1,
    comment: 'Withholding tax rate applied (0.03 for individual, 0.15 for company)',
  },
  amountRequested: {
    type: Number,
    required: true,
    comment: 'Original withdrawal amount requested by seller',
  },
  amountPaidToSeller: {
    type: Number,
    default: 0,
    comment: 'Final amount paid to seller after withholding tax deduction',
  },
  sellerBalanceBefore: {
    type: Number,
    default: 0,
    comment: 'Seller balance before withdrawal',
  },
  sellerBalanceAfter: {
    type: Number,
    default: 0,
    comment: 'Seller balance after withdrawal',
  },
  paymentDate: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Deactivation flag - when seller "deletes" a withdrawal, it's deactivated instead of deleted
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  deactivatedAt: {
    type: Date,
    default: null,
  },
  // Admin approval tracking
  approvedByAdmin: {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      default: null,
    },
    timestamp: {
      type: Date,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  // Admin rejection tracking
  rejectedByAdmin: {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      default: null,
    },
    timestamp: {
      type: Date,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  // Full audit history (append-only)
  auditHistory: [
    {
      action: {
        type: String,
        enum: ['approved', 'rejected'],
        required: true,
      },
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      role: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      ipAddress: {
        type: String,
        default: null,
      },
      userAgent: {
        type: String,
        default: null,
      },
    },
  ],
});

const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

module.exports = PaymentRequest;
