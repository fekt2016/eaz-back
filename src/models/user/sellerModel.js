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
    phone: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone number must be less than 20 characters'],
      default: undefined,
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
    pickupLocations: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
          maxlength: 100,
        },
        region: {
          type: String,
          required: true,
          enum: [
            'Greater Accra',
            'Ashanti',
            'Central',
            'Eastern',
            'Western',
            'Western North',
            'Volta',
            'Oti',
            'Bono',
            'Bono East',
            'Ahafo',
            'Northern',
            'Savannah',
            'North East',
            'Upper East',
            'Upper West',
          ],
        },
        city: {
          type: String,
          required: true,
          trim: true,
          maxlength: 100,
        },
        address: {
          type: String,
          required: true,
          trim: true,
          maxlength: 500,
        },
        latitude: {
          type: Number,
          default: null,
        },
        longitude: {
          type: Number,
          default: null,
        },
        digitalAddress: {
          type: String,
          trim: true,
          maxlength: 15,
          default: null,
          validate: {
            validator: function(v) {
              if (!v) return true; // Optional field
              return /^[A-Z]{2}-\d{3}-\d{4}$/.test(v.toUpperCase());
            },
            message: 'Digital address must be in format AA-123-4567',
          },
        },
        contactName: {
          type: String,
          required: true,
          trim: true,
          maxlength: 100,
        },
        contactPhone: {
          type: String,
          required: true,
          trim: true,
          maxlength: 20,
        },
        isDefault: {
          type: Boolean,
          default: false,
        },
        notes: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: '',
        },
      },
    ],
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
      validate: {
        validator: function(value) {
          return value >= 0;
        },
        message: 'Pending balance cannot be negative'
      }
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
    lastBalanceResetBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
      comment: 'Admin who last reset the seller balance',
    },
    lastBalanceResetAt: {
      type: Date,
      default: null,
      comment: 'Timestamp when balance was last reset',
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
          default: undefined, // Changed from '' to undefined to avoid enum validation on empty
        },
        bankCode: { type: String, default: '' }, // Paystack bank code (e.g., '044', '050')
        branch: { type: String, default: '' },
        // Per-payment-method payout status
        payoutStatus: {
          type: String,
          enum: ['pending', 'verified', 'rejected'],
          default: 'pending',
          comment: 'Payout verification status for this specific bank account',
        },
        payoutVerifiedAt: { type: Date, default: null },
        payoutVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
        payoutRejectionReason: { type: String, default: null },
      },
      mobileMoney: {
        accountName: { type: String, default: '' },
        phone: {
          type: String,
          validate: {
            validator: function (v) {
              // Only validate if value is provided (not empty/undefined)
              if (!v || v === '') return true;
              return /^0(24|54|55|59|20|50|27|57|26|56|23|28)\d{7}$/.test(v);
            },
            message: 'Invalid mobile money number',
          },
          default: undefined, // Changed from '' to undefined
        },
        network: {
          type: String,
          enum: ['MTN', 'vodafone', 'airteltigo'],
          default: undefined, // Changed from '' to undefined to avoid enum validation on empty
        },
        // Per-payment-method payout status
        payoutStatus: {
          type: String,
          enum: ['pending', 'verified', 'rejected'],
          default: 'pending',
          comment: 'Payout verification status for this specific mobile money account',
        },
        payoutVerifiedAt: { type: Date, default: null },
        payoutVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
        payoutRejectionReason: { type: String, default: null },
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
      select: false, // Hashed OTP stored here
    },
    otpExpires: {
      type: Date,
      select: false,
    },
    otpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    otpLockedUntil: {
      type: Date,
      default: null,
      select: false,
    },
    otpType: String,
    // Two-Factor Authentication (2FA) fields - matching buyer model
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false, // Don't return in queries by default
    },
    twoFactorTempSecret: {
      type: String,
      select: false, // For setup process
    },
    twoFactorBackupCodes: {
      type: [String],
      select: false,
    },
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
    // NOTE: Global payoutStatus removed - use individual payment method payoutStatus instead
    // Check paymentMethods.bankAccount.payoutStatus and paymentMethods.mobileMoney.payoutStatus
    payoutVerificationHistory: [
      {
        action: {
          type: String,
          enum: ['verified', 'rejected'],
          required: true,
        },
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Admin',
          required: true,
        },
        reason: {
          type: String,
          default: null,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        paymentMethod: {
          type: String,
          enum: ['bank', 'mtn_momo', 'vodafone_cash', 'airtel_tigo_money'],
        },
        paymentDetails: {
          type: mongoose.Schema.Types.Mixed,
        },
      },
    ],
    requiredSetup: {
      hasAddedBusinessInfo: { type: Boolean, default: false },
      hasAddedBankDetails: { type: Boolean, default: false },
      hasAddedFirstProduct: { type: Boolean, default: false },
    },
    notificationSettings: {
      email: {
        orderUpdates: { type: Boolean, default: true },
        paymentNotifications: { type: Boolean, default: true },
        productAlerts: { type: Boolean, default: true },
        accountSecurity: { type: Boolean, default: true },
        marketingEmails: { type: Boolean, default: false },
      },
      push: {
        orderUpdates: { type: Boolean, default: true },
        newMessages: { type: Boolean, default: true },
        systemAlerts: { type: Boolean, default: true },
      },
      sms: {
        criticalAlerts: { type: Boolean, default: true },
        securityNotifications: { type: Boolean, default: true },
      },
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
    // SECURITY FIX #9: Session activity tracking for timeout
    lastActivity: { 
      type: Date, 
      default: Date.now,
      select: false, // Don't return in queries by default
    },
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

/**
 * Compute isSetupComplete - backend-driven setup completion check
 * Returns true if ALL of the following are true:
 * 1. All 3 business documents are uploaded AND verified
 * 2. At least one payment method exists AND is verified
 * 3. Email is verified OR phone exists
 */
sellerSchema.methods.computeIsSetupComplete = function() {
  // Helper function to get document status
  const getDocumentStatus = (document) => {
    if (!document) return null;
    if (typeof document === 'string') return null; // Old format, can't determine status
    return document.status || null;
  };

  // 1. Check documents: All 3 must exist, have URLs, AND be verified
  const businessCertStatus = getDocumentStatus(this.verificationDocuments?.businessCert);
  const idProofStatus = getDocumentStatus(this.verificationDocuments?.idProof);
  const addresProofStatus = getDocumentStatus(this.verificationDocuments?.addresProof);

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

  const allDocumentsVerified = 
    businessCertStatus === 'verified' &&
    idProofStatus === 'verified' &&
    addresProofStatus === 'verified';

  const documentsComplete = allDocumentsUploaded && allDocumentsVerified;

  // 2. Check payment method: At least one exists AND is verified
  const bankAccountPayoutStatus = this.paymentMethods?.bankAccount?.payoutStatus;
  const mobileMoneyPayoutStatus = this.paymentMethods?.mobileMoney?.payoutStatus;
  const hasPaymentMethodVerified = 
    bankAccountPayoutStatus === 'verified' || 
    mobileMoneyPayoutStatus === 'verified';

  // 3. Check contact: Email verified OR phone exists
  const isEmailVerified = this.verification?.emailVerified === true;
  const isPhoneVerified = this.phone && this.phone.trim() !== '';
  const contactComplete = isEmailVerified || isPhoneVerified;

  // All three must be complete
  return documentsComplete && hasPaymentMethodVerified && contactComplete;
};
sellerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Pre-save hook to clean up empty paymentMethods that would fail validation
sellerSchema.pre('save', function (next) {
  if (this.paymentMethods) {
    // Clean up bankAccount if it has empty enum fields
    if (this.paymentMethods.bankAccount) {
      if (!this.paymentMethods.bankAccount.bankName || this.paymentMethods.bankAccount.bankName === '') {
        this.paymentMethods.bankAccount.bankName = undefined;
      }
      // Remove bankAccount if all fields are empty
      const hasBankData = this.paymentMethods.bankAccount.bankName || 
                         this.paymentMethods.bankAccount.accountNumber || 
                         this.paymentMethods.bankAccount.accountName;
      if (!hasBankData) {
        this.paymentMethods.bankAccount = undefined;
      }
    }
    
    // Clean up mobileMoney if it has empty enum fields
    if (this.paymentMethods.mobileMoney) {
      if (!this.paymentMethods.mobileMoney.phone || this.paymentMethods.mobileMoney.phone === '') {
        this.paymentMethods.mobileMoney.phone = undefined;
      }
      if (!this.paymentMethods.mobileMoney.network || this.paymentMethods.mobileMoney.network === '') {
        this.paymentMethods.mobileMoney.network = undefined;
      }
      // Remove mobileMoney if all fields are empty
      const hasMobileData = this.paymentMethods.mobileMoney.phone || 
                           this.paymentMethods.mobileMoney.network || 
                           this.paymentMethods.mobileMoney.accountName;
      if (!hasMobileData) {
        this.paymentMethods.mobileMoney = undefined;
      }
    }
    
    // Remove paymentMethods entirely if both bankAccount and mobileMoney are empty
    if (!this.paymentMethods.bankAccount && !this.paymentMethods.mobileMoney) {
      this.paymentMethods = undefined;
    }
  }
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
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  // Fix: 10 minutes = 10 * 60 * 1000 milliseconds (not 6000)
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

// OTP methods with hashing
sellerSchema.methods.createOtp = function () {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Hash OTP before storing (SHA-256)
  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  
  // Store hashed OTP
  this.otp = hashedOtp;
  this.otpExpires = Date.now() + (process.env.OTP_EXPIRES_IN || 10) * 60 * 1000; // 10 minutes default
  this.otpAttempts = 0; // Reset attempts on new OTP
  this.otpLockedUntil = null; // Clear lockout
  
  console.log('[Seller createOtp] Generated OTP (hashed)');
  
  // Return plain OTP for sending (not hashed)
  return otp;
};

sellerSchema.methods.verifyOtp = function (candidateOtp) {
  // Check if account is locked
  if (this.otpLockedUntil && new Date(this.otpLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil((new Date(this.otpLockedUntil).getTime() - Date.now()) / (1000 * 60));
    console.log('[Seller verifyOtp] Account locked:', { minutesRemaining });
    return { valid: false, locked: true, minutesRemaining };
  }
  
  // Check if OTP exists
  if (!this.otp || !this.otpExpires) {
    return { valid: false, reason: 'no_otp' };
  }
  
  // Check if expired
  if (new Date(this.otpExpires).getTime() <= Date.now()) {
    const minutesExpired = Math.floor((Date.now() - new Date(this.otpExpires).getTime()) / (1000 * 60));
    return { valid: false, reason: 'expired', minutesExpired };
  }
  
  // Normalize candidate OTP
  const providedOtp = String(candidateOtp || '').trim().replace(/\D/g, '');
  
  if (providedOtp.length === 0 || providedOtp.length !== 6) {
    return { valid: false, reason: 'invalid_format' };
  }
  
  // Hash candidate OTP and compare
  const hashedCandidate = crypto.createHash('sha256').update(providedOtp).digest('hex');
  const otpMatch = this.otp === hashedCandidate;
  
  if (!otpMatch) {
    return { valid: false, reason: 'mismatch' };
  }
  
  // OTP is valid - reset attempts and lockout
  this.otpAttempts = 0;
  this.otpLockedUntil = null;
  
  return { valid: true };
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
  // PROTECTION: Ensure pendingBalance is never negative
  const safePendingBalance = Math.max(0, this.pendingBalance || 0);
  if (this.pendingBalance < 0) {
    console.warn(`[Seller Model] ⚠️ Negative pendingBalance detected for seller ${this._id}: ${this.pendingBalance}. Resetting to 0.`);
    this.pendingBalance = 0;
  }
  
  this.withdrawableBalance = Math.max(0, this.balance - this.lockedBalance - safePendingBalance);
  return this.withdrawableBalance;
};

// Pre-save hook to update withdrawable balance
sellerSchema.pre('save', function (next) {
  if (this.isModified('balance') || this.isModified('lockedBalance') || this.isModified('pendingBalance')) {
    this.calculateWithdrawableBalance();
  }
  next();
});

// Pre-save hook to detect payout detail changes and reset verification
sellerSchema.pre('save', async function (next) {
  // Check if paymentMethods are modified
  if (!this.isModified('paymentMethods')) {
    return next();
  }

  // Get the original document to compare
  if (this.isNew) {
    return next(); // New seller, no previous payout to compare
  }

  try {
    const originalSeller = await this.constructor.findById(this._id).select('paymentMethods');
    if (!originalSeller) {
      return next(); // Original not found, skip check
    }

    // Compare bank account details
    const bankAccountChanged = 
      (this.paymentMethods?.bankAccount?.accountNumber || '') !== (originalSeller.paymentMethods?.bankAccount?.accountNumber || '') ||
      (this.paymentMethods?.bankAccount?.accountName || '') !== (originalSeller.paymentMethods?.bankAccount?.accountName || '') ||
      (this.paymentMethods?.bankAccount?.bankName || '') !== (originalSeller.paymentMethods?.bankAccount?.bankName || '');

    // Compare mobile money details
    const mobileMoneyChanged =
      (this.paymentMethods?.mobileMoney?.phone || '') !== (originalSeller.paymentMethods?.mobileMoney?.phone || '') ||
      (this.paymentMethods?.mobileMoney?.network || '') !== (originalSeller.paymentMethods?.mobileMoney?.network || '') ||
      (this.paymentMethods?.mobileMoney?.accountName || '') !== (originalSeller.paymentMethods?.mobileMoney?.accountName || '');

    // If bank account details changed, reset bank account payout status
    if (bankAccountChanged && this.paymentMethods?.bankAccount) {
      const bankStatus = originalSeller.paymentMethods?.bankAccount?.payoutStatus;
      if (bankStatus === 'verified' || bankStatus === 'rejected') {
        this.paymentMethods.bankAccount.payoutStatus = 'pending';
        this.paymentMethods.bankAccount.payoutVerifiedAt = null;
        this.paymentMethods.bankAccount.payoutVerifiedBy = null;
        this.paymentMethods.bankAccount.payoutRejectionReason = null;
      }
    }

    // If mobile money details changed, reset mobile money payout status
    if (mobileMoneyChanged && this.paymentMethods?.mobileMoney) {
      const mobileStatus = originalSeller.paymentMethods?.mobileMoney?.payoutStatus;
      if (mobileStatus === 'verified' || mobileStatus === 'rejected') {
        this.paymentMethods.mobileMoney.payoutStatus = 'pending';
        this.paymentMethods.mobileMoney.payoutVerifiedAt = null;
        this.paymentMethods.mobileMoney.payoutVerifiedBy = null;
        this.paymentMethods.mobileMoney.payoutRejectionReason = null;
      }
    }

    // No global payoutStatus - each payment method has its own payoutStatus

    // Also reset PaymentMethod verificationStatus for matching records
    // This keeps PaymentMethod and Seller payout status in sync
    try {
      const PaymentMethod = mongoose.model('PaymentMethod');
      const User = mongoose.model('User');
      
      // Find User account for this seller (if exists)
      const userAccount = await User.findOne({ email: this.email });
      if (userAccount) {
        // Find matching PaymentMethod records and reset their verification status
        let matchingPaymentMethods = [];
        
        // Check bank account changes
        if (bankAccountChanged && this.paymentMethods?.bankAccount?.accountNumber) {
          const accountNumber = this.paymentMethods.bankAccount.accountNumber.replace(/\s+/g, '');
          const bankMethods = await PaymentMethod.find({
            user: userAccount._id,
            type: 'bank_transfer',
            accountNumber: accountNumber,
          });
          matchingPaymentMethods.push(...bankMethods);
        }
        
        // Check mobile money changes
        if (mobileMoneyChanged && this.paymentMethods?.mobileMoney?.phone) {
          const normalizedPhone = this.paymentMethods.mobileMoney.phone.replace(/\D/g, '');
          const mobileMethods = await PaymentMethod.find({
            user: userAccount._id,
            type: 'mobile_money',
            mobileNumber: normalizedPhone,
          });
          matchingPaymentMethods.push(...mobileMethods);
        }
        
        // Reset verification status for all matching PaymentMethod records
        if (matchingPaymentMethods.length > 0) {
          for (const pm of matchingPaymentMethods) {
            pm.verificationStatus = 'pending';
            pm.verifiedAt = null;
            pm.verifiedBy = null;
            pm.rejectionReason = null;
            
            // Add to verification history
            if (!pm.verificationHistory) {
              pm.verificationHistory = [];
            }
            pm.verificationHistory.push({
              status: 'pending',
              adminId: null, // System-initiated reset
              reason: 'Payment details changed - verification reset',
              timestamp: new Date(),
            });
            
            await pm.save({ validateBeforeSave: false });
          }
          console.log(`[Seller Model] Reset ${matchingPaymentMethods.length} PaymentMethod verification status(es) for seller ${this._id}`);
        }
      }
    } catch (paymentMethodError) {
      console.error('[Seller Model] Error resetting PaymentMethod verification status:', paymentMethodError);
      // Don't fail seller save if PaymentMethod update fails
    }

    // Add to verification history only if payment methods actually changed
    if (bankAccountChanged || mobileMoneyChanged) {
      if (!this.payoutVerificationHistory) {
        this.payoutVerificationHistory = [];
      }
      this.payoutVerificationHistory.push({
        action: 'rejected', // Treat as rejection due to change
        adminId: null, // System-initiated
        reason: 'Payout details changed - verification reset',
        timestamp: new Date(),
        paymentMethod: this.paymentMethods?.bankAccount ? 'bank' : 
                      this.paymentMethods?.mobileMoney ? 
                        (this.paymentMethods.mobileMoney.network === 'MTN' ? 'mtn_momo' :
                         this.paymentMethods.mobileMoney.network === 'Vodafone' ? 'vodafone_cash' :
                         'airtel_tigo_money') : null,
        paymentDetails: this.paymentMethods?.bankAccount || this.paymentMethods?.mobileMoney,
      });

      console.log(`[Seller Model] Payout details changed for seller ${this._id}. Verification reset to pending.`);

      // Check for pending withdrawals and log warning
      try {
        const PaymentRequest = mongoose.model('PaymentRequest');
        const pendingWithdrawals = await PaymentRequest.countDocuments({
          seller: this._id,
          status: 'pending',
          isActive: true,
        });

        if (pendingWithdrawals > 0) {
          console.warn(`[Seller Model] ⚠️ Seller ${this._id} has ${pendingWithdrawals} pending withdrawal(s). These should be reviewed as payout details have changed.`);
          // Note: We don't automatically cancel withdrawals, but admin should review them
        }
      } catch (withdrawalCheckError) {
        console.error('[Seller Model] Error checking pending withdrawals:', withdrawalCheckError);
        // Don't fail save if withdrawal check fails
      }
    }
  } catch (error) {
    console.error('[Seller Model] Error checking payout detail changes:', error);
    // Don't fail save if check fails
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
