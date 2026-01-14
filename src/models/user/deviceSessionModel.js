const mongoose = require('mongoose');
const crypto = require('crypto');

const deviceSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'User ID is required'],
      refPath: 'userModel',
    },
    userModel: {
      type: String,
      required: true,
      enum: ['User', 'Seller', 'Admin'],
      default: 'User',
    },
    deviceId: {
      type: String,
      required: [true, 'Device ID is required'],
      unique: true,
    },
    ipAddress: {
      type: String,
      required: [true, 'IP address is required'],
    },
    userAgent: {
      type: String,
      required: [true, 'User agent is required'],
    },
    deviceType: {
      type: String,
      enum: ['mobile', 'desktop', 'tablet', 'unknown'],
      default: 'unknown',
    },
    location: {
      type: String,
      default: null,
    },
    loginTime: {
      type: Date,
      default: Date.now,
      required: true,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
      required: true,
    },
    refreshToken: {
      type: String,
      required: [true, 'Refresh token is required'],
      select: false, // Don't return by default
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // TTL index for auto-cleanup
    },
    platform: {
      type: String,
      enum: ['eazmain', 'eazseller', 'eazadmin'],
      default: 'eazmain',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);



// Pre-save hook to hash refresh token
deviceSessionSchema.pre('save', async function (next) {
  // Only hash if refreshToken is modified and not already hashed
  if (this.isModified('refreshToken') && this.refreshToken && !this.refreshToken.startsWith('$2b$')) {
    const hash = crypto.createHash('sha256').update(this.refreshToken).digest('hex');
    this.refreshToken = hash;
  }
  next();
});

// Method to compare refresh token
deviceSessionSchema.methods.compareRefreshToken = async function (candidateToken) {
  const hash = crypto.createHash('sha256').update(candidateToken).digest('hex');
  return this.refreshToken === hash;
};

// Static method to find active sessions for a user
deviceSessionSchema.statics.findActiveSessions = function (userId, platform = null) {
  const query = { userId, isActive: true };
  if (platform) {
    query.platform = platform;
  }
  return this.find(query).sort({ lastActivity: -1 });
};

// Static method to deactivate all sessions except current
deviceSessionSchema.statics.deactivateOthers = function (userId, currentDeviceId) {
  return this.updateMany(
    { userId, deviceId: { $ne: currentDeviceId }, isActive: true },
    { isActive: false },
  );
};

// Static method to deactivate all sessions
deviceSessionSchema.statics.deactivateAll = function (userId) {
  return this.updateMany({ userId, isActive: true }, { isActive: false });
};

// Static method to check device limit
deviceSessionSchema.statics.checkDeviceLimit = async function (userId, role, platform) {
  const activeSessions = await this.countDocuments({
    userId,
    isActive: true,
    platform,
  });

  // Device limits based on role
  const limits = {
    buyer: 5,
    seller: 10,
    admin: 10,
  };

  const limit = limits[role] || limits.buyer;
  return {
    withinLimit: activeSessions < limit,
    currentCount: activeSessions,
    limit,
  };
};

// Virtual to check if session is expired
deviceSessionSchema.virtual('isExpired').get(function () {
  return this.expiresAt < new Date();
});

// Virtual to check if session is inactive (30 days)
deviceSessionSchema.virtual('isInactive').get(function () {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return this.lastActivity < thirtyDaysAgo;
});

const DeviceSession = mongoose.model('DeviceSession', deviceSessionSchema);

module.exports = DeviceSession;

