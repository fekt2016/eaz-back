const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant',
  },
  price: {
    type: Number,
    required: true,
    min: 0,
    comment: 'VAT-inclusive price (what seller entered)',
  },
  // Tax breakdown fields (computed from price)
  basePrice: {
    type: Number,
    default: 0,
    comment: 'Price before VAT (seller revenue)',
  },
  vat: {
    type: Number,
    default: 0,
    comment: 'VAT amount (12.5%)',
  },
  nhil: {
    type: Number,
    default: 0,
    comment: 'NHIL amount (2.5%)',
  },
  getfund: {
    type: Number,
    default: 0,
    comment: 'GETFund amount (2.5%)',
  },
  covidLevy: {
    type: Number,
    default: 0,
    comment: 'COVID levy (1% on base price)',
  },
  totalTaxes: {
    type: Number,
    default: 0,
    comment: 'Total of all taxes (VAT + NHIL + GETFund + COVID levy)',
  },
  isVATInclusive: {
    type: Boolean,
    default: true,
    comment: 'Price includes 15% VAT (VAT + NHIL + GETFund)',
  },
  // Item-level refund fields
  refundStatus: {
    type: String,
    enum: ['none', 'requested', 'seller_review', 'admin_review', 'approved', 'rejected'],
    default: 'none',
    index: true,
  },
  refundRequestedQty: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Quantity requested for refund',
  },
  refundApprovedQty: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Quantity approved for refund',
  },
  refundReason: {
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
  },
  refundReasonText: {
    type: String,
    maxlength: 500,
  },
  refundImages: [{
    type: String,
    comment: 'URLs to refund-related images',
  }],
  refundAmount: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Refund amount for this item (can be partial)',
  },
  refundSellerNote: {
    type: String,
    maxlength: 500,
    comment: 'Seller notes on the refund request',
  },
  refundAdminNote: {
    type: String,
    maxlength: 500,
    comment: 'Admin internal notes on the refund',
  },
  refundRequestedAt: {
    type: Date,
  },
  refundApprovedAt: {
    type: Date,
  },
  refundProcessedBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'refundProcessedByModel',
  },
  refundProcessedByModel: {
    type: String,
    enum: ['Admin', 'Seller'],
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    comment: 'Seller who sold this item (for item-level refund tracking)',
  },
});

const OrderItems = new mongoose.model('OrderItems', OrderItemSchema);

module.exports = OrderItems;;
