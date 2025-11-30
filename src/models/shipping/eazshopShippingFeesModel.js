const mongoose = require('mongoose');

const eazshopShippingFeesSchema = new mongoose.Schema(
  {
    sameCity: {
      type: Number,
      required: true,
      default: 25, // GHS
      min: [0, 'Same city fee must be positive'],
    },
    crossCity: {
      type: Number,
      required: true,
      default: 35, // GHS
      min: [0, 'Cross city fee must be positive'],
    },
    heavyItem: {
      type: Number,
      required: true,
      default: 60, // GHS
      min: [0, 'Heavy item fee must be positive'],
    },
    freeDeliveryThreshold: {
      type: Number,
      default: null, // Optional - if set, free delivery above this amount
      min: [0, 'Free delivery threshold must be positive'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Ensure only one document exists
eazshopShippingFeesSchema.statics.getOrCreate = async function() {
  let fees = await this.findOne();
  if (!fees) {
    fees = await this.create({
      sameCity: 25,
      crossCity: 35,
      heavyItem: 60,
      freeDeliveryThreshold: null,
    });
  }
  return fees;
};

module.exports = mongoose.model('EazShopShippingFees', eazshopShippingFeesSchema);

