const mongoose = require('mongoose');
const logger = require('../../utils/logger');

const discountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Discount name is required'],
      trim: true,
      maxlength: [100, 'Discount name cannot exceed 100 characters'],
    },
    code: {
      type: String,
      required: [true, 'Discount code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: [20, 'Discount code cannot exceed 20 characters'],
    },
    type: {
      type: String,
      required: [true, 'Discount type is required'],
      enum: {
        values: ['percentage', 'fixed'],
        message: "Discount type must be either 'percentage' or 'fixed'",
      },
    },
    value: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: [1, 'Discount value must be at least 1'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    active: {
      type: Boolean,
      default: true,
    },
    maxUsage: {
      type: Number,
      min: [1, 'Maximum usage must be at least 1'],
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: [true, 'Seller is required'],
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    // For category-based discounts
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    // Optional: link to promo/offers page (e.g. "ramdan-special"). When set, discount applies to any product with matching product.promotionKey.
    promotionKey: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for checking if discount is currently active
discountSchema.virtual('isActive').get(function () {
  const now = new Date();
  return (
    this.active &&
    this.startDate <= now &&
    this.endDate >= now &&
    (this.maxUsage ? this.usageCount < this.maxUsage : true)
  );
});
discountSchema.pre('save', async function (next) {
  if (this.active) {
    const existingActiveDiscount = await this.constructor.findOne({
      products: { $in: this.products },
      active: true,
      $or: [
        { startDate: { $lte: this.endDate } },
        { endDate: { $gte: this.startDate } },
      ],
      _id: { $ne: this._id },
    });

    if (existingActiveDiscount) {
      // Native JS implementation
      const currentProductIds = this.products.map((id) => id.toString());
      const existingProductIds = existingActiveDiscount.products.map((id) =>
        id.toString(),
      );
      const conflictProductIds = currentProductIds.filter((id) =>
        existingProductIds.includes(id),
      );

      return next(
        new Error(
          `Products [${conflictProductIds.join(', ')}] already have active discounts`,
        ),
      );
    }
  }
  next();
});
// Virtual for expiration status
discountSchema.virtual('status').get(function () {
  const now = new Date();

  if (this.startDate > now) return 'upcoming';
  if (this.endDate < now) return 'expired';
  if (!this.active) return 'inactive';
  if (this.maxUsage && this.usageCount >= this.maxUsage) return 'max_used';

  return 'active';
});

// Pre-save hook: need at least one of products, categories, or promotionKey
discountSchema.pre('validate', function (next) {
  const hasProducts = this.products && this.products.length > 0;
  const hasCategories = this.categories && this.categories.length > 0;
  const hasPromoKey = this.promotionKey && String(this.promotionKey).trim() !== '';
  if (!hasProducts && !hasCategories && !hasPromoKey) {
    return next(new Error('Discount must apply to at least one product, category, or promotionKey'));
  }
  next();
});

// Indexes for efficient querying
discountSchema.index({ code: 1, seller: 1 }, { unique: true });
discountSchema.index({ seller: 1, active: 1 });
discountSchema.index({ endDate: 1 });
discountSchema.index({ startDate: 1 });

const Discount = mongoose.model('Discount', discountSchema);
module.exports = Discount;;
