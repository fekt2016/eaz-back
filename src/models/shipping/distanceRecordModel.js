const mongoose = require('mongoose');

/**
 * Distance Record Model
 * Stores distance records from warehouse to towns in each zone
 * Used for distance analysis and zone verification
 */
const distanceRecordSchema = new mongoose.Schema(
  {
    zone: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
      required: true,
      index: true,
    },
    town: {
      type: String,
      required: true,
      index: true,
    },
    distanceKm: {
      type: Number,
      required: false,
      min: 0,
      default: null,
    },
    distanceMeters: {
      type: Number,
      required: false,
      min: 0,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    error: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for zone and town uniqueness


const DistanceRecord = mongoose.model('DistanceRecord', distanceRecordSchema);

module.exports = DistanceRecord;

