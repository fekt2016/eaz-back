const express = require('express');
const {
  getAllPaymentMethods,
  getPaymentMethod,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  setDefaultPaymentMethod,
} = require('../../controllers/shared/paymentMethodController');
const authController = require('../../controllers/buyer/authController');
const router = express.Router();

router
  .route('/')
  .get(getAllPaymentMethods)
  .post(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    createPaymentMethod,
  );
router.patch(
  '/set-Default/:id',
  authController.protect,
  authController.restrictTo('user', 'admin'),
  setDefaultPaymentMethod,
);
router
  .route('/:id')
  .get(getPaymentMethod)
  .patch(updatePaymentMethod)
  .delete(deletePaymentMethod);

module.exports = router;
