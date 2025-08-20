const mongoose = require('mongoose');
const Product = require('../Models/productModel');

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      immutable: true, // Prevent changing product after review creation
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rating: { type: Number, min: 1, max: 5 },
    title: String,
    review: { type: String, required: [true, 'Review can not be empty!'] },
    comment: String,
    helpfulVotes: { type: Number, default: 0 },
    nothelpfulVotes: { type: Number, default: 0 },
    reviewDate: { type: Date, default: Date.now() },
    verifiedPurchase: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now() },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Calculate number of ratings and average rating
reviewSchema.statics.calcAverageRatings = async function (productId) {
  const stats = await this.aggregate([
    {
      $match: { product: productId },
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
          ratingsAverage: stats[0].avgRating,
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

reviewSchema.pre(/^findOneAnd/, async function (next) {
  this.reviewDoc = await this.model.findOne(this.getQuery());
  next();
});

reviewSchema.post(/^findOneAnd/, async function () {
  if (this.reviewDoc) {
    await this.reviewDoc.constructor.calcAverageRatings(this.reviewDoc.product);
  }
});
// Add index to prevent duplicate reviews
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

// Static method to calculate ratings
reviewSchema.statics.calcAverageRatings = async function (productId) {
  const stats = await this.aggregate([
    {
      $match: { product: productId },
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
      rating: stats[0].avgRating,
      numReviews: stats[0].numReviews,
      ratingDistribution: stats[0].ratingDistribution,
    });
  } else {
    // Reset if no reviews
    await mongoose.model('Product').findByIdAndUpdate(productId, {
      rating: 0,
      numReviews: 0,
      ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    });
  }
};

// Post-save hook
reviewSchema.post('save', function () {
  // this points to current review
  this.constructor.calcAverageRatings(this.product);
});

// Pre-remove hook
reviewSchema.pre(/^findOneAnd/, async function (next) {
  // Store document in query so we can access it in post hook
  this.r = await this.findOne();
  next();
});

// Post-remove hook
reviewSchema.post(/^findOneAnd/, function () {
  if (this.r) this.r.constructor.calcAverageRatings(this.r.product);
});
const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
