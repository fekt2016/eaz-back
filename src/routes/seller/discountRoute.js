/**
 * Seller Discount Routes
 * Routes for sellers to create and manage discounts
 * 
 * SECURITY: These routes MUST use authSellerController.protectSeller middleware
 * which correctly uses seller_jwt cookie for seller authentication.
 * This ensures seller routes NEVER go through buyer authentication logic.
 */
const express = require('express');
const discountController = require('../../controllers/seller/discountController');
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

router
  .route('/')
  .get(discountController.getAllDiscount)
  .post(discountController.createDiscount);

router
  .route('/:id')
  .get(discountController.getDiscount)
  .patch(discountController.updateDiscount)
  .delete(discountController.deleteDiscount);

module.exports = router;
