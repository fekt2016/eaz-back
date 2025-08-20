const CouponBatch = require('../Models/couponBatchModel');
const catchAsync = require('../utils/catchAsync');
const { nanoid } = require('nanoid');
const AppError = require('../utils/appError');

exports.createCouponBatch = catchAsync(async (req, res, next) => {
  const {
    name,
    discountValue,
    discountType,
    validFrom,
    expiresAt,
    maxUsage,
    quantity,
    minOrderAmount = 0,
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
      new AppError('Expiration date must be after valid from date', 400),
    );
  }

  // Validate quantity
  if (quantity < 1 || quantity > 1000) {
    return next(new AppError('Quantity must be between 1 and 1000', 400));
  }

  // Generate unique coupon codes
  const coupons = Array.from({ length: quantity }, () => ({
    code: nanoid(10).toUpperCase(),
  }));

  // Create coupon batch
  const couponBatch = await CouponBatch.create({
    name,
    seller: req.user.id,
    discountValue,
    discountType,
    validFrom: new Date(validFrom),
    expiresAt: new Date(expiresAt),
    maxUsage,
    minOrderAmount,
    coupons,
  });

  res.status(201).json({
    status: 'success',
    data: { couponBatch },
  });
});

exports.getSellerCouponBatches = catchAsync(async (req, res, next) => {
  const batches = await CouponBatch.find({ seller: req.user.id })
    .sort('-createdAt')
    .populate('coupons.recipient', 'name email')
    .populate('coupons.lastUsedBy', 'name email');

  res.status(200).json({
    status: 'success',
    results: batches.length,
    data: { batches },
  });
});

exports.getCouponBatch = catchAsync(async (req, res, next) => {
  const batch = await CouponBatch.findOne({
    _id: req.params.id,
    seller: req.user.id,
  })
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

exports.updateCouponBatch = catchAsync(async (req, res, next) => {
  const { coupons, seller, ...updateData } = req.body;

  // Prevent updating certain fields
  const restrictedFields = ['validFrom', 'expiresAt', 'maxUsage'];
  restrictedFields.forEach((field) => {
    if (updateData[field]) {
      delete updateData[field];
    }
  });

  const batch = await CouponBatch.findOneAndUpdate(
    { _id: req.params.id, seller: req.user.id },
    updateData,
    { new: true, runValidators: true },
  );

  if (!batch) {
    return next(new AppError('Coupon batch not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { batch },
  });
});

exports.deleteCouponBatch = catchAsync(async (req, res, next) => {
  const batch = await CouponBatch.findOneAndDelete({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!batch) {
    return next(new AppError('Coupon batch not found', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

exports.applyCoupon = catchAsync(async (req, res, next) => {
  const { couponCode, orderAmount } = req.body;

  const userId = req.user.id;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  if (!couponCode || orderAmount === undefined) {
    return next(new AppError('Coupon code and order amount are required', 400));
  }

  const couponData = await CouponBatch.validateCoupon(
    couponCode.toUpperCase(),
    userId,
    orderAmount,
  );

  res.status(200).json({
    status: 'success',
    data: {
      valid: true,
      discountValue: couponData.discountValue,
      discountType: couponData.discountType,
      couponId: couponData.couponId,
      batchId: couponData.batchId,
    },
  });
});

exports.markCouponUsed = catchAsync(
  async (batchId, couponId, userId, orderId) => {
    await CouponBatch.applyCoupon(batchId, couponId, userId, orderId);
  },
);
