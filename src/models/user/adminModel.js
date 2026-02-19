const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const User = require('./userModel');
const Seller = require('./sellerModel');

const adminSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minLength: 8,
      select: false,
    },
    passwordConfirm: {
      type: String,
      required: [true, 'Please provide a password'],
      validate: {
        //this is only on save and create
        validator: function (el) {
          return el === this.password;
        },
        message: 'passwords are not the same ',
      },
    },
    role: { type: String, enum: ['admin', 'superadmin', 'moderator'], default: 'admin' },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
    lastLogin: { type: Date, default: Date.now() },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: { type: Boolean, default: true, select: false },
    status: {
      type: String,
      enum: ['active', 'deactive', 'pending'],
      default: 'active',
    },
    lastLogin: { type: Date, default: Date.now },
    // SECURITY FIX #9: Session activity tracking for timeout
    lastActivity: {
      type: Date,
      default: Date.now,
      select: false, // Don't return in queries by default
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  },
);
adminSchema.pre('save', async function (next) {
  //Only run this function if passworld was actually modified
  if (!this.isModified('password')) return next();
  //hash the password with bcrypt
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});
adminSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );

    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

adminSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

adminSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  // Fix: 10 minutes = 10 * 60 * 1000 milliseconds (not 6000)
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

adminSchema.methods.createNewUser = async function (data) {
  const newUser = await User.create(data);
  return newUser;
};
adminSchema.methods.createNewSeller = async function (data) {
  const newSeller = await Seller.create(data);
  return newSeller;
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;;
