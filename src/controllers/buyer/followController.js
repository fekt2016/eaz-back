const mongoose = require('mongoose');
const Follow = require('../../models/user/followModel');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const Seller = require('../../models/user/sellerModel');
const Product = require('../../models/product/productModel');
const logger = require('../../utils/logger');
const {
  getPromosFromAds,
  getApplicablePromos,
  applyDiscountsAtReadTime,
} = require('../seller/productController');

exports.followSeller = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;
  const userId = req.user.id;

  // Check if already following
  const existingFollow = await Follow.findOne({
    user: userId,
    seller: sellerId,
  });
  if (existingFollow) {
    return next(new AppError('You are already following this seller', 400));
  }

  const follow = await Follow.create({ user: userId, seller: sellerId });

  res.status(201).json({
    status: 'success',
    data: {
      follow,
    },
  });
});
exports.unfollowSeller = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;
  const userId = req.user.id;

  const follow = await Follow.findOneAndDelete({
    user: userId,
    seller: sellerId,
  });

  if (!follow) {
    return next(new AppError('You are not following this seller', 400));
  }

  res.status(204).json({ data: null, status: 'success' });
});
exports.checkFollowStatus = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;
  const userId = req.user.id;

  const follow = await Follow.findOne({ user: userId, seller: sellerId });

  res.status(200).json({
    status: 'success',
    data: {
      isFollowing: !!follow,
    },
  });
});
exports.getFollowedShops = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const follows = await Follow.find({ user: userId }).populate('seller');

  res.status(200).json({
    status: 'success',
    results: follows.length,
    data: {
      follows,
    },
  });
});

exports.getSellerfollowers = catchAsync(async (req, res, next) => {
  const sellerId = req.params.sellerId;

  const follows = await Follow.find({ seller: sellerId }).populate('user');

  res.status(200).json({
    status: 'success',
    results: follows.length,
    data: {
      follows,
    },
  });
});

/**
 * GET /api/v1/follow/products
 * Get products from sellers the current user follows (buyer only).
 * Used for homepage "From sellers you follow" section.
 */
exports.getFollowedSellerProducts = catchAsync(async (req, res, next) => {
  const rawUserId = req.user.id;
  const userId = mongoose.Types.ObjectId.isValid(rawUserId) ? new mongoose.Types.ObjectId(rawUserId) : rawUserId;
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 24);

  const follows = await Follow.find({ user: userId }).select('seller').lean();
  const sellerIds = follows
    .map((f) => f.seller)
    .filter(Boolean)
    .map((id) => {
      if (!id) return null;
      if (id instanceof mongoose.Types.ObjectId) return id;
      return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
    })
    .filter(Boolean);
  if (sellerIds.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      total: 0,
      data: { data: [] },
    });
  }

  // Match seller public page: show products that are active/out_of_stock and not deleted.
  // Include both approved and pending so products visible on the seller's shop page also show here.
  const filter = {
    seller: { $in: sellerIds },
    status: { $in: ['active', 'out_of_stock'] },
    isDeleted: { $ne: true },
    isDeletedByAdmin: { $ne: true },
    isDeletedBySeller: { $ne: true },
  };

  const products = await Product.find(filter)
    .populate({ path: 'seller', select: 'name shopName verificationStatus' })
    .populate({ path: 'parentCategory', select: 'name slug' })
    .populate({ path: 'subCategory', select: 'name slug' })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Apply promos from ads so promo discounts appear in \"From sellers you follow\" just like other listings
  let promos = [];
  try {
    promos = await getPromosFromAds();
  } catch (e) {
    logger.warn('[getFollowedSellerProducts] Could not load promos:', e?.message);
  }

  if (Array.isArray(products) && products.length > 0 && promos.length > 0) {
    const requestPromoKey = req.query.promotionKey || null;
    for (const product of products) {
      const applicable = getApplicablePromos(product, promos, requestPromoKey);
      if (applicable.length > 0) {
        applyDiscountsAtReadTime(product, applicable);
      } else {
        product.promoPrice = 0;
        product.isOnSale = false;
      }
    }
  }

  const total = await Product.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: products.length,
    total,
    data: { data: products },
  });
});

exports.getFollowStatus = catchAsync(async (req, res, next) => {
  try {
    const { sellerId } = req.params;
    const userId = req.user.id; // From authentication middleware

    logger.info(sellerId, userId);
    // 1. Validate sellerId
    if (!sellerId) {
      return next(new AppError('Seller ID is required', 400));
    }

    // 2. Check if seller exists
    const seller = await Seller.findById(sellerId);
    if (!seller) {
      return next(new AppError('Seller not found', 404));
    }

    // 3. Check if current user is following the seller
    const isFollowing = await Follow.exists({
      user: userId,
      seller: sellerId,
    });

    // 4. Get total followers count for the seller
    const followersCount = await Follow.countDocuments({ seller: sellerId });

    // 5. Return response
    res.status(200).json({
      success: true,
      isFollowing: !!isFollowing,
      followersCount,
    });
  } catch (error) {
    logger.error('Follow status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get follow status',
    });
  }
});
