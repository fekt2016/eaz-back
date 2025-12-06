/**
 * Seller Coupon Routes
 * Routes for sellers to create and manage coupon batches
 */
const express = require('express');
const { getSellerCouponBatches,
  getCouponBatch,
  createCouponBatch,
  updateCouponBatch,
  deleteCouponBatch,
  assignCouponToBuyer,
  getEligibleBuyers,
  sendCouponEmail, } = require('../../controllers/seller/couponController');
const authController = require('../../controllers/buyer/authController');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');
const router = express.Router();

// Helper middleware to apply requireVerifiedSeller only for sellers
const requireVerifiedSellerIfSeller = (req, res, next) => {
  if (req.user && req.user.role === 'seller') {
    return requireVerifiedSeller(req, res, next);
  }
  next(); // Admin can access without verification
};

// All seller coupon routes require authentication and seller/admin role
router.use(authController.protect);
router.use(authController.restrictTo('seller', 'admin'));
router.use(requireVerifiedSellerIfSeller);

router.route('/').get(getSellerCouponBatches).post(createCouponBatch);
router.get('/eligible-buyers', getEligibleBuyers);
router.post('/send-email', sendCouponEmail);
router
  .route('/:id')
  .patch(updateCouponBatch)
  .get(getCouponBatch)
  .delete(deleteCouponBatch);
router.post('/:batchId/assign', assignCouponToBuyer);

module.exports = router;
