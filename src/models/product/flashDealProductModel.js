const mongoose = require('mongoose');
const FlashDeal = require('./dealsModel');

const flashDealProductSchema = new mongoose.Schema(
  {
    flashDeal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FlashDeal',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 1 },
    originalPrice: { type: Number, required: true, min: 0 },
    flashPrice: { type: Number, required: true, min: 0 },
    maxQuantity: { type: Number, default: null, min: 1 },
    soldCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

flashDealProductSchema.index({ flashDeal: 1, product: 1 }, { unique: true });
flashDealProductSchema.index({ flashDeal: 1, status: 1 });
flashDealProductSchema.index({ seller: 1, flashDeal: 1 });

flashDealProductSchema.pre('save', async function flashDealProductPreSave(next) {
  try {
    if (this.flashPrice >= this.originalPrice) {
      return next(
        new Error('Flash price must be less than the original product price.'),
      );
    }

    const deal = await FlashDeal.findById(this.flashDeal);
    if (!deal) {
      return next(new Error('Flash deal not found.'));
    }

    const now = Date.now();
    const end = deal.endTime ? new Date(deal.endTime).getTime() : 0;
    if (deal.status === 'ended' || deal.status === 'cancelled' || now >= end) {
      return next(new Error('This flash deal is no longer accepting submissions.'));
    }

    const minP = deal.discountRules?.minDiscountPercent ?? 10;
    const maxP = deal.discountRules?.maxDiscountPercent ?? 70;

    if (this.discountType === 'percentage') {
      if (this.discountValue < minP || this.discountValue > maxP) {
        return next(
          new Error(
            `Discount percentage must be between ${minP}% and ${maxP}% for this deal.`,
          ),
        );
      }
    } else {
      const effectivePct =
        this.originalPrice > 0
          ? ((this.originalPrice - this.flashPrice) / this.originalPrice) * 100
          : 0;
      if (effectivePct + 1e-6 < minP || effectivePct - 1e-6 > maxP) {
        return next(
          new Error(
            `Fixed discount must result in an effective discount between ${minP}% and ${maxP}% of the original price.`,
          ),
        );
      }
    }

    if (this.status === 'approved' || this.isModified('status')) {
      const approvedCount = await this.constructor.countDocuments({
        flashDeal: this.flashDeal,
        status: 'approved',
        _id: { $ne: this._id },
      });
      if (
        this.status === 'approved' &&
        approvedCount >= (deal.maxProducts || 50)
      ) {
        return next(
          new Error('This flash deal has reached the maximum number of approved products.'),
        );
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

const FlashDealProduct = mongoose.model('FlashDealProduct', flashDealProductSchema);

module.exports = FlashDealProduct;
