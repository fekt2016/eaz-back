/**
 * Admin Coupon Controller
 * Allows admins to manage all coupons (global and seller-specific)
 */

const CouponBatch = require('../../models/coupon/couponBatchModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const { nanoid } = require('nanoid');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');
const couponService = require('../../services/coupon/couponService');

/**
 * Get all coupons (global + seller-specific)
 * Admins can view all coupons across the platform
 */
exports.getAllCoupons = catchAsync(async (req, res, next) => {
  const {
    seller,
    status,
    global,
    discountType,
    page = 1,
    limit = 20,
  } = req.query;

  const query = {};

  // Filter by seller
  if (seller) {
    query.seller = seller;
  }

  // Filter by global status
  if (global !== undefined) {
    query.global = global === 'true';
  }

  // Filter by discount type
  if (discountType) {
    query.discountType = discountType;
  }

  // Filter by status (active/expired)
  if (status === 'active') {
    query.isActive = true;
    query.validFrom = { $lte: new Date() };
    query.expiresAt = { $gte: new Date() };
  } else if (status === 'expired') {
    query.expiresAt = { $lt: new Date() };
  } else if (status === 'inactive') {
    query.isActive = false;
  }

  const skip = (page - 1) * limit;

  const batches = await CouponBatch.find(query)
    .populate('seller', 'name email')
    .populate('createdBy', 'name email')
    .sort('-createdAt')
    .skip(skip)
    .limit(parseInt(limit));

  const total = await CouponBatch.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: batches.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    data: { batches },
  });
});

/**
 * Create global coupon (admin-only)
 */
exports.createGlobalCoupon = catchAsync(async (req, res, next) => {
  const {
    name,
    discountValue,
    discountType,
    validFrom,
    expiresAt,
    maxUsage,
    quantity,
    minOrderAmount = 0,
    maxDiscountAmount,
    applicableProducts = [],
    applicableCategories = [],
    sellerFunded = false,
    platformFunded = true,
    maxUsagePerUser = 1,
    stackingAllowed = false,
  } = req.body;

  // Validate required fields
  if (
    !name ||
    !discountValue ||
    !discountType ||
    !validFrom ||
    !expiresAt ||
    !maxUsage ||
    !quantity
  ) {
    return next(new AppError('Missing required fields', 400));
  }

  // Validate dates
  if (new Date(validFrom) >= new Date(expiresAt)) {
    return next(
      new AppError('Expiration date must be after valid from date', 400)
    );
  }

  // Validate quantity
  if (quantity < 1 || quantity > 1000) {
    return next(new AppError('Quantity must be between 1 and 1000', 400));
  }

  // Validate discount value
  if (discountType === 'percentage' && discountValue > 100) {
    return next(new AppError('Percentage discount cannot exceed 100%', 400));
  }

  if (discountType === 'fixed' && discountValue > 1000) {
    return next(new AppError('Fixed discount cannot exceed GH₵1000', 400));
  }

  // Generate unique coupon codes
  const coupons = Array.from({ length: quantity }, () => ({
    code: nanoid(10).toUpperCase(),
  }));

  // Create global coupon batch
  const couponBatch = await CouponBatch.create({
    name,
    seller: null, // Global coupons have no seller
    discountValue,
    discountType,
    validFrom: new Date(validFrom),
    expiresAt: new Date(expiresAt),
    maxUsage,
    minOrderAmount,
    maxDiscountAmount: maxDiscountAmount || null,
    applicableProducts: applicableProducts.map(id => new mongoose.Types.ObjectId(id)),
    applicableCategories: applicableCategories.map(id => new mongoose.Types.ObjectId(id)),
    sellerFunded,
    platformFunded,
    global: true, // Mark as global
    maxUsagePerUser,
    stackingAllowed,
    createdBy: req.user.id,
    createdByModel: 'Admin',
  });

  res.status(201).json({
    status: 'success',
    data: { couponBatch },
  });
});

/**
 * Deactivate any coupon (admin-only)
 */
exports.deactivateCoupon = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const batch = await CouponBatch.findByIdAndUpdate(
    id,
    { isActive: false },
    { new: true, runValidators: true }
  );

  if (!batch) {
    return next(new AppError('Coupon batch not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { batch },
  });
});

/**
 * Get coupon analytics
 */
exports.getCouponAnalytics = catchAsync(async (req, res, next) => {
  const { startDate, endDate, seller } = req.query;

  const matchQuery = {};
  if (startDate || endDate) {
    matchQuery.createdAt = {};
    if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
    if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
  }
  if (seller) {
    matchQuery.seller = new mongoose.Types.ObjectId(seller);
  }

  const analytics = await CouponBatch.aggregate([
    { $match: matchQuery },
    {
      $project: {
        name: 1,
        seller: 1,
        global: 1,
        discountValue: 1,
        discountType: 1,
        isActive: 1,
        totalCoupons: { $size: '$coupons' },
        usedCoupons: {
          $size: {
            $filter: {
              input: '$coupons',
              as: 'coupon',
              cond: { $eq: ['$$coupon.used', true] },
            },
          },
        },
        totalUsage: { $sum: '$coupons.usageCount' },
        createdAt: 1,
      },
    },
    {
      $group: {
        _id: null,
        totalBatches: { $sum: 1 },
        totalCoupons: { $sum: '$totalCoupons' },
        totalUsed: { $sum: '$usedCoupons' },
        totalUsage: { $sum: '$totalUsage' },
        batches: { $push: '$$ROOT' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: { analytics: analytics[0] || {} },
  });
});

/**
 * Get single coupon batch (admin can view any)
 */
exports.getCouponBatch = catchAsync(async (req, res, next) => {
  const batch = await CouponBatch.findById(req.params.id)
    .populate('seller', 'name email')
    .populate('createdBy', 'name email')
    .populate('coupons.recipient', 'name email')
    .populate('coupons.lastUsedBy', 'name email');

  if (!batch) {
    return next(new AppError('Coupon batch not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { batch },
  });
});

module.exports = exports;

