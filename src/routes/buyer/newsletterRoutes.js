const express = require('express');
const router = express.Router();
const newsletterController = require('../../controllers/buyer/newsletterController');
const authController = require('../../controllers/buyer/authController');
//router for unsubscribing from newsletter

router
  .route('/')
  .post(newsletterController.subscribeToNewsletter)
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    newsletterController.getAllSubscribers,
  )
  .delete(newsletterController.unsubscribeFromNewsletter);

module.exports = router;;
