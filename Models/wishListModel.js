const mongoose = require('mongoose');

const wishListSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // Each user has only one wishlist
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        default: [],
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Auto-manage createdAt/updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

const WishList = mongoose.model('WishList', wishListSchema);

module.exports = WishList;
