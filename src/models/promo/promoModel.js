const mongoose = require('mongoose');
const slugify = require('slugify');

const PROMO_TYPES = ['flash', 'campaign', 'seasonal'];
const PROMO_STATUSES = ['draft', 'scheduled', 'active', 'ended', 'cancelled'];

const promoSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Promo name is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, 'Promo slug is required'],
      unique: true,
      lowercase: true,
      index: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      enum: PROMO_TYPES,
      default: 'campaign',
    },
    banner: {
      url: {
        type: String,
        trim: true,
        default: '',
      },
      public_id: {
        type: String,
        trim: true,
        default: '',
      },
      _id: false,
    },
    startDate: {
      type: Date,
      required: [true, 'Promo start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'Promo end date is required'],
      validate: {
        validator: function validateEndDate(value) {
          if (!value || !this.startDate) return true;
          return value > this.startDate;
        },
        message: 'Promo end date must be after the start date',
      },
    },
    minDiscountPercent: {
      type: Number,
      default: 10,
      min: 1,
      max: 90,
    },
    maxProductsPerSeller: {
      type: Number,
      default: 5,
      min: 1,
    },
    eligibleCategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    status: {
      type: String,
      enum: PROMO_STATUSES,
      default: 'draft',
    },
    showCountdown: {
      type: Boolean,
      default: function defaultShowCountdown() {
        return this.type === 'flash';
      },
    },
    showOnHomepage: {
      type: Boolean,
      default: false,
    },
    featuredSlot: {
      type: Number,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: [true, 'Promo creator is required'],
    },
    analytics: {
      views: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      submissionCount: { type: Number, default: 0 },
      approvedCount: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      _id: false,
    },
  },
  {
    timestamps: true,
  },
);

promoSchema.index({ slug: 1 });
promoSchema.index({ status: 1, startDate: 1 });
promoSchema.index({ showOnHomepage: 1, status: 1 });

promoSchema.methods.isActive = function isActive() {
  const now = new Date();
  if (this.status !== 'active') return false;
  if (this.startDate && now < this.startDate) return false;
  if (this.endDate && now > this.endDate) return false;
  return true;
};

promoSchema.pre('save', function promoPreSave(next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name, { lower: true, strict: true, trim: true });
  } else if (this.slug) {
    this.slug = String(this.slug).toLowerCase().trim();
  }
  next();
});

const Promo = mongoose.model('Promo', promoSchema);

module.exports = Promo;
module.exports.PROMO_TYPES = PROMO_TYPES;
module.exports.PROMO_STATUSES = PROMO_STATUSES;
