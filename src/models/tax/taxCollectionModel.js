const mongoose = require('mongoose');

/**
 * Tax Collection Model
 * Tracks withholding tax collected from seller withdrawals
 */
const taxCollectionSchema = new mongoose.Schema({
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: true,
    index: true,
  },
  withdrawalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentRequest',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Tax amount cannot be negative'],
  },
  rate: {
    type: Number,
    required: true,
    min: [0, 'Tax rate cannot be negative'],
    max: [1, 'Tax rate cannot exceed 100%'],
    comment: 'Withholding tax rate applied (0.03 for individual, 0.15 for company)',
  },
  taxCategory: {
    type: String,
    enum: ['individual', 'company'],
    required: true,
  },
  dateCollected: {
    type: Date,
    default: Date.now,
    index: true,
  },
  remitted: {
    type: Boolean,
    default: false,
    index: true,
  },
  remittedAt: {
    type: Date,
    default: null,
  },
  remittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  metadata: {
    type: Object,
    default: {},
    comment: 'Additional information about the tax collection',
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries


const TaxCollection = mongoose.model('TaxCollection', taxCollectionSchema);

module.exports = TaxCollection;

