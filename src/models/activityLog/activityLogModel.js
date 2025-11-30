const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'userModel',
      required: true,
      index: true,
    },
    userModel: {
      type: String,
      enum: ['User', 'Seller', 'Admin'],
      required: true,
    },
    role: {
      type: String,
      enum: ['buyer', 'seller', 'admin'],
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    // New field for activity type classification
    activityType: {
      type: String,
      enum: ['LOGIN', 'LOGOUT', 'IP_CHANGE', 'DEVICE_CHANGE', 'SUSPICIOUS', 'FAILED_LOGIN', 'SECURITY_ALERT', 'PASSWORD_CHANGE', 'ACCOUNT_LOCKED', 'OTHER'],
      default: 'OTHER',
      index: true,
    },
    ipAddress: {
      type: String,
      index: true,
    },
    // New field for tracking previous IP
    previousIp: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    // New field for location (from IP lookup)
    location: {
      type: String,
    },
    // New field for risk level
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low',
      index: true,
    },
    platform: {
      type: String,
      enum: ['eazmain', 'eazseller', 'eazadmin'],
      required: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient security queries
activityLogSchema.index({ userId: 1, activityType: 1, timestamp: -1 });
activityLogSchema.index({ riskLevel: 1, timestamp: -1 });
activityLogSchema.index({ ipAddress: 1, timestamp: -1 });
activityLogSchema.index({ userId: 1, ipAddress: 1 });

// Virtual for user details
activityLogSchema.virtual('user', {
  ref: function() {
    if (this.userModel === 'User') return 'User';
    if (this.userModel === 'Seller') return 'Seller';
    if (this.userModel === 'Admin') return 'Admin';
    return 'User';
  },
  localField: 'userId',
  foreignField: '_id',
  justOne: true,
});

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

module.exports = ActivityLog;

