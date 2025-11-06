const express = require('express');
const router = express.Router();
const wishlistController = require('../../controllers/buyer/wishlistController');
const authController = require('../../controllers/buyer/authController');

// // Public routes (for guest users)
router.post('/guest', wishlistController.getOrCreateGuestWishlist);
router.post('/guest/add', wishlistController.addToGuestWishlist);
router.post('/guest/remove', wishlistController.removeFromGuestWishlist);

// // Protected routes (for authenticated users)
router.use(authController.protect);

router
  .route('/')
  .get(wishlistController.getWishlist)
  .post(wishlistController.addToWishlist);

router.route('/:productId').delete(wishlistController.removeFromWishlist);

router.route('/check/:productId').get(wishlistController.checkInWishlist);

router.route('/merge').post(wishlistController.mergeWishlists);

module.exports = router;
