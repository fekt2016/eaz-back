const express = require('express');
const analyticsController = require('../../controllers/admin/analyticsController');
const authController = require('../../controllers/buyer/authController');
const authSellerController = require('../../controllers/seller/authSellerController');
const router = express.Router();

router.post(
  '/views',
  // Allow both authenticated and anonymous users to record views
  // Remove authentication requirement - product views should be trackable for all users
  analyticsController.recordView,
);

// Seller analytics - allow sellers to view their own analytics
router.get(
  '/seller/:sellerId/views',
  // IMPORTANT: Use seller-specific auth so we look at seller_jwt, not main_jwt
  authSellerController.protectSeller,
  authController.restrictTo('seller', 'admin'),
  analyticsController.getSellerProductViews,
);

module.exports = router;;
