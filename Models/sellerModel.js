const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const crypto = require('crypto');
const { trim, max } = require('lodash');

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
    location: {
      type: String,
      trim: true,
      maxlength: [200, 'Location must be less than 50 characters'],
    },
    shopDescription: String,
    shopAddress: Object,
    // contactNumber: {
    //   type: String,
    //   maxlength: [10, 'Contact number must be 10 digits long'],
    //   unique: true,
    //   minlength: [10, 'Contact number must be 10 digits long'],
    //   trim: true,
    //   // required: [true, 'Contact number is required'],
    //   unique: true,
    //   validate: {
    //     validator: function (v) {
    //       return /^0(24|54|55|59|20|50|27|57|26|56|23|28)\d{7}$/.test(v);
    //     },
    //     message: (props) => `${props.value} is not a valid Ghanaian number!`,
    //   },
    // },
    // network: {
    //   type: String,
    //   enum: ['mtn', 'telecel', 'airteltigo'],
    //   required: [true, 'Mobile network is required'],
    // },
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
      enum: ['verified', 'unverified', 'pending'],
      default: 'pending',
    },
    verificationDocuments: {
      idProof: { type: String, default: '' },
      addresProof: { type: String, default: '' },
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
    // paymentHistory: [
    //   {
    //     amount: { type: Number },
    //     method: {
    //       type: String,
    //       enum: [
    //         'bank',
    //         'mtn_momo',
    //         'vodafone_cash',
    //         'airtel_tigo_money',
    //         'cash',
    //       ],
    //       // required: true,
    //     },
    //     transactionId: { type: String },
    //     date: { type: Date, default: Date.now },
    //     status: {
    //       type: String,
    //       enum: ['pending', 'processing', 'paid', 'rejected'],
    //       default: 'pending',
    //     },
    //   },
    // ],
    // paymentMethods: {
    //   bankAccount: {
    //     accountNumber: { type: String, default: '' },
    //     accountName: { type: String, default: '' },
    //     bankName: {
    //       type: String,
    //       enum: [
    //         'GCB Bank',
    //         'Absa Ghana',
    //         'Stanbic Bank',
    //         'Ecobank Ghana',
    //         'Fidelity Bank',
    //         'CalBank',
    //         'Zenith Bank',
    //         'GT Bank',
    //         'Republic Bank',
    //         'Standard Chartered',
    //         'First National Bank',
    //       ],
    //       default: '',
    //     },
    //     branch: { type: String, default: '' },
    //   },
    //   mobileMoney: {
    //     phone: {
    //       type: String,
    //       validate: {
    //         validator: function (v) {
    //           return /^0(24|54|55|59|20|50|27|57|26|56|23|28)\d{7}$/.test(v);
    //         },
    //         message: 'Invalid mobile money number',
    //       },
    //       default: '',
    //     },
    //     network: {
    //       type: String,
    //       enum: ['MTN', 'vodafone', 'airteltigo'],
    //       default: '',
    //     },
    //   },
    // },
    productCount: {
      type: Number,
      default: 0,
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

sellerSchema.methods.addPayment = function (payment) {
  this.paymentHistory.push(payment);
};
sellerSchema.statics.updateProductCount = async function (sellerId) {
  const Product = mongoose.model('Product');
  const count = await Product.countDocuments({ seller: sellerId });
  await this.findByIdAndUpdate(sellerId, { productCount: count });
};

const Seller = mongoose.model('Seller', sellerSchema);

module.exports = Seller;
