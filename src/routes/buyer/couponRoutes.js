/**
 * Buyer Coupon Routes
 * Routes for buyers to apply coupons during checkout
 */
const express = require('express');
const { applyCoupon, applyUserCoupon, getUserCoupons } = require('../../controllers/seller/couponController');
const authController = require('../../controllers/buyer/authController');
const { couponValidationLimiter, couponApplicationLimiter } = require('../../middleware/coupon/rateLimiter');

const router = express.Router();

// Get available coupons for the current user
router.get(
  '/my-coupons',
  authController.protect,
  authController.restrictTo('user'),
  getUserCoupons,
);

// Buyer routes - apply coupons during checkout
router.post(
  '/apply',
  authController.protect,
  authController.restrictTo('user'),
  couponValidationLimiter,
  applyCoupon,
);

router.post(
  '/apply-user-coupon',
  authController.protect,
  authController.restrictTo('user'),
  couponApplicationLimiter,
  applyUserCoupon,
);

module.exports = router;

