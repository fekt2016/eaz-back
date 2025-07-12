const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    streetAddress: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    city: {
      type: String,
      required: true,
      trim: true,
      enum: [
        'Accra',
        'Kumasi',
        'Tamale',
        'Sekondi-Takoradi',
        'Ashaiman',
        'Sunyani',
        'Cape Coast',
        'Obuasi',
        'Teshie',
        'Tema',
        'Madina',
        'Koforidua',
        'Wa',
        'Ho',
        'Bolgatanga',
        'Techiman',
        'Nkawkaw',
      ],
    },
    region: {
      type: String,
      required: true,
      enum: [
        'Greater Accra',
        'Ashanti',
        'Western',
        'Central',
        'Eastern',
        'Volta',
        'Northern',
        'Upper East',
        'Upper West',
        'Bono',
        'Ahafo',
        'Bono East',
        'Oti',
        'Savannah',
        'North East',
        'Western North',
      ],
    },
    digitalAddress: {
      type: String,
      trim: true,
      uppercase: true,
      set: function (v) {
        // Format the value before saving
        const cleaned = v.replace(/[^A-Z0-9]/g, ''); // Remove all non-alphanumeric characters

        if (/^[A-Z]{2}\d{7}$/.test(cleaned)) {
          // Format as GA-123-4567 if valid
          return `${cleaned.substring(0, 2)}-${cleaned.substring(2, 5)}-${cleaned.substring(5)}`;
        }
        return v; // Return original if not valid format
      },
      validate: {
        validator: function (v) {
          // Strict validation
          return /^[A-Z]{2}-\d{3}-\d{4}$/.test(v);
        },
        message: (props) =>
          `${props.value} is not a valid Ghana digital address! Please use format: GA-123-4567`,
      },
    },
    contactPhone: {
      type: String,
      required: [true, 'Contact phone number is required'],
      set: function (v) {
        // Remove all non-digit characters
        const digits = v.replace(/\D/g, '');

        // Convert 233-prefixed numbers to 0-prefixed format
        if (digits.startsWith('233') && digits.length === 12) {
          return '0' + digits.substring(3);
        }

        return digits;
      },
      validate: {
        validator: function (v) {
          // Validate Ghana phone numbers (10 digits starting with valid prefixes)
          return /^(020|023|024|025|026|027|028|029|050|054|055|056|057|059)\d{7}$/.test(
            v,
          );
        },
        message: (props) => `${props.value} is not a valid Ghana phone number!`,
      },
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    addressType: {
      type: String,
      enum: ['Home', 'Work', 'Business', 'Other'],
      default: 'Home',
    },
    additionalInstructions: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for full address string
addressSchema.virtual('fullAddress').get(function () {
  return `${this.streetAddress}, ${this.landmark ? this.landmark + ', ' : ''}${this.city}, ${this.region}, Ghana`;
});

// Pre-save hook to handle default address logic
addressSchema.pre('save', async function (next) {
  if (this.isDefault) {
    try {
      await mongoose
        .model('Address')
        .updateMany(
          { user: this.user, _id: { $ne: this._id } },
          { $set: { isDefault: false } },
        );
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Indexes for faster queries
addressSchema.index({ user: 1 });
addressSchema.index({ region: 1 });
addressSchema.index({ city: 1 });
addressSchema.index({ isDefault: 1 });

module.exports = mongoose.model('Address', addressSchema);
