const mongoose = require('mongoose');

/**
 * RefundRequest Model
 * Supports both whole-order refunds (backward compatible) and item-level refunds
 */
const refundRequestSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Item-level refund items (new structure)
  items: [{
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderItems',
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    refundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      enum: [
        'defective_product',
        'wrong_item',
        'not_as_described',
        'damaged_during_shipping',
        'late_delivery',
        'changed_mind',
        'duplicate_order',
        'other',
      ],
      required: true,
    },
    reasonText: {
      type: String,
      maxlength: 500,
    },
    images: [{
      type: String,
    }],
    status: {
      type: String,
      enum: ['requested', 'seller_review', 'admin_review', 'approved', 'rejected'],
      default: 'requested',
    },
    sellerNote: {
      type: String,
      maxlength: 500,
    },
    adminNote: {
      type: String,
      maxlength: 500,
    },
  }],
  // Whole-order refund fields (backward compatibility)
  totalRefundAmount: {
    type: Number,
    required: true,
    min: 0,
    comment: 'Total refund amount (sum of items or whole order)',
  },
  reason: {
    type: String,
    enum: [
      'defective_product',
      'wrong_item',
      'not_as_described',
      'damaged_during_shipping',
      'late_delivery',
      'changed_mind',
      'duplicate_order',
      'other',
    ],
    comment: 'Main reason (for whole-order refunds, backward compatibility)',
  },
  reasonText: {
    type: String,
    maxlength: 500,
    comment: 'Main reason text (for whole-order refunds, backward compatibility)',
  },
  images: [{
    type: String,
    comment: 'Main images (for whole-order refunds, backward compatibility)',
  }],
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'seller_review', 'admin_review', 'approved', 'rejected', 'processing', 'completed'],
    default: 'pending',
  },
  // Seller review
  sellerReviewed: {
    type: Boolean,
    default: false,
  },
  sellerReviewDate: {
    type: Date,
  },
  sellerDecision: {
    type: String,
    enum: ['approve_return', 'reject_return', null],
  },
  sellerNote: {
    type: String,
    maxlength: 500,
  },
  // Seller resolution: refund or offer replacement
  resolutionType: {
    type: String,
    enum: ['refund', 'replacement'],
    default: 'refund',
    comment: 'When seller approves: refund = process refund, replacement = offer new item instead',
  },
  resolutionNote: {
    type: String,
    maxlength: 500,
    comment: 'Seller note when offering replacement (e.g. when new item will ship)',
  },
  // Admin review
  adminReviewed: {
    type: Boolean,
    default: false,
  },
  adminReviewDate: {
    type: Date,
  },
  adminDecision: {
    type: String,
    enum: ['approve', 'approve_partial', 'reject', null],
  },
  adminNote: {
    type: String,
    maxlength: 500,
  },
  finalRefundAmount: {
    type: Number,
    min: 0,
    comment: 'Final approved refund amount (may differ from requested)',
  },
  requireReturn: {
    type: Boolean,
    default: false,
    comment: 'Whether item return is required',
  },
  // Buyer return shipping selection
  returnShippingMethod: {
    type: String,
    enum: ['drop_off', 'pickup', null],
    default: null,
    comment: 'Buyer-selected return shipping method: drop_off or pickup',
  },
  returnShippingSelectedAt: {
    type: Date,
    comment: 'When buyer selected the return shipping method',
  },
  // Processing
  processedAt: {
    type: Date,
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'processedByModel',
  },
  processedByModel: {
    type: String,
    enum: ['Admin', 'Seller'],
  },
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});


// Virtual for backward compatibility - total refund amount
refundRequestSchema.virtual('refundAmount').get(function() {
  return this.totalRefundAmount;
});

// Method to check if all items are approved
refundRequestSchema.methods.allItemsApproved = function() {
  if (!this.items || this.items.length === 0) {
    return this.status === 'approved';
  }
  return this.items.every(item => item.status === 'approved');
};

// Method to check if all items are rejected
refundRequestSchema.methods.allItemsRejected = function() {
  if (!this.items || this.items.length === 0) {
    return this.status === 'rejected';
  }
  return this.items.every(item => item.status === 'rejected');
};

// Indexes for order/buyer lists and status filter
refundRequestSchema.index({ order: 1 });
refundRequestSchema.index({ buyer: 1, createdAt: -1 });
refundRequestSchema.index({ status: 1 });

const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);

module.exports = RefundRequest;

