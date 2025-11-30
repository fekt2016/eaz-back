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
});

const OrderItems = new mongoose.model('OrderItems', OrderItemSchema);

module.exports = OrderItems;;
