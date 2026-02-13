const mongoose = require('mongoose');

/**
 * InternationalShippingConfig Model
 * Admin-managed configuration for international shipping (China → Ghana, USA → Ghana).
 * Weight-based shipping pricing, fees, and customs buffer.
 * Does NOT affect local/normal shipping logic.
 */
const internationalShippingConfigSchema = new mongoose.Schema(
  {
    country: {
      type: String,
      enum: ['China', 'USA'],
      required: true,
      unique: true,
      trim: true,
    },
    weightRanges: [
      {
        minWeight: { type: Number, required: true, min: 0 },
        maxWeight: { type: Number, required: true, min: 0 },
        shippingCost: { type: Number, required: true, min: 0 },
      },
    ],
    defaultImportDutyRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.3,
    },
    clearingFee: {
      type: Number,
      min: 0,
      default: 0,
    },
    localDeliveryFee: {
      type: Number,
      min: 0,
      default: 0,
    },
    customsBufferPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 5,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Prevent overlapping weight ranges (validation)
internationalShippingConfigSchema.pre('save', function (next) {
  if (!this.weightRanges || this.weightRanges.length === 0) {
    return next();
  }
  const sorted = [...this.weightRanges].sort((a, b) => a.minWeight - b.minWeight);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minWeight < sorted[i - 1].maxWeight) {
      return next(new Error('Weight ranges must not overlap'));
    }
  }
  next();
});

internationalShippingConfigSchema.statics.getByCountry = async function (country) {
  const normalized = String(country || '').trim();
  if (!normalized) return null;
  const c = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  if (c !== 'China' && c !== 'USA') return null;
  return this.findOne({ country: c, isActive: true }).lean();
};

internationalShippingConfigSchema.statics.getAllActive = async function () {
  return this.find({ isActive: true }).sort({ country: 1 }).lean();
};

module.exports = mongoose.model(
  'InternationalShippingConfig',
  internationalShippingConfigSchema
);
