const mongoose = require('mongoose');

/**
 * Deleted Order Model
 * Stores backup of orders before deletion
 * Used to track deleted orders and their revenue impact
 */
const deletedOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    totalPrice: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    revenueAmount: {
      type: Number,
      default: 0,
      comment: 'Amount that was deducted from admin revenue',
    },
    revenueAdded: {
      type: Boolean,
      default: false,
      comment: 'Whether revenue was added for this order',
    },
    paymentStatus: {
      type: String,
    },
    paymentMethod: {
      type: String,
    },
    orderStatus: {
      type: String,
    },
    currentStatus: {
      type: String,
    },
    orderItems: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OrderItem',
      },
    ],
    shippingAddress: {
      type: mongoose.Schema.Types.Mixed,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    deletedByRole: {
      type: String,
      enum: ['admin', 'system'],
      default: 'admin',
    },
    // Store full order data as JSON for complete backup
    fullOrderData: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries


const DeletedOrder = mongoose.model('DeletedOrder', deletedOrderSchema);

module.exports = DeletedOrder;

