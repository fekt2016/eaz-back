const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const crypto = require('crypto');

const sellerSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Please provide your name'] },
    shopName: {
      type: String,
      required: [true, 'Please provide your store name'],
    },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail],
    },
    shopDescription: String,
    shopAddress: Object,
    contactNumber: {
      type: String,
      maxlength: [10, 'Contact number must be 10 digits long'],
      unique: true,
      minlength: [10, 'Contact number must be 10 digits long'],
      trim: true,
      required: [true, 'Contact number is required'],
      unique: true,
      validate: {
        validator: function (v) {
          return /^0(24|54|55|59|20|50|27|57|26|56|23|28)\d{7}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid Ghanaian number!`,
      },
    },
    network: {
      type: String,
      enum: ['mtn', 'telecel', 'airteltigo'],
      required: true,
    },
    socialMediaLinks: {
      facebook: String,
      instagram: String,
      twitter: String,
      TikTok: String,
    },
    avatar: String,
    ratings: {
      rating: Number,
      averageRating: Number,
      totalRating: Number,
    },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    sales: {
      totalSales: Number,
      monthlySales: Number,
    },
    verificationStatus: { type: String, enum: ['verified', 'unverified'] },
    verificationDocuments: { idProof: String, addresProof: String },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minLength: 8,
      select: false,
    },
    passwordConfirm: {
      type: String,
      required: [true, 'Please provide a passwordVonfirm'],
      minLength: 8,
      select: false,
    },
    payment: {
      bankAccountDetails: {
        accountNumber: String,
        accountHolderName: String,
        bankName: String,
        ifscCode: String,
      },
      momoDetails: {
        Momo: {
          network: String,
          phoneNumber: String,
          accountName: String,
        },
      },
      status: String,
    },
    role: { type: String, enum: ['seller'], default: 'seller' },
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: { type: Boolean, default: true, select: false },
    status: {
      type: String,
      enum: ['active', 'deactive', 'pending'],
      default: 'pending',
    },
    passwordChangedAt: { type: Date, default: Date },
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

sellerSchema.virtual('products', {
  ref: 'Product',
  foreignField: 'seller',
  localField: '_id',
});

sellerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
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
    console.log(JWTTimestamp < changedTimestamp);
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

const Seller = mongoose.model('Seller', sellerSchema);

module.exports = Seller;
