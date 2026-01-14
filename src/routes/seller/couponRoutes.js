/**
 * Seller Coupon Routes
 * Routes for sellers to create and manage coupon batches
 * 
 * SECURITY: These routes MUST use the shared authController.protect middleware
 * which correctly detects seller routes and uses seller_jwt cookie.
 * The protect middleware in buyer/authController.js handles all roles correctly.
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
const authSellerController = require('../../controllers/seller/authSellerController');
const authController = require('../../controllers/buyer/authController'); // For restrictTo only
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');
const router = express.Router();

// Helper middleware to apply requireVerifiedSeller only for sellers
const requireVerifiedSellerIfSeller = (req, res, next) => {
  if (req.user && req.user.role === 'seller') {
    return requireVerifiedSeller(req, res, next);
  }
  next(); // Admin can access without verification
};

// 🔒 CRITICAL: Use protectSeller (NOT buyer authController.protect)
// This ensures seller routes NEVER go through buyer authentication logic
router.use(authSellerController.protectSeller);
router.use(authController.restrictTo('seller', 'admin')); // restrictTo is safe to use (just checks role)
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
