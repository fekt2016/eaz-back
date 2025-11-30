const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema(
  {
    emailPreferences: {
      promotions: { type: Boolean, default: true },
      newsletters: { type: Boolean, default: false },
      accountUpdates: { type: Boolean, default: true },
    },
    smsPreferences: {
      promotions: { type: Boolean, default: false },
      orderUpdates: { type: Boolean, default: true },
    },
    dataSharing: {
      analytics: { type: Boolean, default: true },
      personalizedAds: { type: Boolean, default: false },
      thirdParties: { type: Boolean, default: false },
    },
    locationAccess: {
      type: String,
      enum: ['full', 'limited', 'none'],
      default: 'limited',
    },
    socialMediaSharing: { type: Boolean, default: false },
    accountVisibility: {
      type: String,
      enum: ['standard', 'private', 'hidden'],
      default: 'standard',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
  },
  { timestamps: true },
);

const Permission = mongoose.model('Permission', permissionSchema);

module.exports = Permission;;
