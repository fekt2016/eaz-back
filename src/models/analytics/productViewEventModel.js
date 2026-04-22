const mongoose = require('mongoose');

const productViewEventSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    viewerKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ['buyer', 'seller', 'admin'],
      default: 'buyer',
    },
    sessionId: {
      type: String,
      default: null,
      trim: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

productViewEventSchema.index({
  product: 1,
  viewerKey: 1,
  viewedAt: -1,
});

const ProductViewEvent = mongoose.model(
  'ProductViewEvent',
  productViewEventSchema,
);

module.exports = ProductViewEvent;
