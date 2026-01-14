const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    action: {
      type: String,
      enum: ['view', 'add_to_cart', 'add_to_wishlist', 'purchase', 'search'],
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sessionId: {
      type: String,
      index: true,
    },
    ipAddress: String,
    userAgent: String,
  },
  {
    timestamps: true,
  }
);





userActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

const UserActivity = mongoose.model('UserActivity', userActivitySchema);

module.exports = UserActivity;

