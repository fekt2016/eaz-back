const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { OPS_ROLES } = require('../../config/rolePermissions');
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
  getMyReviews,
} = require('../../controllers/shared/reviewController');

const router = express.Router({ mergeParams: true });

// Get current user's reviews (must be before /:id)
router.get(
  '/my-reviews',
  authController.protect,
  authController.restrictTo('user', 'buyer'),
  getMyReviews
);

router
  .route('/')
  .get(authController.protect, authController.restrictTo(...OPS_ROLES), getAllReview)
  .post(
    authController.protect,
    authController.restrictTo('user', 'buyer'),
    reviewSubmissionLimiter, // Rate limiting: 5 reviews per hour per user
    reviewController.setProductUserIds,
    createUserReview,
  );

router
  .route('/:id')
  .get(validateObjectId('id'), reviewController.getReview)
  .patch(
    authController.protect,
    authController.restrictTo('user', 'buyer', 'admin', 'superadmin'),
    validateObjectId('id'),
    reviewController.updateReview,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'buyer', 'admin', 'superadmin'),
    validateObjectId('id'),
    reviewController.deleteReview,
  );

// Seller reply to review
router
  .route('/:id/reply')
  .post(
    authController.protect,
    authController.restrictTo('seller', 'admin', 'superadmin'),
    validateObjectId('id'),
    reviewController.replyToReview,
  );

module.exports = router;;
