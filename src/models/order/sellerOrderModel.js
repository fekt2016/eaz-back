const mongoose = require('mongoose');
const sellerOrderSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: true,
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: false, // Will be set after Order is created
  },
  items: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderItems',
      required: true,
    },
  ],
  subtotal: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    default: 0,
  },
  shippingCost: {
    type: Number,
    default: 0,
  },
  tax: {
    type: Number,
    default: 0,
    comment: 'Deprecated - use tax breakdown fields below',
  },
  // Tax breakdown fields (Ghana GRA)
  totalBasePrice: {
    type: Number,
    default: 0,
    comment: 'Total base price before VAT (seller revenue)',
  },
  totalVAT: {
    type: Number,
    default: 0,
    comment: 'Total VAT (12.5%)',
  },
  totalNHIL: {
    type: Number,
    default: 0,
    comment: 'Total NHIL (2.5%)',
  },
  totalGETFund: {
    type: Number,
    default: 0,
    comment: 'Total GETFund (2.5%)',
  },
  totalCovidLevy: {
    type: Number,
    default: 0,
    comment: 'Total COVID levy (1%)',
  },
  totalTax: {
    type: Number,
    default: 0,
    comment: 'Total of all taxes',
  },
  isVATInclusive: {
    type: Boolean,
    default: true,
    comment: 'Prices include 15% VAT',
  },
  commissionRate: {
    type: Number,
    default: 0, // Default to 0% platform commission
  },
  status: {
    type: String,
    enum: [
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'returned',
    ],
    default: 'pending',
  },
  tracking: {
    carrier: String,
    number: String,
    url: String,
  },
  payoutStatus: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'hold', 'reversed'],
    default: 'pending',
  },
  sellerPaymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'hold'],
    default: 'pending',
  },
  paymentReference: {
    type: String,
    // Paystack transaction reference
  },
  paidAt: {
    type: Date,
    // Timestamp when payment was completed
  },
  sellerType: {
    type: String,
    enum: ['regular', 'eazshop'],
    default: 'regular',
  },
  deliveryMethod: {
    type: String,
    enum: ['pickup_center', 'eazshop_dispatch', 'seller_delivery'],
  },
  pickupCenterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PickupCenter',
  },
  dispatchType: {
    type: String,
    enum: ['EAZSHOP', 'SELLER'],
  },
});
sellerOrderSchema.virtual('payoutAmount').get(async function () {
  // Tax removed - no longer included in total calculation
  const total = this.subtotal + this.shippingCost;
  // Get commission rate from platform settings if not set on order
  let commissionRate = this.commissionRate;
  if (commissionRate === undefined || commissionRate === null) {
    const PlatformSettings = require('../../platform/platformSettingsModel');
    const settings = await PlatformSettings.getSettings();
    commissionRate = settings.platformCommissionRate || 0;
  }
  return total - total * commissionRate;
});

// Indexes for seller orders list, payout, and order lookup
sellerOrderSchema.index({ seller: 1, status: 1 });
sellerOrderSchema.index({ order: 1 });
sellerOrderSchema.index({ payoutStatus: 1 });
sellerOrderSchema.index({ seller: 1, payoutStatus: 1 });

const SellerOrder = mongoose.model('SellerOrder', sellerOrderSchema);

module.exports = SellerOrder;;
