const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Permission = require('./permissionModel');

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail],
    },
    phone: {
      type: Number,
      unique: true,
      required: [true, 'Please provide your phone number'],
    },
    photo: { type: String, default: 'default.jpg' },
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
    active: { type: Boolean, default: true, select: false },
    status: {
      type: String,
      enum: ['active', 'deactive', 'pending'],
      default: 'active',
    },
    // twoFactorEnabled: {
    //   type: Boolean,
    //   default: false,
    // },
    // twoFactorSecret: String,
    // twoFactorTempSecret: String, // For setup process
    // twoFactorBackupCodes: [String],
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
      select: false,
    },
    otpExpires: {
      type: Date,
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
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    createdAt: { type: Date, default: Date.now() },
    lastLogin: { type: Date, default: Date.now },
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
        delete ret.twoFactorSecret;
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
userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();
  // -1s to make sure the token is created after the password has been changed
  this.passwordChangedAt = Date.now() - 1000;
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
//   console.log('candidatePassword', candidatePassword);
//   console.log('userPassword', userPassword);
//   const user = await bcrypt.compare(userPassword, candidatePassword);
//   console.log('user', user);
//   return user;
// };
userSchema.methods.correctPassword = async function (candidatePassword) {
  console.log('candidatePassword', candidatePassword);
  console.log('userPassword', this.password);
  return await bcrypt.compare(candidatePassword, this.password);
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

  this.passwordResetExpires = Date.now() + 10 * 60 * 6000;

  return resetToken;
};
userSchema.methods.createOtp = function () {
  // Generate 6-digit OTP and ensure it's stored as a string
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = String(otp).trim(); // Ensure it's a string and trim any whitespace
  this.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiration
  console.log('[createOtp] Generated OTP:', { otp: this.otp, expires: new Date(this.otpExpires).toISOString() });
  return otp;
};

// Add OTP verification method
userSchema.methods.verifyOtp = function (candidateOtp) {
  // Check if OTP exists
  if (!this.otp) {
    console.log('[verifyOtp] No OTP stored for user');
    return false;
  }
  
  // Check if OTP has expired
  if (!this.otpExpires) {
    console.log('[verifyOtp] No expiration time set for OTP');
    return false;
  }
  
  const now = Date.now();
  const expiresAt = new Date(this.otpExpires).getTime();
  
  if (expiresAt <= now) {
    console.log('[verifyOtp] OTP expired:', {
      expires: new Date(expiresAt).toISOString(),
      current: new Date(now).toISOString(),
      expired: expiresAt <= now,
      timeDiff: now - expiresAt,
    });
    return false;
  }
  
  // Convert both to strings and normalize (trim whitespace, remove any non-digit characters)
  // Handle both string and number types
  let storedOtp = String(this.otp || '').trim();
  let providedOtp = String(candidateOtp || '').trim();
  
  // Remove any non-digit characters (in case OTP was formatted with spaces or dashes)
  storedOtp = storedOtp.replace(/\D/g, '');
  providedOtp = providedOtp.replace(/\D/g, '');
  
  // Ensure both are 6 digits (pad with zeros if needed, though this shouldn't happen)
  if (storedOtp.length !== 6) {
    console.log('[verifyOtp] Stored OTP has invalid length:', storedOtp.length);
  }
  
  if (providedOtp.length === 0) {
    console.log('[verifyOtp] Provided OTP is empty after normalization');
    return false;
  }
  
  // Compare OTPs (both normalized as digit-only strings)
  const otpMatch = storedOtp === providedOtp;
  
  if (!otpMatch) {
    console.log('[verifyOtp] OTP mismatch:', {
      stored: storedOtp,
      provided: providedOtp,
      storedOriginal: this.otp,
      providedOriginal: candidateOtp,
      storedType: typeof this.otp,
      providedType: typeof candidateOtp,
      storedLength: storedOtp.length,
      providedLength: providedOtp.length,
      storedIsString: typeof storedOtp === 'string',
      providedIsString: typeof providedOtp === 'string',
    });
  } else {
    console.log('[verifyOtp] OTP match successful:', {
      stored: storedOtp,
      provided: providedOtp,
    });
  }
  
  return otpMatch;
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
  try {
    // Only create permission if it doesn't exist
    if (!doc.permissions) {
      // Check if permission already exists in DB
      const existingPermission = await Permission.findOne({ user: doc._id });

      if (existingPermission) {
        // Link existing permission
        doc.permissions = existingPermission._id;
        await doc.save();
      } else {
        // Create new permission
        const permission = new Permission({ user: doc._id });
        await permission.save();
        doc.permissions = permission._id;
        await doc.save();
      }
    }
    next();
  } catch (error) {
    // Handle duplicate key error specifically
    if (error.code === 11000) {
      console.warn(`Duplicate permission prevented for user ${doc._id}`);
      const existing = await Permission.findOne({ user: doc._id });
      if (existing) {
        doc.permissions = existing._id;
        await doc.save();
      }
      return next();
    }
    next(error);
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
