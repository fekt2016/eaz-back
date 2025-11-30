const Follow = require('../../models/user/followModel');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const Seller = require('../../models/user/sellerModel');

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

exports.getFollowStatus = catchAsync(async (req, res, next) => {
  try {
    const { sellerId } = req.params;
    const userId = req.user.id; // From authentication middleware

    console.log(sellerId, userId);
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
    console.error('Follow status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get follow status',
    });
  }
});
