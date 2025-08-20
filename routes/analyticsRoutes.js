const express = require('express');
const analyticsController = require('../Controllers/analyticsController');
const authController = require('../Controllers/authController');
const router = express.Router();

router.post(
  '/views',
  authController.protect,
  authController.restrictTo('user'),
  analyticsController.recordView,
);
router.get(
  '/seller/:sellerId/views',
  analyticsController.getSellerProductViews,
);

module.exports = router;
