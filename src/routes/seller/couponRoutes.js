const express = require('express');
const { getSellerCouponBatches,
  getCouponBatch,
  createCouponBatch,
  updateCouponBatch,
  deleteCouponBatch,
  applyCoupon,
  applyUserCoupon, } = require('../../controllers/seller/couponController');
const authController = require('../../controllers/buyer/authController');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');
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

// Helper middleware to apply requireVerifiedSeller only for sellers
const requireVerifiedSellerIfSeller = (req, res, next) => {
  if (req.user && req.user.role === 'seller') {
    return requireVerifiedSeller(req, res, next);
  }
  next(); // Admin can access without verification
};

//Admin/SellerRoutes (require verification for sellers)
router.use(authController.protect);
router.use(authController.restrictTo('seller', 'admin'));
router.use(requireVerifiedSellerIfSeller);

router.route('/').get(getSellerCouponBatches).post(createCouponBatch);
router
  .route('/:id')
  .patch(updateCouponBatch)
  .get(getCouponBatch)
  .delete(deleteCouponBatch);

module.exports = router;;
