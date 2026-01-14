const mongoose = require('mongoose');

/**
 * ShippingRate Model
 * Stores granular shipping rates based on shipping type, zone, and weight ranges
 */
const shippingRateSchema = new mongoose.Schema(
  {
    shippingType: {
      type: String,
      enum: ['standard', 'same_day'],
      required: true,
    },
    zone: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      required: true,
    },
    weightMin: {
      type: Number,
      required: true,
      min: 0,
    },
    weightMax: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function(v) {
          return v > this.weightMin;
        },
        message: 'weightMax must be greater than weightMin',
      },
    },
    baseFee: {
      type: Number,
      required: true,
      min: 0,
    },
    perKgFee: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    weightAddOn: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
      // Additional fee per weight unit (alternative to perKgFee)
    },
    standardMultiplier: {
      type: Number,
      required: false,
      min: 0,
      default: 1.0,
    },
    sameDayMultiplier: {
      type: Number,
      required: false,
      min: 0,
      default: 1.2,
    },
    expressMultiplier: {
      type: Number,
      required: false,
      min: 0,
      default: 1.4,
    },
    fragileSurcharge: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
    },
    weekendSurcharge: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
    },
    nightSurcharge: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
    },
    estimatedDays: {
      type: String,
      required: true,
      default: '1-3 days',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Unique index on { shippingType, zone, weightMin, weightMax }


// Index for faster lookups


// Pre-save hook to update updatedAt
shippingRateSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

shippingRateSchema.statics.findRate = async function(weight, shippingType, zone) {
  return await this.findOne({
    shippingType,
    zone,
    weightMin: { $lte: weight },
    weightMax: { $gte: weight },
    isActive: true,
  }).sort({ weightMin: 1 });
};


shippingRateSchema.statics.calculateFee = async function(weight, shippingType, zone) {
  // Find rate - use 'standard' as base type since multipliers are applied per shippingType
  const rate = await this.findRate(weight, 'standard', zone);
  
  if (!rate) {
    throw new Error(
      `No shipping rate found for weight ${weight}kg, zone ${zone}`
    );
  }
  
  // Calculate base cost: baseFee + (weight * perKgFee) + weightAddOn
  const baseCost = rate.baseFee + (weight * rate.perKgFee) + (rate.weightAddOn || 0);
  
  // Apply shipping type multiplier
  let multiplier = 1.0;
  if (shippingType === 'standard') {
    multiplier = rate.standardMultiplier || 1.0;
  } else if (shippingType === 'same_day') {
    multiplier = rate.sameDayMultiplier || 1.2;
  } else if (shippingType === 'express') {
    multiplier = rate.expressMultiplier || 1.4;
  }
  
  const fee = baseCost * multiplier;
  
  return {
    fee: Math.round(fee * 100) / 100, // Round to 2 decimal places
    estimatedDays: rate.estimatedDays,
    baseFee: rate.baseFee,
    perKgFee: rate.perKgFee,
    weightAddOn: rate.weightAddOn || 0,
    multiplier,
    baseCost: Math.round(baseCost * 100) / 100,
    rateId: rate._id,
  };
};

module.exports = mongoose.model('ShippingRate', shippingRateSchema);

