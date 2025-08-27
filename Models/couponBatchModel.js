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
    required: [true, 'Seller reference is required'],
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

// Indexes for faster queries
couponSchema.index({ seller: 1 });
// couponSchema.index({ 'coupons.code': 1 }, { unique: true });
couponSchema.index({ expiresAt: 1 });
couponSchema.index({ validFrom: 1 });

// Middleware to update timestamps
couponSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Static method for coupon validation
couponSchema.statics.validateCoupon = async function (
  code,
  userId,
  orderAmount,
) {
  const batch = await this.findOne({
    'coupons.code': code,
    validFrom: { $lte: new Date() },
    expiresAt: { $gte: new Date() },
    isActive: true,
  });

  if (!batch) {
    throw new Error('Coupon not found or expired');
  }

  const coupon = batch.coupons.find((c) => {
    console.log('code', c.code, code);
    return c.code === code;
  });
  console.log('coupon', coupon);
  if (!coupon || coupon.used) {
    throw new Error('Invalid coupon code');
  }

  if (coupon.recipient && coupon.recipient.toString() !== userId.toString()) {
    throw new Error('This coupon is not assigned to you');
  }

  if (coupon.usageCount >= batch.maxUsage) {
    throw new Error('Coupon usage limit reached');
  }

  if (orderAmount < batch.minOrderAmount) {
    throw new Error(
      `Minimum order amount of ${batch.minOrderAmount.toFixed(2)} required`,
    );
  }

  return {
    batchId: batch._id,
    couponId: coupon._id,
    discountValue: batch.discountValue,
    discountType: batch.discountType,
  };
};

// Static method to apply coupon
couponSchema.statics.applyCoupon = async function (
  batchId,
  couponId,
  userId,
  orderId,
) {
  const result = await this.updateOne(
    {
      _id: batchId,
      'coupons._id': couponId,
      'coupons.usageCount': { $lt: '$maxUsage' },
    },
    {
      $inc: { 'coupons.$.usageCount': 1 },
      $set: {
        'coupons.$.lastUsedAt': new Date(),
        'coupons.$.lastUsedBy': userId,
      },
      $addToSet: {
        'coupons.$.orders': orderId,
      },
    },
  );

  if (result.nModified === 0) {
    throw new Error('Failed to apply coupon');
  }

  return true;
};

couponSchema.statics.validateUserCoupon = async function (code, userId) {
  const batch = await this.findOne({
    'coupons.code': code,
    validFrom: { $lte: new Date() },
    expiresAt: { $gte: new Date() },
    isActive: true,
  });
  // console.log('batch', batch);
  if (!batch) {
    throw new Error('Coupon not found or expired');
  }

  if (batch.maxUsage === 0) {
    throw new Error('Coupon usage limit reached');
  }
  if (batch.used === true) {
    throw new Error('This coupon has already been used');
  }

  const coupon = batch.coupons.find((c) => c.code === code);
  if (!coupon || coupon.used) {
    throw new Error('Invalid coupon code');
  }

  if (coupon.recipient && coupon.recipient.toString() !== userId.toString()) {
    throw new Error('This coupon is not assigned to you');
  }

  if (coupon.usageCount >= batch.maxUsage) {
    throw new Error('Coupon usage limit reached');
  }

  return {
    discountValue: batch.discountValue,
    discountType: batch.discountType,
    couponId: coupon._id,
    batchId: batch._id,
    sellerId: batch.seller,
    maxUsage: batch.maxUsage,
    usageCount: coupon.usageCount,
    isActive: batch.isActive,
    expiresAt: batch.expiresAt,
    minOrderAmount: batch.minOrderAmount,
  };
};
couponSchema.statics.markCouponAsUsed = async function (
  batchId,
  couponId,
  userId,
) {
  console.log('batchId', batchId);
  console.log('couponId', couponId);
  console.log('userId', userId);
  try {
    const batch = await this.findById(batchId);
    console.log('batch found', batch);
    if (!batch) {
      throw new Error('Coupon batch not found');
    }

    const coupon = batch.coupons.find(
      (c) => c._id.toString() === couponId.toString(),
    );
    if (!coupon) {
      throw new Error('Coupon not found in batch');
    }
    console.log('coupon found', coupon);

    coupon.used = true;
    coupon.usedAt = new Date();
    coupon.lastUsedBy = userId;

    // Save the updated batch
    const result = await batch.save();

    console.log('Coupon marked as used:', result);
  } catch (err) {
    console.log(err);
  }
};

const CouponBatch = mongoose.model('CouponBatch', couponSchema);
module.exports = CouponBatch;
