const mongoose = require('mongoose');

/**
 * Town Zone Assignment Model
 * Stores automatically calculated zone assignments based on driving distance from warehouse
 */
const townZoneAssignmentSchema = new mongoose.Schema(
  {
    town: {
      type: String,
      required: true,
      index: true,
    },
    km: {
      type: Number,
      required: true,
      min: 0,
    },
    zone: {
      type: String,
      required: true,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      index: true,
    },
    lat: {
      type: Number,
      required: false,
    },
    lng: {
      type: Number,
      required: false,
    },
    geocodedAddress: {
      type: String,
      required: false,
    },
    googleName: {
      type: String,
      required: false,
    },
    manualOverride: {
      type: Boolean,
      default: false,
    },
    originalZone: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      required: false,
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




const TownZoneAssignment = mongoose.model('TownZoneAssignment', townZoneAssignmentSchema);

module.exports = TownZoneAssignment;

