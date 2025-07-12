const mongoose = require('mongoose');
const Product = require('../Models/productModel');

const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
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

//calculating for number of rating and the avg rating
reviewSchema.statics.calcAverageRatings = async function (productId) {
  console.log(this);
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

  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      ratingsQuantity: stats[0].nRating,
      ratingsAverage: stats[0].avgRating,
    });

    return stats[0];
  } else {
    await Product.findByIdAndUpdate(productId, {
      ratingsQuantity: 0,
      ratingsAverage: 4.5,
    });
    return { nRating: 0, avgRating: 4.5 };
  }
};
reviewSchema.post('save', function () {
  this.constructor.calcAverageRatings(this.product);
});

reviewSchema.pre(/^findOneAnd/, async function (next) {
  this.r = await this.model.findOne();
  next();
});
reviewSchema.post(/^findOneAnd/, async function () {
  await this.r.constructor.calcAverageRatings(this.r.product);
});
const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
