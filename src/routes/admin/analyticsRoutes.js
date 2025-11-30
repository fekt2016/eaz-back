const express = require('express');
const analyticsController = require('../../controllers/admin/analyticsController');
const authController = require('../../controllers/buyer/authController');
const router = express.Router();

router.post(
  '/views',
  authController.protect,
  authController.restrictTo('user'),
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
