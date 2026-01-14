const mongoose = require('mongoose');

const trendingProductsSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true,
    },
    views24h: {
      type: Number,
      default: 0,
      min: 0,
    },
    purchases24h: {
      type: Number,
      default: 0,
      min: 0,
    },
    addToCart24h: {
      type: Number,
      default: 0,
      min: 0,
    },
    wishlist24h: {
      type: Number,
      default: 0,
      min: 0,
    },
    trendingScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastComputed: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);



// Method to calculate trending score
trendingProductsSchema.methods.calculateScore = function () {
  // Weighted scoring: purchases (highest), views, cart, wishlist
  this.trendingScore =
    this.purchases24h * 10 +
    this.views24h * 1 +
    this.addToCart24h * 3 +
    this.wishlist24h * 2;
  return this.trendingScore;
};

const TrendingProducts = mongoose.model('TrendingProducts', trendingProductsSchema);

module.exports = TrendingProducts;

