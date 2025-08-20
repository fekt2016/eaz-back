const express = require('express');
const {
  getSellerCouponBatches,
  getCouponBatch,
  createCouponBatch,
  updateCouponBatch,
  deleteCouponBatch,
  applyCoupon,
  markCouponUsed,
} = require('../Controllers/couponController');
const authController = require('../Controllers/authController');
const router = express.Router();

router.post(
  '/apply',
  authController.protect,
  authController.restrictTo('user'),
  applyCoupon,
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
