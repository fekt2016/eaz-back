const mongoose = require('mongoose');

const shippingSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['processing', 'in_transit', 'out_for_delivery', 'delivered'],
      default: 'processing',
    },
    trackingNumber: {
      type: String,
      unique: true,
    },
    baseCost: {
      type: Number,
      required: true,
    },
    buyerCharge: {
      type: Number,
      required: true,
    },
    sellerCharge: {
      type: Number,
      required: true,
    },
    companyFee: {
      type: Number,
      required: true,
    },
    deliveryAgent: {
      name: String,
      contact: String,
    },
    estimatedDays: {
      type: Number,
      required: true,
    },
    actualDeliveryDate: Date,
    deliveryProof: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Shipping', shippingSchema);
