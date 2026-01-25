const express = require('express');
const authController = require('../../controllers/buyer/authController');
const authSellerController = require('../../controllers/seller/authSellerController');
const reviewController = require('../../controllers/shared/reviewController');

const router = express.Router();

// All routes require seller authentication
// CRITICAL: Use protectSeller to ensure seller_jwt cookie is used, not main_jwt
router.use(authSellerController.protectSeller);
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

