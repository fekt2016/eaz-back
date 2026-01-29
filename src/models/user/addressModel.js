const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    streetAddress: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    area: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
      // This field represents the neighborhood/area name (e.g., "Nima", "Cantonments", "Tema Community 1")
      // Used for shipping zone calculation
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
      lowercase: true,
      enum: ['accra', 'tema'],
      validate: {
        validator: function(v) {
          return ['accra', 'tema'].includes(v.toLowerCase());
        },
        message: 'Saiisai currently delivers only in Accra and Tema.',
      },
    },
    region: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: [
        'greater accra',
        'ashanti',
        'western',
        'central',
        'eastern',
        'volta',
        'northern',
        'upper east',
        'upper west',
        'bono',
        'ahafo',
        'bono east',
        'oti',
        'savannah',
        'north east',
        'western north',
      ],
      validate: {
        validator: function(v) {
          // Ensure it's "greater accra" not "greater accra region"
          const normalized = v.toLowerCase().trim();
          if (normalized === 'greater accra region') {
            return false;
          }
          return this.constructor.schema.path('region').enumValues.includes(normalized);
        },
        message: 'Invalid region. Use "greater accra" (not "greater accra region").',
      },
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
    additionalInformation: {
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
  const parts = [this.streetAddress];
  if (this.area) parts.push(this.area);
  if (this.landmark) parts.push(this.landmark);
  parts.push(this.city, this.region, 'Ghana');
  return parts.join(', ');
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

module.exports = mongoose.model('Address', addressSchema);;
