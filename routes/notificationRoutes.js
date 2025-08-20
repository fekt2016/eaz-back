const express = require('express');
const authController = require('../Controllers/authController');
const notificationController = require('../Controllers/notificationController');

const router = express.Router();

router.use(authController.protect, authController.restrictTo('user'));

router
  .route('/')
  .get(notificationController.getUserSettings)
  .patch(notificationController.updateSettings);

router.patch('/reset', notificationController.resetToDefaults);

module.exports = router;
