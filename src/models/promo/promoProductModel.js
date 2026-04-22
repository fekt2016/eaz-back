const mongoose = require('mongoose');

const PROMO_PRODUCT_DISCOUNT_TYPES = ['percentage', 'fixed'];
const PROMO_PRODUCT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
];

const promoProductSchema = new mongoose.Schema(
  {
    promo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Promo',
      required: [true, 'Promo is required'],
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: [true, 'Seller is required'],
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product is required'],
      index: true,
    },
    discountType: {
      type: String,
      enum: PROMO_PRODUCT_DISCOUNT_TYPES,
      required: [true, 'Discount type is required'],
    },
    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: 0,
    },
    regularPrice: {
      type: Number,
      required: [true, 'Regular price is required'],
      min: 0,
    },
    promoPrice: {
      type: Number,
      required: [true, 'Promo price is required'],
      min: 0,
      validate: {
        validator: function validatePromoPrice(value) {
          if (typeof value !== 'number') return false;
          if (typeof this.regularPrice !== 'number') return false;
          return value <= this.regularPrice;
        },
        message: 'Promo price must be less than or equal to regular price',
      },
    },
    stockForPromo: {
      type: Number,
      default: null,
      min: 0,
    },
    unitsSold: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: PROMO_PRODUCT_STATUSES,
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

promoProductSchema.index({ promo: 1, product: 1 }, { unique: true });
promoProductSchema.index({ promo: 1, status: 1 });
promoProductSchema.index({ seller: 1, status: 1 });
promoProductSchema.index({ product: 1, status: 1 });

promoProductSchema.pre('validate', function promoProductPreValidate(next) {
  if (
    this.regularPrice == null ||
    this.discountValue == null ||
    !this.discountType
  ) {
    return next();
  }

  let computedPromoPrice = this.regularPrice;
  if (this.discountType === 'percentage') {
    computedPromoPrice =
      this.regularPrice - (this.regularPrice * this.discountValue) / 100;
  } else if (this.discountType === 'fixed') {
    computedPromoPrice = this.regularPrice - this.discountValue;
  }

  this.promoPrice = Math.max(0, Number(computedPromoPrice.toFixed(2)));
  next();
});

const PromoProduct = mongoose.model('PromoProduct', promoProductSchema);

module.exports = PromoProduct;
module.exports.PROMO_PRODUCT_DISCOUNT_TYPES = PROMO_PRODUCT_DISCOUNT_TYPES;
module.exports.PROMO_PRODUCT_STATUSES = PROMO_PRODUCT_STATUSES;
