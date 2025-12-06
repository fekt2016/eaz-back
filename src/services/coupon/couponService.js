/**
 * Coupon Service V2
 * Centralized, secure coupon validation and application logic
 * 
 * This service implements a strict validation pipeline and ensures
 * all discount calculations happen server-side only.
 */

const CouponBatch = require('../../models/coupon/couponBatchModel');
const CouponUsage = require('../../models/coupon/couponUsageModel');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');

/**
 * Strict coupon validation pipeline
 * Returns validated coupon data with calculated discount
 * 
 * @param {String} couponCode - The coupon code to validate
 * @param {String} userId - User ID applying the coupon
 * @param {Number} orderAmount - Total order amount (subtotal)
 * @param {Array} productIds - Array of product IDs in the order
 * @param {Array} categoryIds - Array of category IDs in the order
 * @param {Array} sellerIds - Array of seller IDs in the order
 * @param {Object} session - MongoDB session for transaction
 * @returns {Object} Validated coupon data with calculated discount
 */
exports.validateCoupon = async (
  couponCode,
  userId,
  orderAmount,
  productIds = [],
  categoryIds = [],
  sellerIds = [],
  session = null
) => {
  const now = new Date();
  const code = couponCode.toUpperCase().trim();

  // Step 1: Check coupon exists
  const query = CouponBatch.findOne({
    'coupons.code': code,
    isActive: true,
    validFrom: { $lte: now },
    expiresAt: { $gte: now },
  });

  if (session) {
    query.session(session);
  }

  const batch = await query;

  if (!batch) {
    throw new AppError('Coupon not found, expired, or inactive', 400);
  }

  // Step 2: Find the specific coupon within the batch
  const coupon = batch.coupons.find((c) => c.code === code);

  if (!coupon) {
    throw new AppError('Invalid coupon code', 400);
  }

  // Step 3: Check if coupon is already used (for single-use coupons)
  if (coupon.used && batch.maxUsage === 1) {
    throw new AppError('This coupon has already been used', 400);
  }

  // Step 4: Check per-coupon usage limit
  if (coupon.usageCount >= batch.maxUsage) {
    throw new AppError('Coupon usage limit reached', 400);
  }

  // Step 5: Check per-user usage limit
  // Handle both Map and object formats (for backward compatibility)
  let userUsageCount = 0;
  if (coupon.userUsageCount) {
    if (coupon.userUsageCount instanceof Map) {
      userUsageCount = coupon.userUsageCount.get(userId.toString()) || 0;
    } else if (typeof coupon.userUsageCount === 'object') {
      userUsageCount = coupon.userUsageCount[userId.toString()] || 0;
    }
  }
  if (userUsageCount >= batch.maxUsagePerUser) {
    throw new AppError(
      `You have reached the maximum usage limit (${batch.maxUsagePerUser}) for this coupon`,
      400
    );
  }

  // Step 6: Check recipient assignment (if coupon is assigned to specific user)
  // Handle both ObjectId and string formats
  // Only check if recipient exists - if it does, it must match the user
  if (coupon.recipient) {
    // Handle ObjectId, string, or populated user object
    let recipientId;
    if (coupon.recipient._id) {
      // Populated user object
      recipientId = coupon.recipient._id.toString();
    } else if (coupon.recipient.toString) {
      // ObjectId or string
      recipientId = coupon.recipient.toString();
    } else {
      recipientId = String(coupon.recipient);
    }
    
    const userIdStr = userId.toString();
    
    // Normalize both IDs for comparison
    const normalizedRecipient = recipientId.trim();
    const normalizedUser = userIdStr.trim();
    
    if (normalizedRecipient !== normalizedUser) {
      throw new AppError('This coupon is not assigned to you', 400);
    }
  }

  // Step 7: Check minimum order amount
  if (batch.minOrderAmount && orderAmount < batch.minOrderAmount) {
    throw new AppError(
      `Minimum order amount of GH₵${batch.minOrderAmount.toFixed(2)} required`,
      400
    );
  }

  // Step 8: Check seller ownership (if not global coupon)
  if (!batch.global && batch.seller) {
    const couponSellerId = batch.seller.toString();
    if (!sellerIds.includes(couponSellerId)) {
      throw new AppError(
        'This coupon is not valid for products in your cart',
        400
      );
    }
  }

  // Step 9: Check product applicability
  if (batch.applicableProducts && batch.applicableProducts.length > 0) {
    const applicableProductIds = batch.applicableProducts.map((id) =>
      id.toString()
    );
    const hasApplicableProduct = productIds.some((pid) =>
      applicableProductIds.includes(pid.toString())
    );
    if (!hasApplicableProduct) {
      throw new AppError(
        'This coupon is not valid for products in your cart',
        400
      );
    }
  }

  // Step 10: Check category applicability
  if (batch.applicableCategories && batch.applicableCategories.length > 0) {
    const applicableCategoryIds = batch.applicableCategories.map((id) =>
      id.toString()
    );
    const hasApplicableCategory = categoryIds.some((cid) =>
      applicableCategoryIds.includes(cid.toString())
    );
    if (!hasApplicableCategory) {
      throw new AppError(
        'This coupon is not valid for categories in your cart',
        400
      );
    }
  }

  // Step 11: Calculate discount (BACKEND ONLY - NEVER TRUST FRONTEND)
  let discountAmount = 0;

  if (batch.discountType === 'percentage') {
    discountAmount = (orderAmount * batch.discountValue) / 100;
    // Apply max discount cap if set
    if (batch.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, batch.maxDiscountAmount);
    }
  } else {
    // Fixed discount
    discountAmount = Math.min(batch.discountValue, orderAmount);
  }

  // Step 12: Ensure discount never exceeds order amount
  discountAmount = Math.min(discountAmount, orderAmount);
  discountAmount = Math.round(discountAmount * 100) / 100; // Round to 2 decimals

  // Step 13: Check batch-level usage limit
  const totalUsedCoupons = batch.coupons.filter((c) => c.used).length;
  if (totalUsedCoupons >= batch.maxUsage * batch.coupons.length) {
    throw new AppError('This coupon batch has reached its usage limit', 400);
  }

  return {
    batchId: batch._id,
    couponId: coupon._id,
    discountValue: batch.discountValue,
    discountType: batch.discountType,
    discountAmount, // ✅ Calculated discount amount
    maxDiscountAmount: batch.maxDiscountAmount,
    sellerFunded: batch.sellerFunded,
    platformFunded: batch.platformFunded,
    global: batch.global,
    sellerId: batch.seller,
    minOrderAmount: batch.minOrderAmount,
    remainingUses: batch.maxUsage - coupon.usageCount,
    userRemainingUses: batch.maxUsagePerUser - userUsageCount,
  };
};

/**
 * Apply coupon to order (atomic operation)
 * Marks coupon as used only after order is successfully created
 * 
 * @param {String} batchId - Coupon batch ID
 * @param {String} couponId - Coupon ID within batch
 * @param {String} userId - User ID
 * @param {String} orderId - Order ID
 * @param {Object} session - MongoDB session
 */
exports.applyCouponToOrder = async (
  batchId,
  couponId,
  userId,
  orderId,
  session
) => {
  // Fetch batch within session
  const batch = await CouponBatch.findById(batchId).session(session);

  if (!batch) {
    throw new AppError('Coupon batch not found', 404);
  }

  const coupon = batch.coupons.find(
    (c) => c._id.toString() === couponId.toString()
  );

  if (!coupon) {
    throw new AppError('Coupon not found in batch', 404);
  }

  // Check usage limit again (double-check)
  if (coupon.usageCount >= batch.maxUsage) {
    throw new AppError('Coupon usage limit reached', 400);
  }

  // Update coupon usage
  coupon.usageCount += 1;
  coupon.used = coupon.usageCount >= batch.maxUsage; // Mark as used if limit reached
  if (coupon.usageCount >= batch.maxUsage) {
    coupon.usedAt = new Date();
  }
  coupon.lastUsedAt = new Date();
  coupon.lastUsedBy = userId;

  // Update user-specific usage count
  // Ensure userUsageCount is a Map (Mongoose handles this automatically)
  if (!coupon.userUsageCount) {
    coupon.userUsageCount = new Map();
  } else if (!(coupon.userUsageCount instanceof Map)) {
    // Convert object to Map if needed (backward compatibility)
    const map = new Map();
    Object.entries(coupon.userUsageCount).forEach(([key, value]) => {
      map.set(key, value);
    });
    coupon.userUsageCount = map;
  }
  const currentUserCount = coupon.userUsageCount.get(userId.toString()) || 0;
  coupon.userUsageCount.set(userId.toString(), currentUserCount + 1);

  // Add order to coupon's orders array
  if (!coupon.orders) {
    coupon.orders = [];
  }
  coupon.orders.push(orderId);

  // Increment batch-level usage count
  batch.usageCount = (batch.usageCount || 0) + 1;

  // Save within session
  await batch.save({ session });

  return {
    success: true,
    coupon,
    batch,
  };
};

/**
 * Calculate discount distribution across sellers
 * Returns discount breakdown per seller
 * 
 * @param {Number} totalDiscount - Total discount amount
 * @param {Map} sellerGroups - Map of sellerId -> { subtotal, items }
 * @param {String} couponSellerId - Seller who owns the coupon (if seller-funded)
 * @param {Boolean} sellerFunded - Whether seller pays for discount
 * @param {Boolean} platformFunded - Whether platform pays for discount
 * @returns {Map} Map of sellerId -> discountAmount
 */
exports.calculateSellerDiscounts = (
  totalDiscount,
  sellerGroups,
  couponSellerId,
  sellerFunded,
  platformFunded
) => {
  const sellerDiscounts = new Map();
  const overallSubtotal = Array.from(sellerGroups.values()).reduce(
    (sum, group) => sum + group.subtotal,
    0
  );

  if (overallSubtotal === 0) {
    return sellerDiscounts;
  }

  // If seller-funded and coupon has specific seller, only that seller pays
  if (sellerFunded && couponSellerId && !platformFunded) {
    const couponSellerGroup = sellerGroups.get(couponSellerId.toString());
    if (couponSellerGroup) {
      const sellerDiscount = Math.min(totalDiscount, couponSellerGroup.subtotal);
      sellerDiscounts.set(couponSellerId.toString(), sellerDiscount);
    }
    // Other sellers get 0 discount impact
    sellerGroups.forEach((group, sellerId) => {
      if (sellerId !== couponSellerId.toString()) {
        sellerDiscounts.set(sellerId, 0);
      }
    });
  } else {
    // Distribute discount proportionally across all sellers
    sellerGroups.forEach((group, sellerId) => {
      const proportionalDiscount =
        (group.subtotal / overallSubtotal) * totalDiscount;
      sellerDiscounts.set(sellerId, Math.round(proportionalDiscount * 100) / 100);
    });
  }

  return sellerDiscounts;
};

/**
 * Validate coupon for wallet credit (fixed amount only)
 * 
 * @param {String} couponCode - Coupon code
 * @param {String} userId - User ID
 * @returns {Object} Validated coupon data
 */
exports.validateUserCoupon = async (couponCode, userId) => {
  const now = new Date();
  const code = couponCode.toUpperCase().trim();

  const batch = await CouponBatch.findOne({
    'coupons.code': code,
    isActive: true,
    validFrom: { $lte: now },
    expiresAt: { $gte: now },
  });

  if (!batch) {
    throw new AppError('Coupon not found or expired', 400);
  }

  const coupon = batch.coupons.find((c) => c.code === code);

  if (!coupon || coupon.used) {
    throw new AppError('Invalid coupon code', 400);
  }

  if (coupon.usageCount >= batch.maxUsage) {
    throw new AppError('Coupon usage limit reached', 400);
  }

  // Check per-user usage
  let userUsageCount = 0;
  if (coupon.userUsageCount) {
    if (coupon.userUsageCount instanceof Map) {
      userUsageCount = coupon.userUsageCount.get(userId.toString()) || 0;
    } else if (typeof coupon.userUsageCount === 'object') {
      userUsageCount = coupon.userUsageCount[userId.toString()] || 0;
    }
  }
  if (userUsageCount >= batch.maxUsagePerUser) {
    throw new AppError(
      `You have reached the maximum usage limit for this coupon`,
      400
    );
  }

  // Check recipient assignment (if coupon is assigned to specific user)
  // Handle both ObjectId and string formats
  // Only check if recipient exists - if it does, it must match the user
  if (coupon.recipient) {
    // Handle ObjectId, string, or populated user object
    let recipientId;
    if (coupon.recipient._id) {
      // Populated user object
      recipientId = coupon.recipient._id.toString();
    } else if (coupon.recipient.toString) {
      // ObjectId or string
      recipientId = coupon.recipient.toString();
    } else {
      recipientId = String(coupon.recipient);
    }
    
    const userIdStr = userId.toString();
    
    // Normalize both IDs for comparison
    const normalizedRecipient = recipientId.trim();
    const normalizedUser = userIdStr.trim();
    
    if (normalizedRecipient !== normalizedUser) {
      throw new AppError('This coupon is not assigned to you', 400);
    }
  }

  // Only fixed amount coupons can be applied to wallet
  if (batch.discountType !== 'fixed') {
    throw new AppError('Only fixed amount coupons can be applied to wallet', 400);
  }

  return {
    discountValue: batch.discountValue,
    discountType: batch.discountType,
    couponId: coupon._id,
    batchId: batch._id,
    sellerId: batch.seller,
    maxUsage: batch.maxUsage,
    usageCount: coupon.usageCount,
    isActive: batch.isActive,
    expiresAt: batch.expiresAt,
    minOrderAmount: batch.minOrderAmount,
  };
};

/**
 * Mark coupon as used for wallet credit
 * 
 * @param {String} batchId - Batch ID
 * @param {String} couponId - Coupon ID
 * @param {String} userId - User ID
 */
exports.markCouponAsUsed = async (batchId, couponId, userId) => {
  const batch = await CouponBatch.findById(batchId);

  if (!batch) {
    throw new AppError('Coupon batch not found', 404);
  }

  const coupon = batch.coupons.find(
    (c) => c._id.toString() === couponId.toString()
  );

  if (!coupon) {
    throw new AppError('Coupon not found in batch', 404);
  }

  coupon.used = true;
  coupon.usedAt = new Date();
  coupon.lastUsedBy = userId;
  coupon.usageCount += 1;

  // Update user usage count
  if (!coupon.userUsageCount) {
    coupon.userUsageCount = new Map();
  } else if (!(coupon.userUsageCount instanceof Map)) {
    // Convert object to Map if needed
    const map = new Map();
    Object.entries(coupon.userUsageCount).forEach(([key, value]) => {
      map.set(key, value);
    });
    coupon.userUsageCount = map;
  }
  const currentUserCount = coupon.userUsageCount.get(userId.toString()) || 0;
  coupon.userUsageCount.set(userId.toString(), currentUserCount + 1);

  await batch.save();
};

module.exports = exports;

