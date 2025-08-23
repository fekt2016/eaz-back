const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      // required: true,
      unique: true,
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
      sparse: true, // Allows null values but ensures uniqueness for non-null values
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Index for better performance
// wishlistSchema.index({ user: 1 });
// wishlistSchema.index({ sessionId: 1 });
// wishlistSchema.index({ 'products.product': 1 });

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

const Wishlist = mongoose.model('Wishlist', wishlistSchema);

module.exports = Wishlist;
