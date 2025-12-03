const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    sellerOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SellerOrder',
      required: false,
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


const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;

