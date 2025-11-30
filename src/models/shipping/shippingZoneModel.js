const mongoose = require('mongoose');

/**
 * Shipping Zone Model
 * Defines shipping zones (A, B, C, D, E, F) with pricing and delivery rules
 * Each zone has distance ranges, base rates, and multipliers for different shipping types
 */
const shippingZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      uppercase: true,
      index: true,
    },
    minKm: {
      type: Number,
      required: true,
      min: 0,
    },
    maxKm: {
      type: Number,
      required: true,
      min: 0,
    },
    baseRate: {
      type: Number,
      required: true,
      min: 0,
    },
    perKgRate: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    sameDayMultiplier: {
      type: Number,
      required: true,
      min: 1,
      default: 1.2,
    },
    expressMultiplier: {
      type: Number,
      required: true,
      min: 1,
      default: 1.4,
    },
    fragileSurcharge: {
      type: Number,
      required: false,
      min: 0,
      default: 5,
    },
    estimatedDays: {
      type: String,
      required: true,
      default: '2-3',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);




// Virtual for distance range display
shippingZoneSchema.virtual('distanceRange').get(function () {
  return `${this.minKm}-${this.maxKm} km`;
});

// Static method to find zone by distance
shippingZoneSchema.statics.findByDistance = async function (distanceKm) {
  const zone = await this.findOne({
    minKm: { $lte: distanceKm },
    maxKm: { $gte: distanceKm },
    isActive: true,
  });
  return zone;
};

// Static method to get all active zones
shippingZoneSchema.statics.getActiveZones = async function () {
  return this.find({ isActive: true }).sort({ minKm: 1 });
};

const ShippingZone = mongoose.model('ShippingZone', shippingZoneSchema);

module.exports = ShippingZone;

