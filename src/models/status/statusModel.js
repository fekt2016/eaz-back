const mongoose = require('mongoose');

const statusSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      index: true,
    },
    video: {
      type: String,
      required: true,
      trim: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: [150, 'Caption must be at most 150 characters'],
      default: '',
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      index: true,
    },
    // Algorithmic ranking fields
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    watchTime: { type: Number, default: 0 }, // total seconds watched
    totalCompletionRate: { type: Number, default: 0 }, // sum of completion % for avg
    lastViewedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

statusSchema.index({ seller: 1, createdAt: -1 });
statusSchema.index({ expiresAt: 1 }); // Do NOT use TTL — keep videos, filter expired in queries if needed

const Status = mongoose.model('Status', statusSchema);
module.exports = Status;
