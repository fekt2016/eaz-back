const express = require('express');
const analyticsController = require('../../controllers/admin/analyticsController');
const authController = require('../../controllers/buyer/authController');
const authSellerController = require('../../controllers/seller/authSellerController');
const { optionalAuth } = require('../../middleware/auth/optionalAuth');
const {
  analyticsIngestionLimiter,
} = require('../../middleware/rateLimiting/analyticsLimiter');
const router = express.Router();

router.post(
  '/views',
  // Allow both authenticated and anonymous users to record views
  optionalAuth,
  analyticsIngestionLimiter,
  analyticsController.recordView,
);

router.post(
  '/screen-views',
  optionalAuth,
  analyticsIngestionLimiter,
  analyticsController.recordScreenView
);
router.post(
  '/search',
  optionalAuth,
  analyticsIngestionLimiter,
  analyticsController.recordSearchQuery
);
router.post(
  '/category-views',
  optionalAuth,
  analyticsIngestionLimiter,
  analyticsController.recordCategoryView
);
router.post(
  '/seller-views',
  optionalAuth,
  analyticsIngestionLimiter,
  analyticsController.recordSellerView
);

// Seller analytics - allow sellers to view their own analytics
router.get(
  '/seller/:sellerId/views',
  // IMPORTANT: Use seller-specific auth so we look at seller_jwt, not main_jwt
  authSellerController.protectSeller,
  authController.restrictTo('seller', 'admin'),
  analyticsController.getSellerProductViews,
);

module.exports = router;
