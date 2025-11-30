const express = require('express');
const { getAllPaymentMethods,
  getPaymentMethod,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  setDefaultPaymentMethod,
  getMyPaymentMethods, } = require('../../controllers/shared/paymentMethodController');
const authController = require('../../controllers/buyer/authController');
const router = express.Router();

router
  .route('/')
  .get(getAllPaymentMethods)
  .post(
    authController.protect,
    authController.restrictTo('user', 'admin', 'seller'),
    createPaymentMethod,
  );

// Get current user's payment methods
router.get(
  '/me',
  authController.protect,
  getMyPaymentMethods,
);
router.patch(
  '/set-Default/:id',
  authController.protect,
  authController.restrictTo('user', 'admin', 'seller'),
  setDefaultPaymentMethod,
);
router
  .route('/:id')
  .get(getPaymentMethod)
  .patch(
    authController.protect,
    authController.restrictTo('user', 'admin', 'seller'),
    updatePaymentMethod,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'admin', 'seller'),
    deletePaymentMethod,
  );

module.exports = router;;
