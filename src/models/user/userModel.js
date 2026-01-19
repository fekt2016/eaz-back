const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Permission = require('./permissionModel');
const logger = require('../../utils/logger');

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: {
      type: String,
      // Required validation handled in pre-save hook (at least one of email or phone must be provided)
      unique: true,
      sparse: true, // Allow multiple documents with null/undefined email
      lowercase: true,
      validate: {
        validator: function(value) {
          // If email is provided, it must be valid
          if (value) {
            return validator.isEmail(value);
          }
          // If email is not provided, phone must be provided (handled by pre-save hook)
          return true;
        },
        message: 'Please provide a valid email address',
      },
    },
    phone: {
      type: Number,
      // Required validation handled in pre-save hook (at least one of email or phone must be provided)
      unique: true,
      sparse: true, // Allow multiple null values (unique only for non-null values)
      required: false, // Phone is optional - email-only login is supported
    },
    photo: { type: String, default: 'default.jpg' },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
      default: null,
    },
    dateOfBirth: {
      type: Date,
      default: null,
      validate: {
        validator: function (date) {
          if (!date) return true; // Allow null/undefined
          // Ensure date is not in the future
          return date <= new Date();
        },
        message: 'Date of birth cannot be in the future',
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
      validate: {
        //this is only on save and create
        validator: function (el) {
          return el === this.password;
        },
        message: 'passwords are not the same ',
      },
    },
    wishList: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WishList',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    role: { type: String, enum: ['user', 'seller', 'admin', 'driver', 'eazshop_store'], default: 'user' },
    address: String,

    passwordChangedAt: { type: Date, default: Date.now() },
    passwordResetToken: String,
    passwordResetExpires: Date,
    pin: {
      type: String,
      select: false, // Don't return PIN in queries by default
    },
    pinChangedAt: { type: Date, default: null },
    active: { type: Boolean, default: true, select: false },
    status: {
      type: String,
      enum: ['active', 'deactive', 'pending'],
      default: 'active',
    },
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
    permissions: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Permission',
    },
    connectedAccounts: {
      google: { type: Boolean, default: false },
      facebook: { type: Boolean, default: false },
      // Add other providers as needed
    },
    // ====== ENHANCED DATA EXPORT FEATURES ======
    dataExports: [
      {
        status: {
          type: String,
          enum: ['pending', 'processing', 'completed', 'failed', 'expired'],
          default: 'pending',
        },
        requestedAt: { type: Date, default: Date.now },
        completedAt: Date,
        downloadUrl: String,
        expiresAt: Date,
        exportId: { type: mongoose.Schema.Types.ObjectId, auto: true },
      },
    ],
    // ====== ENHANCED ACCOUNT DELETION FEATURES ======
    accountDeletion: {
      scheduledAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'cancelled', null],
        default: null,
      },
      reason: { type: String, default: null },
      cancelledAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      requestedAt: { type: Date, default: null }, // Added requestedAt
    },
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
    otpVerified: {
      type: Boolean,
      default: false,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    createdAt: { type: Date, default: Date.now() },
    lastLogin: { type: Date, default: Date.now },
    // SECURITY FIX #9: Session activity tracking for timeout
    lastActivity: { 
      type: Date, 
      default: Date.now,
      select: false, // Don't return in queries by default
    },
  },
  {
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // Remove sensitive fields when converting to JSON
        delete ret.password;
        delete ret.passwordConfirm;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.pin;
        delete ret.twoFactorSecret;
        delete ret.twoFactorTempSecret;
        delete ret.twoFactorBackupCodes;
        delete ret.twoFactorTempSecret;
        delete ret.twoFactorBackupCodes;
        delete ret.otp;
        delete ret.otpExpires;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// Validate that at least one of email or phone is provided
userSchema.pre('save', function (next) {
  // Only validate for new documents or when email/phone are being modified
  if (this.isNew || this.isModified('email') || this.isModified('phone')) {
    if (!this.email && !this.phone) {
      return next(new Error('Please provide either email or phone number'));
    }
  }
  next();
});

userSchema.pre('save', function (next) {
  // Initialize accountDeletion for new users
  if (this.isNew && !this.accountDeletion) {
    this.accountDeletion = {
      scheduledAt: null,
      status: null,
      reason: null,
      cancelledAt: null,
      completedAt: null,
      requestedAt: null,
    };
  }
  next();
});
userSchema.index({
  'accountDeletion.status': 1,
  'accountDeletion.scheduledAt': 1,
  'accountDeletion.requestedAt': 1,
});
userSchema.virtual('isDeletionScheduled').get(function () {
  return (
    this.accountDeletion &&
    this.accountDeletion.status === 'pending' &&
    this.accountDeletion.scheduledAt > new Date()
  );
});
userSchema.methods.cancelAccountDeletion = function () {
  if (this.accountDeletion && this.accountDeletion.status === 'pending') {
    this.accountDeletion.status = 'cancelled';
    this.accountDeletion.cancelledAt = new Date();
    return this.save();
  }
  throw new Error('No pending deletion to cancel');
};

userSchema.virtual('activeExports').get(function () {
  if (!this.dataExports) return [];
  return this.dataExports.filter(
    (expert) =>
      expert.status === 'pending' ||
      expert.status === 'processing' ||
      (expert.status === 'completed' && expert.expiresAt > new Date()),
  );
});
userSchema.virtual('securitySettings').get(function () {
  return {
    twoFactorEnabled: this.twoFactorEnabled,
    lastPasswordChange: this.passwordChangedAt,
    // Check pinChangedAt instead of pin since pin is select: false
    // If pinChangedAt exists, user has a PIN set
    hasPin: !!this.pinChangedAt,
    lastPinChange: this.pinChangedAt,
    // Add other security-related fields as needed
  };
});
userSchema.pre('save', async function (next) {
  //Only run this function if passworld was actually modified
  if (!this.isModified('password')) return next();
  //hash the password with bcrypt

  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Hash PIN before saving
userSchema.pre('save', async function (next) {
  // Only run this function if PIN was actually modified
  if (!this.isModified('pin')) return next();
  // Hash the PIN with bcrypt (same strength as password)
  if (this.pin) {
    this.pin = await bcrypt.hash(this.pin, 12);
  }
  next();
});
userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();
  // -1s to make sure the token is created after the password has been changed
  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// Update PIN changed timestamp
userSchema.pre('save', function (next) {
  // Skip for new documents (they'll set it when PIN is first created)
  if (this.isNew) return next();
  
  // If PIN is being set or modified, update timestamp
  if (this.isModified('pin') && this.pin) {
    // If pinChangedAt doesn't exist, this is the first time setting PIN
    // If it exists, this is a PIN reset
    this.pinChangedAt = Date.now();
  }
  next();
});
userSchema.pre(/^find/, function (next) {
  //this points to the current query
  this.find({ active: { $ne: false } });
  next();
});

// userSchema.methods.correctPassword = async function (
//   userPassword,
//   candidatePassword,
// ) {
//   logger.info('candidatePassword', candidatePassword);
//   logger.info('userPassword', userPassword);
//   const user = await bcrypt.compare(userPassword, candidatePassword);
//   logger.info('user', user);
//   return user;
// };
userSchema.methods.correctPassword = async function (candidatePassword) {
  logger.info('candidatePassword', candidatePassword);
  logger.info('userPassword', this.password);
  return await bcrypt.compare(candidatePassword, this.password);
};

// Verify PIN method
userSchema.methods.correctPin = async function (candidatePin) {
  if (!this.pin) {
    return false;
  }
  return await bcrypt.compare(candidatePin, this.pin);
};
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );

    return JWTTimestamp < changedTimestamp;
  }
  return false;
};
userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Fix: 10 minutes = 10 * 60 * 1000 milliseconds (not 6000)
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};
userSchema.methods.createOtp = function () {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Hash OTP before storing (SHA-256)
  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  
  // Store hashed OTP
  this.otp = hashedOtp;
  this.otpExpires = Date.now() + (process.env.OTP_EXPIRES_IN || 10) * 60 * 1000; // 10 minutes default
  this.otpAttempts = 0; // Reset attempts on new OTP
  this.otpLockedUntil = null; // Clear lockout
  
  logger.info('[createOtp] Generated OTP (hashed);:', { 
    expires: new Date(this.otpExpires).toISOString(),
    expiresIn: process.env.OTP_EXPIRES_IN || 10 
  });
  
  // Return plain OTP for sending (not hashed)
  return otp;
};

// Add OTP verification method with hashing
userSchema.methods.verifyOtp = function (candidateOtp) {
  // Check if account is locked
  if (this.otpLockedUntil && new Date(this.otpLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil((new Date(this.otpLockedUntil).getTime() - Date.now()) / (1000 * 60));
    logger.info('[verifyOtp] Account locked:', { minutesRemaining });
    return { valid: false, locked: true, minutesRemaining };
  }
  
  // Check if OTP exists
  if (!this.otp) {
    logger.info('[verifyOtp] No OTP stored for user');
    return { valid: false, reason: 'no_otp' };
  }
  
  // Check if OTP has expired
  if (!this.otpExpires) {
    logger.info('[verifyOtp] No expiration time set for OTP');
    return { valid: false, reason: 'no_expiry' };
  }
  
  const now = Date.now();
  const expiresAt = new Date(this.otpExpires).getTime();
  
  if (expiresAt <= now) {
    const minutesExpired = Math.floor((now - expiresAt) / (1000 * 60));
    logger.info('[verifyOtp] OTP expired:', { minutesExpired });
    return { valid: false, reason: 'expired', minutesExpired };
  }
  
  // Normalize candidate OTP (remove non-digits)
  const providedOtp = String(candidateOtp || '').trim().replace(/\D/g, '');
  
  if (providedOtp.length === 0 || providedOtp.length !== 6) {
    logger.info('[verifyOtp] Invalid OTP format:', { length: providedOtp.length });
    return { valid: false, reason: 'invalid_format' };
  }
  
  // Hash candidate OTP and compare with stored hash
  const hashedCandidate = crypto.createHash('sha256').update(providedOtp).digest('hex');
  const otpMatch = this.otp === hashedCandidate;
  
  if (!otpMatch) {
    logger.info('[verifyOtp] OTP mismatch');
    return { valid: false, reason: 'mismatch' };
  }
  
  // OTP is valid - reset attempts and lockout
  this.otpAttempts = 0;
  this.otpLockedUntil = null;
  
  logger.info('[verifyOtp] OTP verified successfully');
  return { valid: true };
};

//password methods

// Data Export Methods
userSchema.methods.requestDataExport = function () {
  const newExport = {
    status: 'pending',
    requestedAt: new Date(),
  };

  this.dataExports.push(newExport);
  return this.save();
};

userSchema.methods.cancelDataExport = function (exportId) {
  const exportReq = this.dataExports.id(exportId);
  if (exportReq && exportReq.status === 'pending') {
    exportReq.status = 'cancelled';
    return this.save();
  }
  return Promise.reject(new Error('Export not found or not cancellable'));
};

userSchema.methods.cancelAccountDeletion = function () {
  if (this.accountDeletion && this.accountDeletion.status === 'pending') {
    this.accountDeletion.status = 'cancelled';
    this.accountDeletion.cancelledAt = new Date();
    return this.save();
  }
  return Promise.reject(new Error('No pending deletion to cancel'));
};

userSchema.methods.scheduleAccountDeletion = function (reason = '') {
  const gracePeriod = 30 * 24 * 60 * 60 * 1000; // 30 days
  const scheduledAt = new Date(Date.now() + gracePeriod);

  this.accountDeletion = {
    scheduledAt,
    status: 'pending',
    reason,
    requestedAt: new Date(),
    cancelledAt: null,
    completedAt: null,
  };

  return this.save();
};
userSchema.post('save', async function (doc, next) {
  // CRITICAL FIX: Make permission creation non-blocking
  // If permission creation fails, log it but don't fail the user creation
  // This prevents 500 errors when permission creation has issues
  try {
    // Only create permission if it doesn't exist
    if (!doc.permissions) {
      // Check if permission already exists in DB
      const existingPermission = await Permission.findOne({ user: doc._id });

      if (existingPermission) {
        // Link existing permission
        doc.permissions = existingPermission._id;
        await doc.save({ validateBeforeSave: false });
      } else {
        // Create new permission
        const permission = new Permission({ user: doc._id });
        await permission.save();
        doc.permissions = permission._id;
        await doc.save({ validateBeforeSave: false });
      }
    }
    next();
  } catch (error) {
    // Handle duplicate key error specifically
    if (error.code === 11000) {
      logger.warn(`[User Model] Duplicate permission prevented for user ${doc._id}`);
      try {
        const existing = await Permission.findOne({ user: doc._id });
        if (existing) {
          doc.permissions = existing._id;
          await doc.save({ validateBeforeSave: false });
        }
      } catch (linkError) {
        logger.error(`[User Model] Failed to link existing permission for user ${doc._id}:`, linkError.message);
      }
      return next(); // Don't fail user creation
    }
    
    // For other errors, log but don't fail user creation
    // Permission creation is not critical - user can still function without it
    logger.error(`[User Model] Permission creation failed for user ${doc._id}:`, {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    
    // Continue without failing - user creation should succeed even if permission creation fails
    next();
  }
});
userSchema.methods.createEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
  this.emailVerificationExpires = Date.now() + 10 * 60 * 6000;
  return verificationToken;
};

const User = mongoose.model('User', userSchema);

module.exports = User;;
