const express = require('express');
const authController = require('../../controllers/buyer/authController');
const reviewController = require('../../controllers/shared/reviewController');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

// Get all reviews with filtering
router
  .route('/')
  .get(reviewController.getAllReview);

// Review moderation actions
router
  .route('/:id/approve')
  .patch(reviewController.approveReview);

router
  .route('/:id/reject')
  .patch(reviewController.rejectReview);

router
  .route('/:id/flag')
  .patch(reviewController.flagReview);

router
  .route('/:id/hide')
  .patch(reviewController.hideReview);

// Standard CRUD operations
router
  .route('/:id')
  .get(reviewController.getReview)
  .patch(reviewController.updateReview)
  .delete(reviewController.deleteReview);

module.exports = router;

