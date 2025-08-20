const Seller = require('./sellerModel');
const sellerReviewSchema = new mongoose.Schema(
  {
    seller: { type: ObjectId, ref: 'Seller', required: true },
    user: { type: ObjectId, ref: 'User', required: true },
    order: { type: ObjectId, ref: 'Order', required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: String,
    categories: {
      shipping: { type: Number, min: 1, max: 5 },
      communication: { type: Number, min: 1, max: 5 },
      accuracy: { type: Number, min: 1, max: 5 },
    },
  },
  { timestamps: true },
);
sellerReviewSchema.statics.calcAverageRatings = async function (sellerId) {
  try {
    const stats = await this.aggregate([
      { $match: { seller: sellerId } },
      {
        $group: {
          _id: '$seller',
          average: { $avg: '$rating' },
          count: { $sum: 1 },
          // Include category averages if you have them
          shippingAvg: { $avg: '$categories.shipping' },
          communicationAvg: { $avg: '$categories.communication' },
          accuracyAvg: { $avg: '$categories.accuracy' },
        },
      },
    ]);

    const updateData =
      stats.length > 0
        ? {
            'ratings.average': stats[0].average.toFixed(1),
            'ratings.count': stats[0].count,
            // Optional: Store category averages
            ...(stats[0].shippingAvg && {
              'ratings.shipping': stats[0].shippingAvg.toFixed(1),
            }),
            ...(stats[0].communicationAvg && {
              'ratings.communication': stats[0].communicationAvg.toFixed(1),
            }),
            ...(stats[0].accuracyAvg && {
              'ratings.accuracy': stats[0].accuracyAvg.toFixed(1),
            }),
          }
        : {
            'ratings.average': 0,
            'ratings.count': 0,
          };

    await Seller.findByIdAndUpdate(sellerId, updateData);
  } catch (err) {
    console.error(`Error updating ratings for seller ${sellerId}:`, err);
    // Consider adding error monitoring (Sentry, etc.)
  }
};

// Update hooks to handle both save and remove operations
sellerReviewSchema.post('save', function (doc) {
  doc.constructor.calcAverageRatings(doc.seller);
});

sellerReviewSchema.post('remove', function (doc) {
  doc.constructor.calcAverageRatings(doc.seller);
});

// For bulk operations (update/delete)
sellerReviewSchema.post('updateOne', async function () {
  const doc = await this.model.findOne(this.getQuery());
  if (doc) doc.constructor.calcAverageRatings(doc.seller);
});

sellerReviewSchema.post('deleteOne', async function () {
  const doc = await this.model.findOne(this.getQuery());
  if (doc) doc.constructor.calcAverageRatings(doc.seller);
});

const updateTimestamps = {};

sellerReviewSchema.post('save', function (doc) {
  const now = Date.now();
  if (
    !updateTimestamps[doc.seller] ||
    now - updateTimestamps[doc.seller] > 5000
  ) {
    doc.constructor.calcAverageRatings(doc.seller);
    updateTimestamps[doc.seller] = now;
  }
});
module.exports = mongoose.model('SellerReview', sellerReviewSchema);
