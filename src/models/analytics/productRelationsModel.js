const mongoose = require('mongoose');

const productRelationsSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    relatedProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    relationType: {
      type: String,
      enum: ['also_bought', 'also_viewed', 'similar'],
      required: true,
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
    },
  },
  {
    timestamps: true,
  }
);



const ProductRelations = mongoose.model('ProductRelations', productRelationsSchema);

module.exports = ProductRelations;

