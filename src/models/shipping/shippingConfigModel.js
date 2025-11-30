const mongoose = require('mongoose');

/**
 * ShippingConfig Model
 * Stores shipping configuration including zones, weight multipliers, and cut-off times
 */
const shippingConfigSchema = new mongoose.Schema(
  {
    // Shipping type configuration
    shippingType: {
      type: String,
      enum: ['same_day', 'standard'],
      required: true,
    },
    
    // Zone-based pricing
    zones: [
      {
        zoneId: {
          type: String,
          required: true,
          enum: ['A', 'B', 'C'],
        },
        name: {
          type: String,
          required: true,
        },
        baseSameDayRate: {
          type: Number,
          required: true,
          min: 0,
          default: 0,
        },
        baseStandardRate: {
          type: Number,
          required: true,
          min: 0,
          default: 0,
        },
        cities: [String], // List of cities in this zone
      },
    ],
    
    // Weight-based multipliers
    weightMultipliers: [
      {
        min: {
          type: Number,
          required: true,
          min: 0,
        },
        max: {
          type: Number,
          required: true,
          min: 0,
        },
        multiplier: {
          type: Number,
          required: true,
          min: 1,
          default: 1,
        },
      },
    ],
    
    // Same-day delivery cut-off time (24-hour format, e.g., "15:00" for 3pm Ghana time)
    sameDayCutOff: {
      type: String,
      default: '15:00',
      validate: {
        validator: function(v) {
          // Validate HH:MM format
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'Cut-off time must be in HH:MM format (24-hour)',
      },
    },
    
    // Enable/disable shipping types
    enabled: {
      type: Boolean,
      default: true,
    },
    
    // Standard delivery estimate (in days)
    standardDeliveryDays: {
      min: {
        type: Number,
        default: 1,
        min: 1,
      },
      max: {
        type: Number,
        default: 3,
        min: 1,
      },
    },
    
    // Created/updated by admin
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

// Index for faster lookups


// Static method to get active config
shippingConfigSchema.statics.getActiveConfig = async function(shippingType) {
  return await this.findOne({ shippingType, enabled: true }).sort({ createdAt: -1 });
};

// Static method to get or create default config
shippingConfigSchema.statics.getOrCreateDefault = async function() {
  let config = await this.findOne({ shippingType: 'standard', enabled: true });
  
  if (!config) {
    config = await this.create({
      shippingType: 'standard',
      zones: [
        {
          zoneId: 'A',
          name: 'Same City',
          baseSameDayRate: 30,
          baseStandardRate: 15,
          cities: ['ACCRA', 'TEMA'],
        },
        {
          zoneId: 'B',
          name: 'Nearby City',
          baseSameDayRate: 30,
          baseStandardRate: 15,
          cities: ['KUMASI', 'TAKORADI'],
        },
        {
          zoneId: 'C',
          name: 'Nationwide',
          baseSameDayRate: 30,
          baseStandardRate: 15,
          cities: [],
        },
      ],
      weightMultipliers: [
        { min: 0, max: 1, multiplier: 1.0 },
        { min: 1, max: 5, multiplier: 1.2 },
        { min: 5, max: 10, multiplier: 1.5 },
        { min: 10, max: Infinity, multiplier: 2.0 },
      ],
      sameDayCutOff: '15:00',
      standardDeliveryDays: { min: 1, max: 3 },
      enabled: true,
    });
  }
  
  return config;
};

// Method to get weight multiplier
shippingConfigSchema.methods.getWeightMultiplier = function(weight) {
  const multiplier = this.weightMultipliers.find(
    (wm) => weight >= wm.min && (wm.max === Infinity || weight < wm.max)
  );
  return multiplier ? multiplier.multiplier : 1.0;
};

// Method to get zone by city
shippingConfigSchema.methods.getZoneByCity = function(city) {
  const normalizedCity = city?.toUpperCase().trim();
  return this.zones.find((zone) =>
    zone.cities.some((c) => c.toUpperCase() === normalizedCity)
  ) || this.zones.find((zone) => zone.zoneId === 'C'); // Default to Zone C if not found
};

module.exports = mongoose.model('ShippingConfig', shippingConfigSchema);

