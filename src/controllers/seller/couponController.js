const CouponBatch = require('../../models/coupon/couponBatchModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const { nanoid } = require('nanoid');
const AppError = require('../../utils/errors/appError');
const CreditBalance = require('../../models/user/creditbalanceModel');
const mongoose = require('mongoose');
const couponService = require('../../services/coupon/couponService');
const notificationService = require('../../services/notification/notificationService');
const Seller = require('../../models/user/sellerModel');
const User = require('../../models/user/userModel');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Follow = require('../../models/user/followModel');
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
    maxDiscountAmount,
    applicableProducts = [],
    applicableCategories = [],
    sellerFunded = true,
    platformFunded = false,
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
      new AppError('Expiration date must be after valid from date', 400),
    );
  }

  // Validate quantity
  if (quantity < 1 || quantity > 1000) {
    return next(new AppError('Quantity must be between 1 and 1000', 400));
  }

  // SECURITY FIX #20: Validate coupon code format
  if (code) {
    // Only allow alphanumeric characters (A-Z, a-z, 0-9)
    const codePattern = /^[A-Za-z0-9]+$/;
    if (!codePattern.test(code)) {
      return next(new AppError('Coupon code must contain only letters and numbers', 400));
    }

    // Check length (4-20 characters)
    if (code.length < 4 || code.length > 20) {
      return next(new AppError('Coupon code must be between 4 and 20 characters', 400));
    }

    // Convert to uppercase for consistency
    req.body.code = code.toUpperCase();
  }

  // Validate discount value
  if (discountType === 'percentage' && discountValue > 100) {
    return next(new AppError('Percentage discount cannot exceed 100%', 400));
  }

  if (discountType === 'percentage' && discountValue > 90) {
    // Warn for high discounts (could require admin approval in future)
    console.warn(`High discount coupon created: ${discountValue}% by seller ${req.user.id}`);
  }

  if (discountType === 'fixed' && discountValue > 1000) {
    return next(new AppError('Fixed discount cannot exceed GH₵1000', 400));
  }

  // Get isPublic flag (defaults to false for private coupons)
  const { isPublic = false } = req.body;

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
    maxDiscountAmount: maxDiscountAmount || null,
    applicableProducts: applicableProducts.map(id => new mongoose.Types.ObjectId(id)),
    applicableCategories: applicableCategories.map(id => new mongoose.Types.ObjectId(id)),
    sellerFunded,
    platformFunded,
    global: false, // Seller coupons are never global
    isPublic: isPublic, // If true, visible to all users. If false, only visible to recipients
    maxUsagePerUser,
    stackingAllowed,
    createdBy: req.user.id,
    createdByModel: 'Seller',
    coupons,
  });

  // Send notification to all admins about the new coupon batch
  try {
    const seller = await Seller.findById(req.user.id).select('name email');
    const sellerName = seller?.name || seller?.email || 'A seller';

    await notificationService.createCouponCreationNotification(
      couponBatch._id,
      req.user.id,
      sellerName,
      name,
      discountType,
      discountValue,
      quantity
    );

    console.log(`[createCouponBatch] ✅ Notification sent to admins about new coupon batch ${couponBatch._id}`);
  } catch (notificationError) {
    // Don't fail coupon creation if notification fails
    console.error('[createCouponBatch] Error creating admin notification:', notificationError);
  }

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
  )
    .populate('seller', 'name email shopName');

  if (!batch) {
    return next(new AppError('Coupon batch not found', 404));
  }

  // If coupons array is provided with recipient updates, send emails
  if (coupons && Array.isArray(coupons)) {
    try {
      const emailDispatcher = require('../../emails/emailDispatcher');
      const User = require('../../models/user/userModel');

      // Get updated batch with populated coupons
      const updatedBatch = await CouponBatch.findById(batch._id)
        .populate('coupons.recipient', 'name email')
        .populate('seller', 'name email shopName');

      for (const couponUpdate of coupons) {
        if (couponUpdate.recipient) {
          // Find the coupon in the updated batch
          const coupon = updatedBatch.coupons.find(c =>
            c._id.toString() === couponUpdate._id?.toString() ||
            c.code === couponUpdate.code
          );

          if (coupon && coupon.recipient) {
            const user = coupon.recipient;
            const seller = updatedBatch.seller || { name: 'A seller', shopName: 'A seller' };

            if (user && user.email) {
              await emailDispatcher.sendCouponToBuyer(user, coupon, updatedBatch, seller);
              console.log(`[updateCouponBatch] ✅ Coupon email sent to ${user.email}`);
            }
          }
        }
      }
    } catch (emailError) {
      console.error('[updateCouponBatch] Error sending coupon emails:', emailError.message);
      // Don't fail update if email fails
    }
  }

  res.status(200).json({
    status: 'success',
    data: { batch },
  });
});

/**
 * Assign and send coupon to specific buyer
 * POST /api/v1/seller/coupon/:batchId/assign
 * Body: { couponCode: string, userId: string }
 * 
 * SELLER-LEVEL VALIDATION ONLY:
 * - Check batch belongs to seller
 * - Check coupon exists in batch
 * - Check coupon is not used
 * - NO buyer-level validation (seller is distributing, not redeeming)
 */
exports.assignCouponToBuyer = catchAsync(async (req, res, next) => {
  const { batchId } = req.params;
  const { couponCode, userId } = req.body;

  if (!couponCode || !userId) {
    return next(new AppError('Coupon code and user ID are required', 400));
  }

  // SELLER VALIDATION 1: Check batch belongs to seller
  const batch = await CouponBatch.findOne({
    _id: batchId,
    seller: req.user.id,
  })
    .populate('seller', 'name email shopName');

  if (!batch) {
    return next(new AppError('Coupon batch not found or does not belong to you', 404));
  }

  // SELLER VALIDATION 2: Check batch is active
  if (!batch.isActive) {
    return next(new AppError('This coupon batch is inactive', 400));
  }

  // SELLER VALIDATION 3: Check coupon exists in batch
  const couponIndex = batch.coupons.findIndex(c => c.code === couponCode.toUpperCase());
  if (couponIndex === -1) {
    return next(new AppError('Coupon not found in this batch', 404));
  }

  const coupon = batch.coupons[couponIndex];

  // SELLER VALIDATION 4: Prevent sending used coupons (unless multi-use and still available)
  // For single-use coupons: if used, cannot send to anyone
  if (coupon.used && batch.maxUsage === 1) {
    return next(new AppError('This coupon has already been used and cannot be sent to any buyer.', 400));
  }

  // For multi-use coupons: if used and reached maxUsage, cannot send
  if (coupon.used && coupon.usageCount >= batch.maxUsage) {
    return next(new AppError('This coupon has reached its maximum usage limit and cannot be sent to any buyer.', 400));
  }

  // SELLER VALIDATION 5: Check usage limit not reached
  if (coupon.usageCount >= batch.maxUsage) {
    return next(new AppError('Coupon usage limit has been reached', 400));
  }

  // SELLER VALIDATION 6: Prevent sending the same coupon to the same buyer multiple times
  if (coupon.recipient) {
    const existingRecipientId = coupon.recipient.toString();
    const newUserId = userId.toString();

    // If the coupon is already assigned to this buyer, prevent sending again
    if (existingRecipientId === newUserId) {
      return next(new AppError('This coupon has already been sent to this buyer. You cannot send the same coupon to the same buyer multiple times.', 400));
    }
  }

  // SELLER VALIDATION 7: For single-use coupons (maxUsage === 1), prevent sending to multiple buyers
  if (batch.maxUsage === 1 && coupon.recipient) {
    const existingRecipientId = coupon.recipient.toString();
    const newUserId = userId.toString();

    // If recipient exists and is different from the new user, prevent assignment
    if (existingRecipientId !== newUserId) {
      return next(new AppError('This single-use coupon has already been assigned to another buyer. Single-use coupons can only be sent to one buyer.', 400));
    }
  }

  // SELLER VALIDATION 8: For multi-use coupons, check if we can still send to more buyers
  // For multi-use coupons (maxUsage > 1), we allow sending to multiple buyers
  // We check if the coupon has already been used up to its limit
  // Note: The recipient field stores the last recipient, but usageCount tracks actual usage
  // We allow sending to different buyers as long as usageCount < maxUsage
  if (batch.maxUsage > 1) {
    // Check if coupon has reached its usage limit
    if (coupon.usageCount >= batch.maxUsage) {
      return next(new AppError(`This coupon can only be used ${batch.maxUsage} times and has reached its limit.`, 400));
    }
    // For multi-use coupons, we allow sending to multiple buyers
    // The recipient will be updated, but the coupon can still be used by others
  }

  // Assign recipient using MongoDB positional operator (more reliable)
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const updateResult = await CouponBatch.findOneAndUpdate(
    {
      _id: batchId,
      'coupons.code': couponCode.toUpperCase(),
    },
    {
      $set: {
        'coupons.$.recipient': userObjectId,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updateResult) {
    return next(new AppError('Failed to assign coupon recipient', 500));
  }

  // Get the updated coupon
  const savedCoupon = updateResult.coupons.find(c => c.code === couponCode.toUpperCase());
  if (savedCoupon && savedCoupon.recipient) {
    console.log(`[assignCouponToBuyer] ✅ Recipient assigned: ${savedCoupon.recipient.toString()}`);
  }

  // Update batch reference for email
  const updatedBatch = updateResult;

  // Send email to buyer
  try {
    const emailDispatcher = require('../../emails/emailDispatcher');
    const User = require('../../models/user/userModel');
    const user = await User.findById(userId).select('name email').lean();

    if (user && user.email) {
      await emailDispatcher.sendCouponToBuyer(user, savedCoupon || coupon, updatedBatch, updatedBatch.seller);
      console.log(`[assignCouponToBuyer] ✅ Coupon email sent to ${user.email}`);
    }
  } catch (emailError) {
    console.error('[assignCouponToBuyer] Error sending coupon email:', emailError.message);
    // Don't fail assignment if email fails
  }

  res.status(200).json({
    status: 'success',
    message: 'Coupon assigned and sent to buyer',
    data: { coupon: savedCoupon || coupon },
  });
});

/**
 * Get eligible buyers for coupon sending
 * GET /api/v1/seller/coupon/eligible-buyers
 * Returns buyers who have ordered from seller OR follow the seller
 */
exports.getEligibleBuyers = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;

  // 1. Find buyers who placed orders containing this seller's products
  const sellerOrders = await SellerOrder.find({ seller: sellerId })
    .select('order')
    .lean();

  const orderIds = sellerOrders
    .map((so) => so.order)
    .filter((id) => id);

  const orders = await Order.find({ _id: { $in: orderIds } })
    .select('user')
    .populate('user', 'name email')
    .lean();

  const buyersFromOrders = new Map();
  orders.forEach((order) => {
    if (order.user) {
      const userId = order.user._id.toString();
      if (!buyersFromOrders.has(userId)) {
        buyersFromOrders.set(userId, {
          _id: order.user._id,
          name: order.user.name,
          email: order.user.email,
          type: 'ordered',
        });
      }
    }
  });

  // 2. Find buyers who follow this seller
  const follows = await Follow.find({ seller: sellerId })
    .populate('user', 'name email')
    .lean();

  const buyersFromFollows = new Map();
  follows.forEach((follow) => {
    if (follow.user) {
      const userId = follow.user._id.toString();
      if (!buyersFromFollows.has(userId)) {
        buyersFromFollows.set(userId, {
          _id: follow.user._id,
          name: follow.user.name,
          email: follow.user.email,
          type: 'follower',
        });
      }
    }
  });

  // 3. Merge and dedupe
  const eligibleBuyers = new Map();
  buyersFromOrders.forEach((buyer, userId) => {
    eligibleBuyers.set(userId, buyer);
  });
  buyersFromFollows.forEach((buyer, userId) => {
    if (!eligibleBuyers.has(userId)) {
      eligibleBuyers.set(userId, buyer);
    } else {
      eligibleBuyers.get(userId).type = 'ordered';
    }
  });

  const buyersArray = Array.from(eligibleBuyers.values()).sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  res.status(200).json({
    status: 'success',
    results: buyersArray.length,
    data: {
      buyers: buyersArray,
    },
  });
});

/**
 * Send coupon email to buyer
 * POST /api/v1/seller/coupon/send-email
 * 
 * SELLER-LEVEL VALIDATION ONLY:
 * - Check batch belongs to seller
 * - Check batch is active
 * - Check coupon exists in batch
 * - Check coupon is not used
 * - Check usage limit not reached
 * - Check buyer is eligible (ordered or follower)
 * - NO buyer-level validation (seller is distributing, not redeeming)
 * - NO recipient assignment check (we're assigning it now)
 */
exports.sendCouponEmail = catchAsync(async (req, res, next) => {
  const { buyerId, couponCode, batchId, message } = req.body;
  const sellerId = req.user.id;

  if (!buyerId || !couponCode || !batchId) {
    return next(new AppError('buyerId, couponCode, and batchId are required', 400));
  }

  // SELLER VALIDATION 1: Check batch belongs to seller
  const batchDoc = await CouponBatch.findOne({
    _id: batchId,
    seller: sellerId,
  })
    .populate('seller', 'name email shopName');

  if (!batchDoc) {
    return next(new AppError('Coupon batch not found or does not belong to you', 404));
  }

  // SELLER VALIDATION 2: Check batch is active
  if (!batchDoc.isActive) {
    return next(new AppError('This coupon batch is inactive', 400));
  }

  // SELLER VALIDATION 3: Check coupon exists in batch
  const couponIndex = batchDoc.coupons.findIndex(
    (c) => c.code === couponCode.toUpperCase()
  );

  if (couponIndex === -1) {
    return next(new AppError('Coupon not found in this batch', 404));
  }

  const coupon = batchDoc.coupons[couponIndex];

  // SELLER VALIDATION 4: Prevent sending used coupons (unless multi-use and still available)
  // For single-use coupons: if used, cannot send to anyone
  if (coupon.used && batchDoc.maxUsage === 1) {
    return next(new AppError('This coupon has already been used and cannot be sent to any buyer.', 400));
  }

  // For multi-use coupons: if used and reached maxUsage, cannot send
  if (coupon.used && coupon.usageCount >= batchDoc.maxUsage) {
    return next(new AppError('This coupon has reached its maximum usage limit and cannot be sent to any buyer.', 400));
  }

  // SELLER VALIDATION 5: Check usage limit not reached
  if (coupon.usageCount >= batchDoc.maxUsage) {
    return next(new AppError('Coupon usage limit has been reached', 400));
  }

  // SELLER VALIDATION 6: Prevent sending the same coupon to the same buyer multiple times
  if (coupon.recipient) {
    const existingRecipientId = coupon.recipient.toString();
    const newBuyerId = buyerId.toString();

    // If the coupon is already assigned to this buyer, prevent sending again
    if (existingRecipientId === newBuyerId) {
      return next(new AppError('This coupon has already been sent to this buyer. You cannot send the same coupon to the same buyer multiple times.', 400));
    }
  }

  // SELLER VALIDATION 7: For single-use coupons (maxUsage === 1), prevent sending to multiple buyers
  if (batchDoc.maxUsage === 1 && coupon.recipient) {
    const existingRecipientId = coupon.recipient.toString();
    const newBuyerId = buyerId.toString();

    // If recipient exists and is different from the new buyer, prevent assignment
    if (existingRecipientId !== newBuyerId) {
      return next(new AppError('This single-use coupon has already been assigned to another buyer. Single-use coupons can only be sent to one buyer.', 400));
    }
  }

  // SELLER VALIDATION 8: For multi-use coupons, check if we can still send to more buyers
  // For multi-use coupons (maxUsage > 1), we allow sending to multiple buyers
  // We check if the coupon has already been used up to its limit
  // Note: The recipient field stores the last recipient, but usageCount tracks actual usage
  // We allow sending to different buyers as long as usageCount < maxUsage
  if (batchDoc.maxUsage > 1) {
    // Check if coupon has reached its usage limit
    if (coupon.usageCount >= batchDoc.maxUsage) {
      return next(new AppError(`This coupon can only be used ${batchDoc.maxUsage} times and has reached its limit.`, 400));
    }
    // For multi-use coupons, we allow sending to multiple buyers
    // The recipient will be updated, but the coupon can still be used by others
  }

  // Check buyer exists
  const buyer = await User.findById(buyerId).select('name email').lean();
  if (!buyer) {
    return next(new AppError('Buyer not found', 404));
  }

  // Check buyer eligibility (ordered or follower)
  const buyerOrders = await Order.find({ user: buyerId }).distinct('_id');
  const hasOrdered = await SellerOrder.exists({
    seller: sellerId,
    order: { $in: buyerOrders },
  });
  const isFollower = await Follow.exists({
    user: buyerId,
    seller: sellerId,
  });

  if (!hasOrdered && !isFollower) {
    return next(
      new AppError(
        'This buyer has not ordered from you or is not following you',
        403
      )
    );
  }

  try {
    // Assign recipient to the buyer using MongoDB positional operator (more reliable)
    const buyerObjectId = new mongoose.Types.ObjectId(buyerId);

    // Use findOneAndUpdate with positional operator to update nested document directly
    const updateResult = await CouponBatch.findOneAndUpdate(
      {
        _id: batchId,
        'coupons.code': couponCode.toUpperCase(),
      },
      {
        $set: {
          'coupons.$.recipient': buyerObjectId,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updateResult) {
      return next(new AppError('Failed to assign coupon recipient', 500));
    }

    // Verify the recipient was saved
    const savedCoupon = updateResult.coupons.find(c => c.code === couponCode.toUpperCase());
    if (savedCoupon && savedCoupon.recipient) {
      console.log(`[sendCouponEmail] ✅ Recipient assigned: ${savedCoupon.recipient.toString()} === ${buyerObjectId.toString()}`);
    } else {
      console.error('[sendCouponEmail] ⚠️ Warning: Recipient may not have been saved correctly');
    }

    // Now send the email
    const emailDispatcher = require('../../emails/emailDispatcher');
    const seller = updateResult.seller || { name: 'A seller', shopName: 'A seller' };

    // Get the updated coupon for email
    const updatedCoupon = savedCoupon || updateResult.coupons.find(c => c.code === couponCode.toUpperCase());
    await emailDispatcher.sendCouponToBuyer(buyer, updatedCoupon, updateResult, seller, message);

    console.log(`[sendCouponEmail] ✅ Coupon email sent to ${buyer.email} and recipient assigned`);

    res.status(200).json({
      status: 'success',
      message: 'Coupon email sent successfully',
      data: {
        buyer: {
          _id: buyer._id,
          name: buyer.name,
          email: buyer.email,
        },
        coupon: {
          code: updatedCoupon.code,
          batchId: updateResult._id,
        },
      },
    });
  } catch (emailError) {
    console.error('[sendCouponEmail] Error sending coupon email:', emailError.message);
    return next(new AppError(`Failed to send email: ${emailError.message}`, 500));
  }
});

exports.deleteCouponBatch = catchAsync(async (req, res, next) => {
  const batch = await CouponBatch.findOneAndDelete({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!batch) {
    return next(new AppError('Coupon batch not found', 404));
  }

  res.status(204).json({ data: null, status: 'success' });
});

exports.applyCoupon = catchAsync(async (req, res, next) => {
  const { couponCode, orderAmount, productIds = [], categoryIds = [], sellerIds = [] } = req.body;

  const userId = req.user.id;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  if (!couponCode || orderAmount === undefined) {
    return next(new AppError('Coupon code and order amount are required', 400));
  }

  // Use new coupon service for validation (includes all checks + discount calculation)
  const couponData = await couponService.validateCoupon(
    couponCode,
    userId,
    orderAmount,
    productIds,
    categoryIds,
    sellerIds
  );

  res.status(200).json({
    status: 'success',
    data: {
      valid: true,
      discountValue: couponData.discountValue,
      discountType: couponData.discountType,
      discountAmount: couponData.discountAmount, // ✅ Backend-calculated discount
      couponId: couponData.couponId,
      batchId: couponData.batchId,
      sellerFunded: couponData.sellerFunded,
      platformFunded: couponData.platformFunded,
      remainingUses: couponData.remainingUses,
      userRemainingUses: couponData.userRemainingUses,
    },
  });
});

exports.markCouponUsed = catchAsync(
  async (batchId, couponId, userId, orderId) => {
    await CouponBatch.applyCoupon(batchId, couponId, userId, orderId);
  },
);

/**
 * Get available coupons for the current user
 * Returns ONLY coupons that have been sent/assigned to this specific user (recipient matches)
 * Buyers should NOT see any coupons until sellers explicitly send them the coupon code
 * - coupon is active and not expired
 * - usage limits not exceeded
 */
exports.getUserCoupons = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const now = new Date();

  // Find coupon batches that are active and not expired
  // ONLY include batches with coupons assigned to this specific user (recipient matches)
  const batches = await CouponBatch.find({
    isActive: true,
    validFrom: { $lte: now },
    expiresAt: { $gte: now },
    'coupons.recipient': userId, // ONLY coupons assigned to this user
  })
    .populate('seller', 'name email shopName')
    .sort('-createdAt');

  // Filter coupons available to this user
  const userCoupons = [];

  for (const batch of batches) {
    for (const coupon of batch.coupons) {
      // ONLY show coupons where recipient matches current user
      // Buyers should NOT see any coupons until sellers send them
      const isAssignedToUser = coupon.recipient && coupon.recipient.toString() === userId.toString();

      if (!isAssignedToUser) continue;

      // Check usage limits
      const isUsed = coupon.used && batch.maxUsage === 1;
      const isUsageLimitReached = coupon.usageCount >= batch.maxUsage;

      // Check per-user usage limit
      let userUsageCount = 0;
      if (coupon.userUsageCount) {
        if (coupon.userUsageCount instanceof Map) {
          userUsageCount = coupon.userUsageCount.get(userId.toString()) || 0;
        } else if (typeof coupon.userUsageCount === 'object') {
          userUsageCount = coupon.userUsageCount[userId.toString()] || 0;
        }
      }
      const isUserLimitReached = userUsageCount >= batch.maxUsagePerUser;

      // Determine status
      // If coupon has been used, mark as 'used'
      // Otherwise check if it's expired or if limits are reached
      let status = 'active';
      if (coupon.used || isUsed) {
        status = 'used'; // Coupon has been used
      } else if (isUsageLimitReached || isUserLimitReached) {
        status = 'used'; // Limits reached, treat as used
      } else if (new Date(batch.expiresAt) < now) {
        status = 'expired';
      }

      // Calculate days until expiry
      const expiryDate = new Date(batch.expiresAt);
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      userCoupons.push({
        id: coupon._id.toString(),
        code: coupon.code,
        title: batch.name,
        description: `${batch.discountType === 'percentage' ? `${batch.discountValue}%` : `GH₵${batch.discountValue}`} off${batch.minOrderAmount > 0 ? ` on orders over GH₵${batch.minOrderAmount}` : ''}`,
        discount: batch.discountType === 'percentage' ? `${batch.discountValue}%` : `GH₵${batch.discountValue}`,
        discountValue: batch.discountValue,
        discountType: batch.discountType,
        expiration: batch.expiresAt,
        minPurchase: batch.minOrderAmount,
        status,
        category: batch.global ? 'global' : 'seller',
        featured: batch.global || daysUntilExpiry <= 7,
        seller: batch.seller,
        global: batch.global,
        maxUsage: batch.maxUsage,
        usageCount: coupon.usageCount,
        userUsageCount,
        maxUsagePerUser: batch.maxUsagePerUser,
        daysUntilExpiry,
      });
    }
  }

  res.status(200).json({
    status: 'success',
    results: userCoupons.length,
    data: {
      coupons: userCoupons,
    },
  });
});

exports.applyUserCoupon = catchAsync(async (req, res, next) => {
  console.log('applyUserCoupon called', req.body);

  const { couponCode } = req.body;
  const userId = new mongoose.Types.ObjectId(req.user.id);

  try {
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!couponCode) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }

    // console.log('Applying coupon for user:', userId, couponCode);

    // Validate the coupon using new service
    const couponData = await couponService.validateUserCoupon(
      couponCode.toUpperCase(),
      userId,
    );

    console.log('Coupon validated:', couponData);
    //check if coupon has already been used
    if (couponData.used) {
      return next(new AppError('This coupon has already been used', 400));
    }

    // Check if it's an amount coupon (not percentage)
    if (couponData.discountType !== 'fixed') {
      return next(
        new AppError('Only fixed amount coupons can be applied', 400),
      );
    }

    // Find or create credit balance for user
    let creditBalance = await CreditBalance.findOne({ user: userId });

    if (!creditBalance) {
      // Create new credit balance
      creditBalance = await CreditBalance.create({
        user: userId,
        balance: Number(couponData.discountValue),
        currency: 'GHS',
        transactions: [
          {
            date: new Date(),
            amount: Number(couponData.discountValue),
            type: 'bonus',
            description: `Coupon redemption: ${couponCode.toUpperCase()}`,
            reference: `COUPON-${couponData.couponId}`,
          },
        ],
      });
    } else {
      // Ensure both values are numbers
      const discountValue = Number(couponData.discountValue);
      const currentBalance = Number(creditBalance.balance);

      // Update balance and add transaction
      creditBalance.balance = currentBalance + discountValue;
      creditBalance.transactions.push({
        date: new Date(),
        amount: discountValue,
        type: 'bonus',
        description: `Coupon redemption: ${couponCode.toUpperCase()}`,
        reference: `COUPON-${couponData.couponId}`,
      });

      await creditBalance.save();
    }

    // console.log('Credit balance updated:', creditBalance);

    // Mark coupon as used using new service
    await couponService.markCouponAsUsed(
      couponData.batchId,
      couponData.couponId,
      userId,
    );

    // Get user info for response
    const user = await User.findById(userId).select('name email');

    res.status(200).json({
      status: 'success',
      discountValue: couponData.discountValue,
      discountType: couponData.discountType,
      couponId: couponData.couponId,
      batchId: couponData.batchId,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
      newBalance: creditBalance.balance,
    });
  } catch (error) {
    console.error('Error applying coupon:', error);
    return next(new AppError(error.message, 400));
  }
});
