const mongoose = require('mongoose');

const pickupCenterSchema = new mongoose.Schema(
  {
    pickupName: {
      type: String,
      required: [true, 'Pickup center name is required'],
      trim: true,
      maxlength: [200, 'Pickup center name must be less than 200 characters'],
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
      maxlength: [500, 'Address must be less than 500 characters'],
    },
    city: {
      type: String,
      required: true,
      enum: ['ACCRA', 'TEMA'],
      uppercase: true,
    },
    area: {
      type: String,
      required: [true, 'Area is required'],
      trim: true,
      maxlength: [100, 'Area must be less than 100 characters'],
    },
    googleMapLink: {
      type: String,
      trim: true,
      validate: {
        validator: function(v) {
          if (!v) return true; // Optional field
          return /^https?:\/\//.test(v);
        },
        message: 'Google Map link must be a valid URL',
      },
    },
    instructions: {
      type: String,
      trim: true,
      maxlength: [1000, 'Instructions must be less than 1000 characters'],
      default: '',
    },
    openingHours: {
      type: String,
      trim: true,
      maxlength: [200, 'Opening hours must be less than 200 characters'],
      default: 'Monday - Friday: 9:00 AM - 6:00 PM',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);



module.exports = mongoose.model('PickupCenter', pickupCenterSchema);

