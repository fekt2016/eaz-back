const mongoose = require('mongoose');
const Product = require('../../models/product/productModel');

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      immutable: true, // Prevent changing product after review creation
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }, // Link to order for verification
    orderItem: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'OrderItems',
      comment: 'Link to specific order item - enables one review per order item',
    },
    variantSKU: {
      type: String,
      trim: true,
      uppercase: true,
      comment: 'SKU of the variant/product at time of order - enables variant-specific reviews',
    },
    rating: { 
      type: Number, 
      min: 0.5, 
      max: 5,
      validate: {
        validator: function(value) {
          // Allow only 0.5 increments: 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5
          return value >= 0.5 && value <= 5 && (value * 2) % 1 === 0;
        },
        message: 'Rating must be between 0.5 and 5 in 0.5 increments (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)'
      }
    },
    title: String,
    review: { type: String, required: [true, 'Review can not be empty!'] },
    comment: String,
    images: [{ type: String }], // Array of image URLs
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'flagged'],
      default: 'pending',
    },
    moderationNotes: String, // Admin notes for moderation
    flaggedReason: String, // Reason why review was flagged
    sellerReply: {
      reply: String,
      repliedAt: Date,
      repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
    },
    helpfulVotes: { type: Number, default: 0 },
    nothelpfulVotes: { type: Number, default: 0 },
    reviewDate: { type: Date, default: Date.now() },
    verifiedPurchase: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true, // Automatically manage createdAt and updatedAt
  },
);

// Calculate number of ratings and average rating (only for approved reviews)
reviewSchema.statics.calcAverageRatings = async function (productId) {
  const stats = await this.aggregate([
    {
      $match: { 
        product: productId,
        status: 'approved' // Only count approved reviews
      },
    },
    {
      $group: {
        _id: '$product',
        nRating: { $sum: 1 },
        avgRating: { $avg: '$rating' },
      },
    },
  ]);

  const updateData =
    stats.length > 0
      ? {
          ratingsQuantity: stats[0].nRating,
          ratingsAverage: Math.round(stats[0].avgRating * 10) / 10, // Round to 1 decimal place
        }
      : {
          ratingsQuantity: 0,
          ratingsAverage: 4.5,
        };

  await Product.findByIdAndUpdate(productId, updateData);
  return stats[0] || { nRating: 0, avgRating: 4.5 };
};

// Middleware Hooks
reviewSchema.post('save', async function (doc) {
  await doc.constructor.calcAverageRatings(doc.product);
});
// Add index to prevent duplicate reviews - one review per order item
// If orderItem is provided, use it; otherwise fall back to product+user+order
reviewSchema.index({ orderItem: 1, user: 1 }, { unique: true, sparse: true });
reviewSchema.index({ product: 1, user: 1, order: 1 }, { unique: true, partialFilterExpression: { orderItem: { $exists: false } } });
// Index for status filtering
reviewSchema.index({ status: 1 });
// Index for product reviews query
reviewSchema.index({ product: 1, status: 1 });

// Enhanced static method to calculate ratings with distribution (only approved reviews)
reviewSchema.statics.calcAverageRatings = async function (productId) {
  const stats = await this.aggregate([
    {
      $match: { 
        product: productId,
        status: 'approved' // Only count approved reviews
      },
    },
    {
      $group: {
        _id: '$product',
        numReviews: { $sum: 1 },
        avgRating: { $avg: '$rating' },
        ratingDistribution: {
          $push: {
            $switch: {
              branches: [
                { case: { $gte: ['$rating', 4.5] }, then: 5 },
                { case: { $gte: ['$rating', 3.5] }, then: 4 },
                { case: { $gte: ['$rating', 2.5] }, then: 3 },
                { case: { $gte: ['$rating', 1.5] }, then: 2 },
                { case: { $gte: ['$rating', 0.5] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
      },
    },
    {
      $project: {
        numReviews: 1,
        avgRating: 1,
        ratingDistribution: {
          5: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'r',
                cond: { $eq: ['$$r', 5] },
              },
            },
          },
          4: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'r',
                cond: { $eq: ['$$r', 4] },
              },
            },
          },
          3: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'r',
                cond: { $eq: ['$$r', 3] },
              },
            },
          },
          2: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'r',
                cond: { $eq: ['$$r', 2] },
              },
            },
          },
          1: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'r',
                cond: { $eq: ['$$r', 1] },
              },
            },
          },
        },
      },
    },
  ]);

  if (stats.length > 0) {
    await mongoose.model('Product').findByIdAndUpdate(productId, {
      rating: Math.round(stats[0].avgRating * 10) / 10, // Round to 1 decimal place
      numReviews: stats[0].numReviews,
      ratingsQuantity: stats[0].numReviews,
      ratingsAverage: Math.round(stats[0].avgRating * 10) / 10, // Round to 1 decimal place
      ratingDistribution: stats[0].ratingDistribution,
    });
  } else {
    // Reset if no reviews
    await mongoose.model('Product').findByIdAndUpdate(productId, {
      rating: 0,
      numReviews: 0,
      ratingsQuantity: 0,
      ratingsAverage: 4.5,
      ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    });
  }
};

// Post-save hook - only recalculate if review is approved
reviewSchema.post('save', function (doc) {
  // Only recalculate ratings if review is approved
  if (doc.status === 'approved') {
    doc.constructor.calcAverageRatings(doc.product);
  }
});

// Post findOneAndDelete/Update hook - doc is the deleted/updated document
reviewSchema.post(/^findOneAnd/, function (doc) {
  if (doc && doc.product) {
    doc.constructor.calcAverageRatings(doc.product);
  }
});
const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;;
