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
router.get(
  '/seller/:sellerId/views',
  analyticsController.getSellerProductViews,
);

module.exports = router;
