const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    expoPushToken: {
      type: String,
      required: [true, 'Expo push token is required'],
      unique: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android'],
      required: [true, 'Platform is required'],
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deviceInfo: {
      deviceName: String,
      deviceModel: String,
      osVersion: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index to ensure one token per device per user
deviceTokenSchema.index({ user: 1, expoPushToken: 1 }, { unique: true });

// Update lastUsedAt before saving
deviceTokenSchema.pre('save', function (next) {
  if (this.isModified('expoPushToken') || this.isNew) {
    this.lastUsedAt = new Date();
  }
  next();
});

// Static method to find or create device token
deviceTokenSchema.statics.findOrCreate = async function (userId, expoPushToken, platform, deviceInfo = {}) {
  try {
    // Try to find existing token
    let deviceToken = await this.findOne({
      user: userId,
      expoPushToken,
    });

    if (deviceToken) {
      // Update lastUsedAt and isActive
      deviceToken.lastUsedAt = new Date();
      deviceToken.isActive = true;
      deviceToken.platform = platform;
      if (Object.keys(deviceInfo).length > 0) {
        deviceToken.deviceInfo = deviceInfo;
      }
      await deviceToken.save();
      return deviceToken;
    }

    // Check if user has this token with different user (shouldn't happen, but handle it)
    const existingToken = await this.findOne({ expoPushToken });
    if (existingToken && existingToken.user.toString() !== userId.toString()) {
      // Token belongs to different user - deactivate old one and create new
      existingToken.isActive = false;
      await existingToken.save();
    }

    // Create new token
    deviceToken = await this.create({
      user: userId,
      expoPushToken,
      platform,
      deviceInfo,
      lastUsedAt: new Date(),
      isActive: true,
    });

    return deviceToken;
  } catch (error) {
    // Handle duplicate key error (race condition)
    if (error.code === 11000) {
      return await this.findOne({
        user: userId,
        expoPushToken,
      });
    }
    throw error;
  }
};

// Static method to deactivate token
deviceTokenSchema.statics.deactivateToken = async function (userId, expoPushToken) {
  return await this.updateOne(
    { user: userId, expoPushToken },
    { isActive: false }
  );
};

// Static method to deactivate all tokens for a user
deviceTokenSchema.statics.deactivateAllUserTokens = async function (userId) {
  return await this.updateMany(
    { user: userId },
    { isActive: false }
  );
};

// Static method to get active tokens for a user
deviceTokenSchema.statics.getActiveTokens = async function (userId) {
  return await this.find({
    user: userId,
    isActive: true,
  });
};

const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

module.exports = DeviceToken;

