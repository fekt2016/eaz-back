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

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);
module.exports = PaymentMethod;;
