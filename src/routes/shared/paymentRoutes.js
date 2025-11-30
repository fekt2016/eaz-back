const express = require('express');

const { getAllPayment,
  createPayment,
  updatePayment,
  deletePayment,
  initializePaystack,
  verifyPaystackPayment,
  paystackWebhook, } = require('../../controllers/shared/paymentController');
const authController = require('../../controllers/buyer/authController');
const router = express.Router();

router.route('/').get(getAllPayment).post(createPayment);
router.route('/:id').patch(updatePayment).delete(deletePayment);

// Paystack payment initialization
router.post(
  '/paystack/initialize',
  authController.protect,
  authController.restrictTo('user'),
  initializePaystack
);

// Paystack payment verification (called from frontend after redirect)
router.get(
  '/paystack/verify',
  authController.protect,
  authController.restrictTo('user'),
  verifyPaystackPayment
);

// Paystack webhook (no auth required - Paystack calls this directly)
router.post(
  '/paystack/webhook',
  express.raw({ type: 'application/json' }), // Raw body for signature verification
  paystackWebhook
);

module.exports = router;
