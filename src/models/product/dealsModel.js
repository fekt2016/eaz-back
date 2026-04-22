const mongoose = require('mongoose');

const flashDealSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, sparse: true, trim: true },
    description: { type: String },
    bannerImage: { type: String },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'active', 'ended', 'cancelled'],
      default: 'draft',
    },
    maxProducts: { type: Number, default: 50, min: 1 },
    discountRules: {
      minDiscountPercent: { type: Number, default: 10, min: 1, max: 90 },
      maxDiscountPercent: { type: Number, default: 70, min: 1, max: 90 },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

flashDealSchema.index({ status: 1, startTime: 1, endTime: 1 });

flashDealSchema.virtual('currentStatus').get(function currentStatusGetter() {
  const now = Date.now();
  const start = this.startTime ? new Date(this.startTime).getTime() : null;
  const end = this.endTime ? new Date(this.endTime).getTime() : null;

  if (this.status === 'cancelled') return 'cancelled';
  if (this.status === 'draft') return 'draft';

  if (end != null && !Number.isNaN(end) && now >= end) return 'ended';
  if (
    start != null &&
    end != null &&
    !Number.isNaN(start) &&
    !Number.isNaN(end) &&
    now >= start &&
    now < end
  ) {
    return 'active';
  }
  if (start != null && !Number.isNaN(start) && now < start) return 'scheduled';
  return this.status || 'scheduled';
});

flashDealSchema.virtual('timeRemaining').get(function timeRemainingGetter() {
  if (!this.endTime) return 0;
  const end = new Date(this.endTime).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - Date.now());
});

flashDealSchema.virtual('productCount', {
  ref: 'FlashDealProduct',
  localField: '_id',
  foreignField: 'flashDeal',
  count: true,
  match: { status: 'approved' },
});

flashDealSchema.set('toJSON', { virtuals: true });
flashDealSchema.set('toObject', { virtuals: true });

const FlashDeal = mongoose.model('FlashDeal', flashDealSchema);

module.exports = FlashDeal;
