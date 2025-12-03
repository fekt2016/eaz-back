const mongoose = require('mongoose');

/**
 * Support Ticket Model
 * Handles support tickets from buyers, sellers, and admins
 */
const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
      required: true,
      default: () => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `TKT-${timestamp}-${random}`;
      },
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'userModel',
      required: true,
      index: true,
    },
    userModel: {
      type: String,
      required: true,
      enum: ['User', 'Seller', 'Admin'],
      default: 'User',
    },
    role: {
      type: String,
      required: true,
      enum: ['buyer', 'seller', 'admin'],
      index: true,
    },
    department: {
      type: String,
      required: true,
      enum: [
        'Orders & Delivery',
        'Payments & Billing',
        'Shipping & Returns',
        'Account & Profile',
        'Payout & Finance',
        'Listings',
        'Account Verification',
        'Infrastructure',
        'Compliance',
        'Payments',
        'Sellers',
        'Orders',
        'General',
      ],
      index: true,
    },
    priority: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    issueType: {
      type: String,
      required: false,
    },
    relatedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: false,
    },
    relatedPayoutId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentRequest',
      required: false,
    },
    relatedProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false,
      index: true,
    },
    relatedSellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: false,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['open', 'in_progress', 'awaiting_user', 'escalated', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: false,
    },
    attachments: [
      {
        url: String,
        filename: String,
        mimetype: String,
        size: Number,
      },
    ],
    internalNotes: [
      {
        note: String,
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: 'addedByModel',
        },
        addedByModel: {
          type: String,
          enum: ['Admin', 'User', 'Seller'],
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    resolvedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, priority: -1, createdAt: -1 });
supportTicketSchema.index({ department: 1, status: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });

// Virtual for message count
supportTicketSchema.virtual('messageCount', {
  ref: 'SupportMessage',
  localField: '_id',
  foreignField: 'ticketId',
  count: true,
});

// Pre-save middleware to update timestamps
supportTicketSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (this.status === 'resolved' && !this.resolvedAt) {
      this.resolvedAt = new Date();
    }
    if (this.status === 'closed' && !this.closedAt) {
      this.closedAt = new Date();
    }
  }
  next();
});

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

module.exports = SupportTicket;

