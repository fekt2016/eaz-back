const express = require('express');
const recommendationController = require('../../controllers/shared/recommendationController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// Public routes (no authentication required)
router.get('/products/:id/related', recommendationController.getRelatedProducts);
router.get('/products/:id/also-bought', recommendationController.getAlsoBought);
router.get('/products/:id/ai-similar', recommendationController.getAISimilar);
router.get('/products/trending', recommendationController.getTrending);

// Protected routes (authentication optional but recommended for better results)
router.get(
  '/users/:id/personalized',
  authController.protect, // Optional - can be made public
  recommendationController.getPersonalized
);

router.get(
  '/users/:id/recently-viewed',
  authController.protect, // Optional - can be made public
  recommendationController.getRecentlyViewed
);

// Activity tracking (public but can be authenticated)
router.post(
  '/track',
  authController.protect, // Optional
  recommendationController.trackActivity
);

module.exports = router;

