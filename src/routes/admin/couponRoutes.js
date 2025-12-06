const express = require('express');
const couponController = require('../../controllers/admin/couponController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo('admin'));

router
  .route('/')
  .get(couponController.getAllCoupons)
  .post(couponController.createGlobalCoupon);

router.get('/analytics', couponController.getCouponAnalytics);

router.get('/:id', couponController.getCouponBatch);
router.patch('/:id/deactivate', couponController.deactivateCoupon);

module.exports = router;

