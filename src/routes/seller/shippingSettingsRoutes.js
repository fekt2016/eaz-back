const express = require('express');
const shippingSettingsController = require('../../controllers/seller/shippingSettingsController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

// Get seller's shipping settings
router.get(
  '/my',
  authController.restrictTo('seller'),
  shippingSettingsController.getMyShippingSettings
);

// Update seller's shipping settings
router.put(
  '/my',
  authController.restrictTo('seller'),
  shippingSettingsController.updateMyShippingSettings
);

module.exports = router;

