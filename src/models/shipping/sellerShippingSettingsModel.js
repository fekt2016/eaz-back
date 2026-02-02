const mongoose = require('mongoose');

const sellerShippingSettingsSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      unique: true,
    },
    sameCityShippingFee: {
      type: Number,
      required: true,
      default: 20, // GHS
      min: [0, 'Shipping fee must be positive'],
    },
    crossCityShippingFee: {
      type: Number,
      required: true,
      default: 30, // GHS
      min: [0, 'Shipping fee must be positive'],
    },
    heavyItemShippingFee: {
      type: Number,
      required: true,
      default: 50, // GHS
      min: [0, 'Shipping fee must be positive'],
    },
    pickupAvailable: {
      type: Boolean,
      default: false,
    },
    sellerDeliveryAvailable: {
      type: Boolean,
      default: true,
    },
    expressAvailable: {
      type: Boolean,
      default: false,
    },
    expressSurcharge: {
      type: Number,
      default: 15, // additional fee if express is chosen
      min: [0, 'Express surcharge must be positive'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// seller field has unique: true so Mongoose already creates an index; no duplicate schema.index

// Static method to get or create default settings
sellerShippingSettingsSchema.statics.getOrCreateDefault = async function (sellerId) {
  let settings = await this.findOne({ seller: sellerId });
  
  if (!settings) {
    settings = await this.create({
      seller: sellerId,
      sameCityShippingFee: 20,
      crossCityShippingFee: 30,
      heavyItemShippingFee: 50,
      pickupAvailable: false,
      expressAvailable: false,
      expressSurcharge: 15,
    });
  }
  
  return settings;
};

module.exports = mongoose.model('SellerShippingSettings', sellerShippingSettingsSchema);

