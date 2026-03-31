const mongoose = require('mongoose');

const statusViewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Status',
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
    watchTimeSeconds: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 }, // 0-100
  },
  { timestamps: true }
);

statusViewSchema.index({ user: 1, status: 1 }, { unique: true });
statusViewSchema.index({ status: 1, viewedAt: -1 });

const StatusView = mongoose.model('StatusView', statusViewSchema);
module.exports = StatusView;
