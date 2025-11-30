const express = require('express');
const authController = require('../../controllers/buyer/authController');
const reviewController = require('../../controllers/shared/reviewController');

const { getAllReview,
  getReview,
  createReview,
  updateReview,
  deleteReview,
  createUserReview,
  replyToReview, } = require('../../controllers/shared/reviewController');

const router = express.Router({ mergeParams: true });

router
  .route('/')
  .get(authController.protect, authController.restrictTo('admin'), getAllReview)
  .post(
    authController.protect,
    authController.restrictTo('user'),
    reviewController.setProductUserIds,
    createUserReview,
  );

router
  .route('/:id')
  .get(reviewController.getReview)
  .patch(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    reviewController.updateReview,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    reviewController.deleteReview,
  );

// Seller reply to review
router
  .route('/:id/reply')
  .post(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    reviewController.replyToReview,
  );

module.exports = router;;
