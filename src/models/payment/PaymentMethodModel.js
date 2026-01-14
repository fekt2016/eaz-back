const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['mobile_money', 'bank_transfer'],
      default: 'mobile_money',
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    // Common fields
    name: {
      type: String,
      // required: true,
      trim: true,
    },

    // Mobile money specific fields
    provider: {
      type: String,
      enum: ['MTN', 'Vodafone', 'AirtelTigo'],
      // required: function () {
      //   console.log('this.type', this.type);
      //   return this.type === 'mobile_money';
      // },
    },
    mobileNumber: {
      type: String,
      // required: function () {
      //   console.log('this.type', this.type);
      //   return this.type === 'mobile_money';
      // },
      trim: true,
    },

    // Bank transfer specific fields
    bankName: {
      type: String,
      // required: function () {
      //   return this.type === 'bank_transfer';
      // },
      trim: true,
    },
    accountNumber: {
      type: String,
      // required: function () {
      //   return this.type === 'bank_transfer';
      // },
      trim: true,
    },
    accountName: {
      type: String,
      // required: function () {
      //   return this.type === 'bank_transfer';
      // },
      trim: true,
    },
    branch: {
      type: String,
      trim: true,
    },
    // Verification status for payment method
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      comment: 'Payment method verification status - must be verified before use',
    },
    verifiedAt: {
      type: Date,
      default: null,
      comment: 'Timestamp when payment method was verified',
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
      comment: 'Admin who verified the payment method',
    },
    rejectionReason: {
      type: String,
      default: null,
      comment: 'Reason for payment method verification rejection',
    },
    verificationHistory: [
      {
        status: { 
          type: String, 
          enum: ['pending', 'verified', 'rejected'], 
          required: true 
        },
        reason: { type: String },
        adminId: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: 'Admin' 
        },
        timestamp: { 
          type: Date, 
          default: Date.now 
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);




// Middleware to ensure only one default payment method per user
paymentMethodSchema.pre('save', async function (next) {
  if (this.isDefault) {
    await this.constructor.updateMany(
      { user: this.user, isDefault: true },
      { $set: { isDefault: false } },
    );
  }
  next();
});

// Pre-save hook to prevent duplicate payment methods for the same user
paymentMethodSchema.pre('save', async function (next) {
  // Only check for duplicates if this is a new document or if account number/phone changed
  if (this.isNew || this.isModified('accountNumber') || this.isModified('mobileNumber')) {
    try {
      // Normalize identifiers
      let identifier = null;
      let query = { user: this.user };
      
      if (this.type === 'bank_transfer' && this.accountNumber) {
        const normalizedAccountNumber = this.accountNumber.replace(/\s+/g, '');
        query.type = 'bank_transfer';
        query.accountNumber = normalizedAccountNumber;
        identifier = 'bank account';
      } else if (this.type === 'mobile_money' && this.mobileNumber) {
        const normalizedPhone = this.mobileNumber.replace(/\D/g, '');
        query.type = 'mobile_money';
        query.mobileNumber = normalizedPhone;
        identifier = 'mobile money number';
      }
      
      if (identifier) {
        // Exclude current document if updating
        if (!this.isNew) {
          query._id = { $ne: this._id };
        }
        
        const existing = await this.constructor.findOne(query);
        if (existing) {
          return next(new Error(
            `A ${identifier} payment method already exists for this account. Please use the existing payment method or update it.`
          ));
        }
      }
    } catch (error) {
      return next(error);
    }
  }
  next();
});

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);
module.exports = PaymentMethod;;
