// models/tokenBlacklistModel.js
const mongoose = require('mongoose');
const tokenBlacklistSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: [true, 'Token is required'],
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.ObjectId,
      default: null,
    },
    userType: {
      type: String,
      enum: ['seller', 'admin', 'customer'],
      default: 'seller',
    },
    expiresAt: {
      type: Date,
      required: [true, 'Expiration date is required'],
      index: { expires: 0 }, // TTL index
    },
    reason: {
      type: String,
      enum: ['logout', 'security', 'password_reset', 'system'],
      default: 'logout',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Add compound index for faster queries
tokenBlacklistSchema.index({ token: 1, user: 1 });

// Virtual property to check if token is expired
tokenBlacklistSchema.virtual('isExpired').get(function () {
  return this.expiresAt < new Date();
});

// Pre-save hook to normalize token
tokenBlacklistSchema.pre('save', function (next) {
  this.token = this.token.trim();
  next();
});

// Static method to check if token is blacklisted
tokenBlacklistSchema.statics.isBlacklisted = async function (token) {
  // First check if token is already expired (no need to query DB)
  const decoded = jwt.decode(token);
  if (decoded && decoded.exp * 1000 < Date.now()) {
    return true;
  }

  return this.exists({ token });
};

// Static method for bulk insertion
tokenBlacklistSchema.statics.blacklistTokens = async function (tokens) {
  const tokensWithExpiry = tokens.map((token) => {
    const decoded = jwt.decode(token);
    return {
      token,
      user: decoded.id,
      userType: decoded.role || 'seller',
      expiresAt: new Date(decoded.exp * 1000),
      reason: 'system',
    };
  });

  return this.insertMany(tokensWithExpiry, { ordered: false });
};

const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
module.exports = TokenBlacklist;
