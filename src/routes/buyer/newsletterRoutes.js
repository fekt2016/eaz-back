const express = require('express');
const router = express.Router();
const newsletterController = require('../../controllers/buyer/newsletterController');
const authController = require('../../controllers/buyer/authController');
const { OPS_ROLES } = require('../../config/rolePermissions');
//router for unsubscribing from newsletter

router
  .route('/')
  .post(newsletterController.subscribeToNewsletter)
  .get(
    authController.protect,
    authController.restrictTo(...OPS_ROLES),
    newsletterController.getAllSubscribers,
  )
  .delete(newsletterController.unsubscribeFromNewsletter);

module.exports = router;;
