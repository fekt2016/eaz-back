const express = require('express');
const authController = require('../../controllers/buyer/authController');
const reviewController = require('../../controllers/shared/reviewController');
const { validateObjectId } = require('../../middleware/validateObjectId');
const { reviewSubmissionLimiter } = require('../../middleware/rateLimiting/reviewLimiter');

const { getAllReview,
  getReview,
  createReview,
  updateReview,
  deleteReview,
  createUserReview,
  replyToReview,
  getMyReviews, } = require('../../controllers/shared/reviewController');

const router = express.Router({ mergeParams: true });

// Get current user's reviews - must be before /:id route
router.get(
  '/my-reviews',
  authController.protect,
  authController.restrictTo('user'),
  getMyReviews
);

router
  .route('/')
  .get(authController.protect, authController.restrictTo('admin'), getAllReview)
  .post(
    authController.protect,
    authController.restrictTo('user'),
    reviewSubmissionLimiter, // Rate limiting: 5 reviews per hour per user
    reviewController.setProductUserIds,
    createUserReview,
  );

router
  .route('/:id')
  .get(validateObjectId('id'), reviewController.getReview)
  .patch(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    validateObjectId('id'),
    reviewController.updateReview,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    validateObjectId('id'),
    reviewController.deleteReview,
  );

// Seller reply to review
router
  .route('/:id/reply')
  .post(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    validateObjectId('id'),
    reviewController.replyToReview,
  );

module.exports = router;;
