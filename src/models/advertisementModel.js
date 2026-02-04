const mongoose = require('mongoose');

const AD_TYPES = ['banner', 'popup', 'carousel', 'native'];

const advertisementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Advertisement title is required'],
      trim: true,
    },
    imageUrl: {
      type: String,
      required: [true, 'Advertisement image URL is required'],
      trim: true,
      validate: {
        validator: (value) => /^https?:\/\//i.test(value),
        message: 'Image URL must be an absolute HTTP(S) URL',
      },
    },
    link: {
      type: String,
      required: [true, 'Advertisement link is required'],
      trim: true,
      validate: {
        validator: (value) => /^https?:\/\//i.test(value),
        message: 'Link must be an absolute HTTP(S) URL',
      },
    },
    type: {
      type: String,
      enum: {
        values: AD_TYPES,
        message: 'Advertisement type must be one of: banner, popup, carousel, native',
      },
      required: [true, 'Advertisement type is required'],
    },
    // Optional percentage discount to apply to products linked to this promotion
    // (0–100, interpreted as "% off" the normal price)
    discountPercent: {
      type: Number,
      min: [0, 'Discount percent cannot be negative'],
      max: [100, 'Discount percent cannot exceed 100'],
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
    startDate: {
      type: Date,
      required: [true, 'Advertisement start date is required'],
      default: () => new Date(),
    },
    endDate: {
      type: Date,
      validate: {
        validator: function validator(value) {
          if (!value) return true;
          const start = this.startDate || this.get('startDate');
          return value >= start;
        },
        message: 'End date must be greater than or equal to the start date',
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

advertisementSchema.index({ active: 1, startDate: 1, endDate: 1, type: 1 });

/**
 * Determine if the advertisement is active at the provided date.
 * @param {Date} [date=new Date()]
 * @returns {boolean}
 */
advertisementSchema.methods.isCurrentlyActive = function isCurrentlyActive(date = new Date()) {
  const now = date instanceof Date ? date : new Date(date);
  if (!this.active) return false;
  if (this.startDate && this.startDate > now) return false;
  if (this.endDate && this.endDate < now) return false;
  return true;
};

/**
 * Static helper to fetch currently active ads sorted by start date desc.
 * @param {Date} [date=new Date()]
 * @returns {Promise<mongoose.Document[]>}
 */
advertisementSchema.statics.findActive = function findActive(date = new Date()) {
  const now = date instanceof Date ? date : new Date(date);
  return this.find({
    active: true,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }, { endDate: { $exists: false } }],
  }).sort({ startDate: -1, createdAt: -1 });
};

advertisementSchema.pre('save', function preSave(next) {
  if (this.endDate && this.endDate < this.startDate) {
    return next(new Error('End date must be greater than or equal to the start date'));
  }
  return next();
});

module.exports = mongoose.model('Advertisement', advertisementSchema);
module.exports.AD_TYPES = AD_TYPES;
