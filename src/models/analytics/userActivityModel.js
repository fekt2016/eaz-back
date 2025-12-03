const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['view', 'add_to_cart', 'add_to_wishlist', 'purchase', 'search'],
      required: true,
      index: true,
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

// Compound indexes for efficient queries
userActivitySchema.index({ userId: 1, action: 1, createdAt: -1 });
userActivitySchema.index({ productId: 1, action: 1, createdAt: -1 });
userActivitySchema.index({ userId: 1, productId: 1 });
userActivitySchema.index({ createdAt: -1 });

// TTL index to auto-delete old activities after 90 days
userActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

const UserActivity = mongoose.model('UserActivity', userActivitySchema);

module.exports = UserActivity;

