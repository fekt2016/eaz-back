const mongoose = require('mongoose');
const logger = require('../../utils/logger');

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
      //   logger.info('this.type', this.type);
      //   return this.type === 'mobile_money';
      // },
    },
    mobileNumber: {
      type: String,
      // required: function () {
      //   logger.info('this.type', this.type);
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
    // Enhanced status lifecycle: draft → pending → verified → active → rejected → suspended
    status: {
      type: String,
      enum: ['draft', 'pending', 'verified', 'active', 'rejected', 'suspended'],
      default: 'draft',
      comment: 'Payment method status lifecycle',
    },
    // Legacy field for backward compatibility (maps to status)
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      comment: 'Legacy: Payment method verification status - maps to status field',
    },
    // Ownership verification (provider-initiated)
    ownershipVerified: {
      type: Boolean,
      default: false,
      comment: 'Whether ownership has been verified via provider (USSD/STK)',
    },
    ownershipVerifiedAt: {
      type: Date,
      default: null,
      comment: 'Timestamp when ownership was verified',
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
    // Tracking and security
    lastEditedAt: {
      type: Date,
      default: null,
      comment: 'Last time payment method was edited',
    },
    editCount: {
      type: Number,
      default: 0,
      comment: 'Number of times payment method has been edited',
    },
    fraudScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      comment: 'Fraud risk score (0-100)',
    },
    lockReason: {
      type: String,
      default: null,
      comment: 'Reason why payment method is locked (e.g., active payout)',
    },
    lockExpiresAt: {
      type: Date,
      default: null,
      comment: 'When the lock expires',
    },
    verificationHistory: [
      {
        status: { 
          type: String, 
          enum: ['draft', 'pending', 'verified', 'active', 'rejected', 'suspended'], 
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
        paymentDetails: {
          type: mongoose.Schema.Types.Mixed,
          comment: 'Snapshot of payment details at time of status change',
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




// Middleware to sync verificationStatus with status for backward compatibility
paymentMethodSchema.pre('save', function (next) {
  // Map status to verificationStatus for backward compatibility
  if (this.status === 'verified' || this.status === 'active') {
    this.verificationStatus = 'verified';
  } else if (this.status === 'rejected') {
    this.verificationStatus = 'rejected';
  } else {
    this.verificationStatus = 'pending';
  }
  
  // Update lastEditedAt if fields changed
  if (this.isModified('accountNumber') || this.isModified('mobileNumber') || 
      this.isModified('bankName') || this.isModified('provider') || 
      this.isModified('accountName')) {
    this.lastEditedAt = new Date();
    this.editCount = (this.editCount || 0) + 1;
  }
  
  next();
});

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
