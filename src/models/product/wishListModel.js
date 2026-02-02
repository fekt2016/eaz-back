const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      // required: true,
      // unique: true, // Removed - using sparse index instead
    },
    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Add session field for guest wishlists
    sessionId: {
      type: String,
      sparse: true,
      index: true, // Single index for findBySessionId (sparse allows nulls)
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);
// Virtual for product count
wishlistSchema.virtual('productCount').get(function () {
  return this.products.length;
});

// Static method to get wishlist by user ID
wishlistSchema.statics.findByUserId = function (userId) {
  return this.findOne({ user: userId }).populate(
    'products.product',
    'name price images seller',
  );
};

// Static method to get wishlist by session ID
wishlistSchema.statics.findBySessionId = function (sessionId) {
  return this.findOne({ sessionId }).populate(
    'products.product',
    'name price images seller',
  );
};

// Method to merge another wishlist into this one
wishlistSchema.methods.mergeWishlist = function (otherWishlist) {
  const existingProductIds = new Set(
    this.products.map((item) => item.product.toString()),
  );

  // Add products from other wishlist that don't already exist
  otherWishlist.products.forEach((item) => {
    if (!existingProductIds.has(item.product.toString())) {
      this.products.push({
        product: item.product,
        addedAt: item.addedAt || new Date(),
      });
    }
  });

  return this.save();
};

// Indexes for user and guest wishlist lookup (sessionId: field has sparse; avoid duplicate index)
wishlistSchema.index({ user: 1 }, { sparse: true });

const Wishlist = mongoose.model('Wishlist', wishlistSchema);

module.exports = Wishlist;;
