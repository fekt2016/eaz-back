const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const crypto = require('crypto');
const _ = require('lodash');
const trim = _.trim;
const max = _.max;

const sellerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide your name'],
      trim: true,
      maxlength: [100, 'Name must be less than 50 characters'],
    },
    shopName: {
      type: String,
      required: [true, 'Please provide your store name'],
      trim: true,
      maxlength: [100, 'Name must be less than 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail, 'Please provide a valid email'],
      maxlength: [100, 'Email must be less than 50 characters'],
    },
    shopLocation: {
      type: {
        street: String,
        city: String,
        town: String,
        region: String,
        country: { type: String, default: 'Ghana' },
        postalCode: String,
      },
      default: {},
    },
    shopDescription: String,
    digitalAddress: String,
    socialMediaLinks: {
      facebook: String,
      instagram: String,
      twitter: String,
      TikTok: String,
    },
    avatar: String,
    ratings: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    sales: {
      totalSales: Number,
      monthlySales: Number,
    },
    verificationStatus: {
      type: String,
      enum: ['verified', 'rejected', 'pending'],
      default: 'pending',
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    verificationDocuments: {
      businessCert: { 
        type: mongoose.Schema.Types.Mixed,
        default: { url: '', status: 'pending', verifiedBy: null, verifiedAt: null },
      },
      idProof: { 
        type: mongoose.Schema.Types.Mixed,
        default: { url: '', status: 'pending', verifiedBy: null, verifiedAt: null },
      },
      addresProof: { 
        type: mongoose.Schema.Types.Mixed,
        default: { url: '', status: 'pending', verifiedBy: null, verifiedAt: null },
      },
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minLength: 8,
      select: false,
    },
    passwordConfirm: {
      type: String,
      required: [true, 'Please provide a passwordConfirm'],
      minLength: 8,
      select: false,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Balance must be at least 0'],
    },
    lockedBalance: {
      type: Number,
      default: 0,
      min: [0, 'Locked balance cannot be negative'],
    },
    pendingBalance: {
      type: Number,
      default: 0,
      min: [0, 'Pending balance cannot be negative'],
    },
  lockedReason: {
      type: String,
      default: null,
      comment: 'Reason for admin locking funds',
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    withdrawableBalance: {
      type: Number,
      default: 0,
      min: [0, 'Withdrawable balance cannot be negative'],
    },
    taxCategory: {
      type: String,
      enum: ['individual', 'company'],
      default: 'individual',
      comment: 'Tax category for withholding tax: individual (3%) or company (15%)',
    },
    paystackRecipientCode: {
      type: String,
      default: null,
      index: true,
    },
    paymentHistory: [
      {
        amount: { type: Number },
        method: {
          type: String,
          enum: [
            'bank',
            'mtn_momo',
            'vodafone_cash',
            'airtel_tigo_money',
            'cash',
          ],
          // required: true,
        },
        transactionId: { type: String },
        date: { type: Date, default: Date.now },
        status: {
          type: String,
          enum: ['pending', 'processing', 'paid', 'rejected'],
          default: 'pending',
        },
      },
    ],
    paymentMethods: {
      bankAccount: {
        accountNumber: { type: String, default: '' },
        accountName: { type: String, default: '' },
        bankName: {
          type: String,
          enum: [
            'GCB Bank',
            'Absa Ghana',
            'Stanbic Bank',
            'Ecobank Ghana',
            'Fidelity Bank',
            'CalBank',
            'Zenith Bank',
            'GT Bank',
            'Republic Bank',
            'Standard Chartered',
            'First National Bank',
          ],
          default: '',
        },
        bankCode: { type: String, default: '' }, // Paystack bank code (e.g., '044', '050')
        branch: { type: String, default: '' },
      },
      mobileMoney: {
        accountName: { type: String, },
        phone: {
          type: String,
          validate: {
            validator: function (v) {
              return /^0(24|54|55|59|20|50|27|57|26|56|23|28)\d{7}$/.test(v);
            },
            message: 'Invalid mobile money number',
          },
          default: '',
        },
        network: {
          type: String,
          enum: ['MTN', 'vodafone', 'airteltigo'],
          default: '',
        },
      },
    },
    productCount: {
      type: Number,
      default: 0,
    },
    role: { type: String, enum: ['seller', 'eazshop_store'], default: 'seller' },
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: { type: Boolean, default: true, select: false },
    status: {
      type: String,
      enum: ['active', 'deactive', 'pending'],
      default: 'pending',
    },
    passwordChangedAt: { type: Date, default: Date },
    otp: {
      type: String,
      select: false,
    },
    otpExpires: {
      type: Date,
      select: false,
    },
    otpType: String,
    // Onboarding & Verification System
    onboardingStage: {
      type: String,
      enum: ['profile_incomplete', 'pending_verification', 'verified'],
      default: 'profile_incomplete',
    },
    verification: {
      emailVerified: { type: Boolean, default: false },
      businessVerified: { type: Boolean, default: false },
    },
    requiredSetup: {
      hasAddedBusinessInfo: { type: Boolean, default: false },
      hasAddedBankDetails: { type: Boolean, default: false },
      hasAddedFirstProduct: { type: Boolean, default: false },
    },
    createdAt: {
      type: Date,
      default: Date.now(),
    },
    updatedAt: {
      type: Date,
      default: Date.now(),
    },
    lastLogin: { type: Date, default: Date.now() },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

sellerSchema.virtual('products', {
  ref: 'Product',
  foreignField: 'seller',
  localField: '_id',
});
sellerSchema.virtual('orders', {
  ref: 'Order',
  foreignField: 'seller',
  localField: '_id',
});
sellerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Middleware to auto-verify seller when email is verified and all three documents are verified
sellerSchema.pre('save', async function (next) {
  // Check if verificationDocuments or verification.emailVerified have been modified
  const documentsModified = this.isModified('verificationDocuments');
  const emailVerifiedModified = this.isModified('verification.emailVerified') || 
                               (this.isModified('verification') && this.verification?.emailVerified);
  
  if (!documentsModified && !emailVerifiedModified) return next();

  // Helper function to get document status (handles both old string format and new object format)
  const getDocumentStatus = (document) => {
    if (!document) return null;
    if (typeof document === 'string') return null; // Old format, can't determine status
    return document.status || null;
  };

  // Check if email is verified
  const isEmailVerified = this.verification?.emailVerified === true;

  // Check if all three documents exist and are verified
  const businessCertStatus = getDocumentStatus(this.verificationDocuments?.businessCert);
  const idProofStatus = getDocumentStatus(this.verificationDocuments?.idProof);
  const addresProofStatus = getDocumentStatus(this.verificationDocuments?.addresProof);

  // Check if all documents are verified
  const allDocumentsVerified = 
    businessCertStatus === 'verified' &&
    idProofStatus === 'verified' &&
    addresProofStatus === 'verified';

  // Also check if documents have URLs (they must be uploaded)
  const allDocumentsUploaded = 
    (this.verificationDocuments?.businessCert && 
     (typeof this.verificationDocuments.businessCert === 'string' || 
      this.verificationDocuments.businessCert.url)) &&
    (this.verificationDocuments?.idProof && 
     (typeof this.verificationDocuments.idProof === 'string' || 
      this.verificationDocuments.idProof.url)) &&
    (this.verificationDocuments?.addresProof && 
     (typeof this.verificationDocuments.addresProof === 'string' || 
      this.verificationDocuments.addresProof.url));

  // If email is verified AND all documents are verified and uploaded, auto-verify the seller
  if (isEmailVerified && allDocumentsVerified && allDocumentsUploaded) {
    // Only update if not already verified to avoid unnecessary updates
    if (this.verificationStatus !== 'verified' || this.onboardingStage !== 'verified') {
      this.verificationStatus = 'verified';
      this.onboardingStage = 'verified';
      this.verification.businessVerified = true;
      
      // Set verifiedBy and verifiedAt if not already set
      // Use the most recent document's verifiedBy as the seller's verifiedBy
      if (!this.verifiedBy) {
        const getVerifiedBy = (doc) => {
          if (typeof doc === 'string') return null;
          return doc?.verifiedBy || null;
        };
        
        const businessCertAdmin = getVerifiedBy(this.verificationDocuments.businessCert);
        const idProofAdmin = getVerifiedBy(this.verificationDocuments.idProof);
        const addresProofAdmin = getVerifiedBy(this.verificationDocuments.addresProof);
        
        // Use the most recent admin who verified (prefer the last one verified)
        this.verifiedBy = addresProofAdmin || idProofAdmin || businessCertAdmin;
      }
      
      if (!this.verifiedAt) {
        // Use the most recent document's verifiedAt as the seller's verifiedAt
        const getVerifiedAt = (doc) => {
          if (typeof doc === 'string') return null;
          return doc?.verifiedAt ? new Date(doc.verifiedAt) : null;
        };
        
        const dates = [
          getVerifiedAt(this.verificationDocuments.businessCert),
          getVerifiedAt(this.verificationDocuments.idProof),
          getVerifiedAt(this.verificationDocuments.addresProof),
        ].filter(Boolean);
        
        if (dates.length > 0) {
          // Use the most recent date
          this.verifiedAt = new Date(Math.max(...dates.map(d => d.getTime())));
        } else {
          this.verifiedAt = new Date();
        }
      }
    }
  } else {
    // If requirements are not met, revert to pending_verification if currently verified
    // This handles cases where email verification is removed or documents are rejected
    if (this.verificationStatus === 'verified' || this.onboardingStage === 'verified') {
      // Only revert if we're missing email or documents
      if (!isEmailVerified || !allDocumentsVerified || !allDocumentsUploaded) {
        this.verificationStatus = 'pending';
        this.onboardingStage = 'pending_verification';
        this.verification.businessVerified = false;
        // Don't clear verifiedBy and verifiedAt - keep history
      }
    }
  }

  next();
});
sellerSchema.pre(/^find/, function (next) {
  this.find({ active: { $ne: false } });
  next();
});
sellerSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};
sellerSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );

    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

sellerSchema.methods.createPasswordResetToken = function () {
  resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 6000;
  return resetToken;
};

// OTP methods
sellerSchema.methods.createOtp = function () {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiration
  return otp;
};

sellerSchema.methods.verifyOtp = function (candidateOtp) {
  return this.otp === candidateOtp && this.otpExpires > Date.now();
};
sellerSchema.methods.hasSufficientBalance = function (amount) {
  return this.balance >= amount;
};
sellerSchema.methods.lockFunds = function (amount) {
  if (amount > this.balance) {
    throw new Error('Insufficient balance');
  }

  this.balance -= amount;
  this.lockedBalance += amount;
};
sellerSchema.methods.releaseFunds = function (amount) {
  if (amount > this.lockedBalance) {
    throw new Error('Insufficient locked funds');
  }

  this.lockedBalance -= amount;
  this.balance += amount;
};

// Calculate withdrawable balance (balance - lockedBalance - pendingBalance)
// Formula: Available Balance = Total Balance - Dispute Locked Funds - Pending Withdrawals
// lockedBalance = funds locked by admin due to disputes/issues between buyer and seller
// pendingBalance = funds in withdrawal requests awaiting admin approval and OTP verification
sellerSchema.methods.calculateWithdrawableBalance = function () {
  this.withdrawableBalance = Math.max(0, this.balance - this.lockedBalance - (this.pendingBalance || 0));
  return this.withdrawableBalance;
};

// Pre-save hook to update withdrawable balance
sellerSchema.pre('save', function (next) {
  if (this.isModified('balance') || this.isModified('lockedBalance') || this.isModified('pendingBalance')) {
    this.calculateWithdrawableBalance();
  }
  next();
});

sellerSchema.methods.addPayment = function (payment) {
  this.paymentHistory.push(payment);
};
sellerSchema.statics.updateProductCount = async function (sellerId) {
  const Product = mongoose.model('Product');
  const count = await Product.countDocuments({ seller: sellerId });
  await this.findByIdAndUpdate(sellerId, { productCount: count });
};

const Seller = mongoose.model('Seller', sellerSchema);

module.exports = Seller;;
