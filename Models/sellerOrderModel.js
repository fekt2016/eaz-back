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
    required: true,
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
  },
  commissionRate: {
    type: Number,
    default: 0.15, // Default to 15% platform commission
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
    enum: ['pending', 'processing', 'paid', 'hold'],
    default: 'pending',
  },
});
sellerOrderSchema.virtual('payoutAmount').get(function () {
  const total = this.subtotal + this.shippingCost + this.tax;
  return total - total * this.commissionRate;
});
const SellerOrder = mongoose.model('SellerOrder', sellerOrderSchema);

module.exports = SellerOrder;
