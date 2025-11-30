const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      default: null,
    },
    userTypeModel: {
      type: String,
      enum: ['Seller', 'User', 'Admin'],
      default: null,
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        'login',
        'logout',
        'logout_attempt',
        'logout_error',
        'password_reset',
        'token_refresh',
      ],
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

const SecurityLog = mongoose.model('SecurityLog', securityLogSchema);

module.exports = SecurityLog;;
