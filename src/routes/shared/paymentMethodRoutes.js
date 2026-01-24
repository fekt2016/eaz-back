const express = require('express');
const { getAllPaymentMethods,
  getPaymentMethod,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  setDefaultPaymentMethod,
  getMyPaymentMethods,
  submitForVerification, } = require('../../controllers/shared/paymentMethodController');
const authController = require('../../controllers/buyer/authController');
const { paymentMethodCreationLimiter, verificationRequestLimiter, paymentMethodUpdateLimiter } = require('../../middleware/rateLimiting/paymentMethodLimiter');
const router = express.Router();

router
  .route('/')
  .get(getAllPaymentMethods)
  .post(
    authController.protect,
    authController.restrictTo('user', 'admin', 'seller'),
    paymentMethodCreationLimiter,
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

// Submit payment method for verification
router.patch(
  '/:id/submit',
  authController.protect,
  authController.restrictTo('user', 'admin', 'seller'),
  verificationRequestLimiter,
  submitForVerification,
);

router
  .route('/:id')
  .get(getPaymentMethod)
  .patch(
    authController.protect,
    authController.restrictTo('user', 'admin', 'seller'),
    paymentMethodUpdateLimiter,
    updatePaymentMethod,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'admin', 'seller'),
    deletePaymentMethod,
  );

module.exports = router;;
