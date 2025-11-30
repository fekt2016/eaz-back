const express = require('express');
const authController = require('../../controllers/buyer/authController');
const reviewController = require('../../controllers/shared/reviewController');

const router = express.Router();

// All routes require seller authentication
router.use(authController.protect);
router.use(authController.restrictTo('seller'));

// Get reviews for seller's products
router
  .route('/')
  .get(reviewController.getSellerReviews);

// Seller reply to review
router
  .route('/:id/reply')
  .post(reviewController.replyToReview);

module.exports = router;

