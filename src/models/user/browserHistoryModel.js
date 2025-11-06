const mongoose = require('mongoose');

const browserHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A history item must belong to a user'],
    },
    type: {
      type: String,
      enum: ['product', 'seller'],
      required: [true, 'A history item must have a type'],
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'A history item must reference an item'],
    },
    itemData: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'A history item must have data'],
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Index for faster querying
browserHistorySchema.index({ user: 1, viewedAt: -1 });

const BrowserHistory = mongoose.model('BrowserHistory', browserHistorySchema);

module.exports = BrowserHistory;
