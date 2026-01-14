const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'userModel',
      required: true,
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
    },
    action: {
      type: String,
      required: true,
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
    },
    ipAddress: {
      type: String,
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
    },
    platform: {
      type: String,
      enum: ['eazmain', 'eazseller', 'eazadmin'],
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient security queriesyLogSchema.index({ userId: 1, activityType: 1, timestamp: -1 });


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

