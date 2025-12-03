const mongoose = require('mongoose');

const productRelationsSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    relatedProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    relationType: {
      type: String,
      enum: ['also_bought', 'also_viewed', 'similar'],
      required: true,
      index: true,
    },
    frequency: {
      type: Number,
      default: 1,
      min: 0,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index to prevent duplicates
productRelationsSchema.index(
  { productId: 1, relatedProductId: 1, relationType: 1 },
  { unique: true }
);

// Index for efficient queries
productRelationsSchema.index({ productId: 1, relationType: 1, score: -1 });
productRelationsSchema.index({ lastUpdated: -1 });

const ProductRelations = mongoose.model('ProductRelations', productRelationsSchema);

module.exports = ProductRelations;

