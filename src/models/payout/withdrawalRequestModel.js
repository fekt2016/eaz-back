/**
 * Withdrawal Request Model
 * Tracks seller withdrawal requests and Paystack transfer status
 */

const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: [true, 'Withdrawal request must belong to a seller'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Withdrawal request must have an amount'],
      min: [0, 'Amount cannot be negative'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'processing', 'paid', 'failed', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    payoutMethod: {
      type: String,
      enum: ['bank', 'mtn_momo', 'vodafone_cash', 'airtel_tigo_money'],
      required: [true, 'Payout method is required'],
    },
    paymentDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Paystack transfer details
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
    // Admin processing details
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    // Transaction record
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);



// Pre-save middleware to update updatedAt
withdrawalRequestSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for formatted amount
withdrawalRequestSchema.virtual('formattedAmount').get(function () {
  return `GH₵${this.amount.toFixed(2)}`;
});

const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

module.exports = WithdrawalRequest;

