const express = require('express');
const analyticsController = require('../../controllers/admin/analyticsController');
const authController = require('../../controllers/buyer/authController');
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
  authController.protect,
  authController.restrictTo('seller', 'admin'),
  analyticsController.getSellerProductViews,
);

module.exports = router;;
