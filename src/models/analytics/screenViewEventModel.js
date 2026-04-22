const mongoose = require('mongoose');

const screenViewEventSchema = new mongoose.Schema(
  {
    screen: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    viewerKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ['buyer', 'seller', 'admin', 'guest'],
      default: 'guest',
      index: true,
    },
    platform: {
      type: String,
      enum: ['eazmain', 'eazseller', 'eazadmin'],
      default: 'eazmain',
      index: true,
    },
    sessionId: {
      type: String,
      default: null,
      trim: true,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

screenViewEventSchema.index({ screen: 1, viewedAt: -1 });
screenViewEventSchema.index({ viewerKey: 1, viewedAt: -1 });

const ScreenViewEvent = mongoose.model(
  'ScreenViewEvent',
  screenViewEventSchema,
);

module.exports = ScreenViewEvent;
