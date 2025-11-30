const mongoose = require('mongoose');

/**
 * Neighborhood Model
 * Stores neighborhood data for Accra and Tema with geographic coordinates
 * Used for neighborhood-based shipping zone calculation
 */
const neighborhoodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    city: {
      type: String,
      required: true,
      enum: ['Accra', 'Tema'],
      index: true,
    },
    municipality: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    lat: {
      type: Number,
      required: false,
      default: null,
    },
    lng: {
      type: Number,
      required: false,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    googlePlaceId: {
      type: String,
      required: false,
    },
    formattedAddress: {
      type: String,
      required: false,
    },
    distanceFromHQ: {
      type: Number,
      required: false,
      default: null,
    },
    distanceKm: {
      type: Number,
      required: false,
      default: null,
    },
    assignedZone: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      required: false,
      default: null,
    },
    zone: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for efficient queries


// Virtual for coordinates array
neighborhoodSchema.virtual('coordinates').get(function () {
  if (this.lat && this.lng) {
    return [this.lng, this.lat]; // GeoJSON format [lng, lat]
  }
  return null;
});

const Neighborhood = mongoose.model('Neighborhood', neighborhoodSchema);

module.exports = Neighborhood;

