const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { OPS_ROLES } = require('../../config/rolePermissions');
const cartController = require('../../controllers/buyer/cartController');

const router = express.Router();

// Protect ALL cart routes
router.use(authController.protect);

// User-specific cart routes
router
  .route('/')
  .post(
    authController.restrictTo('user'),
    cartController.setUserId, // Fixed typo: setUderId → setUserId
    cartController.addToCart,
  )
  .get(
    authController.restrictTo('user'),
    cartController.getMyCart, // New controller for user's own cart
  )
  .delete(
    authController.restrictTo('user'),
    cartController.setUserId,
    cartController.clearCart,
  );

// Protected cart item operations
router
  .route('/items/:itemId')
  .patch(
    authController.protect,
    authController.restrictTo('user'),
    cartController.updateCartItem,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user'),
    cartController.deleteCartItem,
  );

// Admin-only cart access
router.route('/:id').get(
  authController.restrictTo(...OPS_ROLES),
  cartController.getCart,
);
// .patch(
//   authController.restrictTo('admin', 'superadmin', 'support_agent'), // Only admins can modify any cart
//   cartController.updateCart,
// );

module.exports = router;;
