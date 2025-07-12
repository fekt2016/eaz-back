const express = require('express');
const analyticsController = require('../Controllers/analyticsController');
const router = express.Router();
router.post('/views', analyticsController.recordView);
router.get(
  '/seller/:sellerId/views',
  analyticsController.getSellerProductViews,
);

module.exports = router;
