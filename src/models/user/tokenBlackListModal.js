// models/tokenBlacklistModel.js
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
    expiry: {
      type: Date,
      required: [true, 'Expiration date is required'],
      index: { expires: 0 }, // TTL index on expiry
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: { expires: '90d' }, // TTL index - auto-delete after 90 days
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

// Pre-save hook to hash token before saving
tokenBlacklistSchema.pre('save', function (next) {
  // Only hash if token is modified and not already hashed (doesn't start with $2b$ for bcrypt or is not a hash)
  if (this.isModified('token') && this.token && !this.token.startsWith('$2b$') && this.token.length < 64) {
    const hash = crypto.createHash('sha256').update(this.token).digest('hex');
    this.token = hash;
  }
  // Ensure expiry is set if not provided
  if (!this.expiry && this.expiresAt) {
    this.expiry = this.expiresAt;
  }
  next();
});

// Helper method to hash token
tokenBlacklistSchema.statics.hashToken = function (token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Static method to check if token is blacklisted
tokenBlacklistSchema.statics.isBlacklisted = async function (token) {
  // First check if token is already expired (no need to query DB)
  const decoded = jwt.decode(token);
  if (decoded && decoded.exp * 1000 < Date.now()) {
    return true;
  }

  // Hash token before checking
  const hashedToken = this.hashToken(token);
  const exists = await this.exists({ token: hashedToken });
  return !!exists;
};

// Static method for bulk insertion
tokenBlacklistSchema.statics.blacklistTokens = async function (tokens) {
  const tokensWithExpiry = tokens.map((token) => {
    const decoded = jwt.decode(token);
    const hashedToken = this.hashToken(token);
    return {
      token: hashedToken,
      user: decoded.id,
      userType: decoded.role || 'seller',
      expiry: new Date(decoded.exp * 1000),
      reason: 'system',
    };
  });

  return this.insertMany(tokensWithExpiry, { ordered: false });
};

// Static method to blacklist a single token
tokenBlacklistSchema.statics.blacklistToken = async function (token, userId = null, userType = 'customer', reason = 'logout') {
  try {
    const decoded = jwt.decode(token);
    if (!decoded) {
      throw new Error('Invalid token');
    }

    const hashedToken = this.hashToken(token);
    const expiry = new Date(decoded.exp * 1000);

    console.log('[TokenBlacklist] Blacklisting token:', {
      userId: userId || decoded.id,
      userType,
      reason,
      expiry: expiry.toISOString(),
    });

    const result = await this.findOneAndUpdate(
      { token: hashedToken },
      {
        token: hashedToken,
        user: userId || decoded.id,
        userType: userType || decoded.role || 'customer',
        expiry,
        reason,
        createdAt: new Date(),
      },
      { upsert: true, new: true },
    );

    console.log('[TokenBlacklist] ✅ Token blacklisted successfully, collection created if needed');
    return result;
  } catch (error) {
    console.error('[TokenBlacklist] ❌ Error blacklisting token:', error.message);
    console.error('[TokenBlacklist] Error stack:', error.stack);
    throw error;
  }
};

// ADDED MISSING METHOD: Invalidate all sessions for a user
tokenBlacklistSchema.statics.invalidateAllSessions = async function (userId) {
  // Create special token representing global invalidation
  const globalToken = `global_invalidation:${userId}`;
  const hashedToken = this.hashToken(globalToken);

  // Set expiration to 10 years from now
  const expiry = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

  // Create or update global invalidation record
  await this.findOneAndUpdate(
    { token: hashedToken },
    {
      token: hashedToken,
      user: userId,
      expiry,
      reason: 'security',
      userType: 'customer', // Default, will be updated in actual usage
      createdAt: new Date(),
    },
    { upsert: true, new: true },
  );
};

const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
module.exports = TokenBlacklist; // Fixed export statement;
