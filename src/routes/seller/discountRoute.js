const express = require('express');
const discountController = require('../../controllers/seller/discountController');
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

router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    requireVerifiedSellerIfSeller,
    discountController.getAllDiscount,
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    requireVerifiedSellerIfSeller,
    discountController.createDiscount,
  );
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    requireVerifiedSellerIfSeller,
    discountController.getDiscount,
  )
  .patch(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    requireVerifiedSellerIfSeller,
    discountController.updateDiscount,
  )
  .delete(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    requireVerifiedSellerIfSeller,
    discountController.deleteDiscount,
  );

module.exports = router;;
