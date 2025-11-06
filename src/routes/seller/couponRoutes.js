const express = require('express');
const {
  getSellerCouponBatches,
  getCouponBatch,
  createCouponBatch,
  updateCouponBatch,
  deleteCouponBatch,
  applyCoupon,
  applyUserCoupon,
} = require('../../controllers/seller/couponController');
const authController = require('../../controllers/buyer/authController');
const router = express.Router();

router.post(
  '/apply',
  authController.protect,
  authController.restrictTo('user'),
  applyCoupon,
);
router.post(
  '/apply-user-coupon',
  authController.protect,
  authController.restrictTo('user'),
  applyUserCoupon,
);

//Admin/SellerRoutes
router.use(authController.protect);
router.use(authController.restrictTo('seller', 'admin'));

router.route('/').get(getSellerCouponBatches).post(createCouponBatch);
router
  .route('/:id')
  .patch(updateCouponBatch)
  .get(getCouponBatch)
  .delete(deleteCouponBatch);

module.exports = router;
