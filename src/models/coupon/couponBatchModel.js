const { ca } = require('date-fns/locale');
const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Coupon batch name is required'],
    trim: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: function() {
      // Seller is required only if not a global coupon
      return !this.global;
    },
    comment: 'Seller who owns this coupon. Not required for global coupons.',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'createdByModel',
    comment: 'User/admin who created this coupon',
  },
  createdByModel: {
    type: String,
    enum: ['Seller', 'Admin'],
    default: 'Seller',
  },
  discountValue: {
    type: Number,
    required: [true, 'Discount value is required'],
    min: [0.01, 'Discount value must be at least 0.01'],
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: [true, 'Discount type is required'],
    default: 'fixed',
  },
  validFrom: {
    type: Date,
    required: [true, 'Valid from date is required'],
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiration date is required'],
    validate: {
      validator: function (value) {
        return value > this.validFrom;
      },
      message: 'Expiration date must be after valid from date',
    },
  },
  maxUsage: {
    type: Number,
    min: [1, 'Max usage must be at least 1'],
    required: [true, 'Max usage per coupon is required'],
  },
  minOrderAmount: {
    type: Number,
    min: [0, 'Minimum order amount cannot be negative'],
    default: 0,
  },
  maxDiscountAmount: {
    type: Number,
    min: [0, 'Maximum discount amount cannot be negative'],
    default: null, // null means no limit
    comment: 'Maximum discount cap for percentage coupons',
  },
  applicableProducts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
  ],
  applicableCategories: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    },
  ],
  sellerFunded: {
    type: Boolean,
    default: true,
    comment: 'If true, seller pays for discount. If false, platform pays.',
  },
  platformFunded: {
    type: Boolean,
    default: false,
    comment: 'If true, platform pays for discount. Used for global coupons.',
  },
  global: {
    type: Boolean,
    default: false,
    comment: 'If true, this is a platform-wide coupon created by admin',
  },
  isPublic: {
    type: Boolean,
    default: false,
    comment: 'If true, coupons in this batch are visible to all users (public/promotional). If false, only recipients can see them.',
  },
  maxUsagePerUser: {
    type: Number,
    min: [1, 'Max usage per user must be at least 1'],
    default: 1,
    comment: 'Maximum times a single user can use this coupon',
  },
  stackingAllowed: {
    type: Boolean,
    default: false,
    comment: 'Whether this coupon can be used with other coupons',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  coupons: [
    {
      code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
      },
      recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      used: {
        type: Boolean,
        default: false,
      },
      usedAt: Date,
      // Add these missing fields:
      lastUsedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      usageCount: {
        type: Number,
        default: 0,
      },
      userUsageCount: {
        type: Map,
        of: Number,
        default: new Map(),
        comment: 'Track usage count per user: Map<userId, count>',
      },
      orders: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Order',
        },
      ],
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: Date,
});



// Middleware to update timestamps
couponSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Note: All coupon validation and application logic has been moved to
// backend/src/services/coupon/couponService.js for better maintainability
// and to fix critical bugs. The old static methods have been removed.

const CouponBatch = mongoose.model('CouponBatch', couponSchema);
module.exports = CouponBatch;;
