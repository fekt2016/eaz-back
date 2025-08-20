// wishlistRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../Controllers/authController');
const {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  syncWishlist,
} = require('../Controllers/wishlistController');

router
  .route('/')
  .get(authController.protect, authController.restrictTo('user'), getWishlist)
  .post(
    authController.protect,
    authController.restrictTo('user'),
    addToWishlist,
  );
router
  .route('/sync')
  .post(
    authController.protect,
    authController.restrictTo('user'),
    syncWishlist,
  );

router
  .route('/:productId')
  .delete(
    authController.protect,
    authController.restrictTo('user'),
    removeFromWishlist,
  );

module.exports = router;
