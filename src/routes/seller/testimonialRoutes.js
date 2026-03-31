const express = require('express');
const authController = require('../../controllers/buyer/authController');
const authSellerController = require('../../controllers/seller/authSellerController');
const testimonialController = require('../../controllers/seller/testimonialController');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');

const router = express.Router();

// Public route — no auth needed
router.get('/public', testimonialController.getPublicTestimonials);

// Protected seller routes
router.use(authSellerController.protectSeller);
router.use(authController.restrictTo('seller'));
router.use(requireVerifiedSeller);

router.get('/me', testimonialController.getMyTestimonial);
router.post('/', testimonialController.createTestimonial);
router
  .route('/:id')
  .patch(testimonialController.updateTestimonial)
  .delete(testimonialController.deleteTestimonial);

module.exports = router;
