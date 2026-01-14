const express = require('express');

const { getAllPayment,
  createPayment,
  updatePayment,
  deletePayment,
  initializePaystack,
  verifyPaystackPayment,
  paystackWebhook, } = require('../../controllers/shared/paymentController');
const authController = require('../../controllers/buyer/authController');
// SECURITY FIX #4 (Phase 2 Enhancement): Rate limiting for payment endpoints
const { paymentInitLimiter, paymentVerificationLimiter } = require('../../middleware/rateLimiting/paymentLimiter');
// SECURITY FIX #5 (Phase 2 Enhancement): Input validation for payment operations
const { validatePaystackInit, handleValidationErrors } = require('../../middleware/validation/paymentValidator');
// SECURITY FIX #8: Paystack webhook signature verification
const { verifyPaystackWebhook } = require('../../middleware/paystackWebhookVerification');

const router = express.Router();

router.route('/').get(getAllPayment).post(createPayment);
router.route('/:id').patch(updatePayment).delete(deletePayment);

// Paystack payment initialization
// SECURITY FIX #4 & #5: Rate limiting + input validation to prevent payment abuse
router.post(
  '/paystack/initialize',
  authController.protect,
  authController.restrictTo('user'),
  paymentInitLimiter, // ✅ Rate limit payment initialization
  validatePaystackInit, // ✅ Validate payment input
  handleValidationErrors, // ✅ Handle validation errors
  initializePaystack
);

// Paystack payment verification (called from frontend after redirect)
// SECURITY FIX #4: Rate limiting added to prevent verification abuse
router.get(
  '/paystack/verify',
  authController.protect,
  authController.restrictTo('user'),
  paymentVerificationLimiter, // ✅ Rate limit payment verification
  verifyPaystackPayment
);

// Paystack webhook (no auth required - Paystack calls this directly)
// SECURITY FIX #8: Verify webhook signature before processing
router.post(
  '/paystack/webhook',
  express.raw({ type: 'application/json' }), // Raw body for signature verification (must be before verification)
  verifyPaystackWebhook, // Verify signature using Paystack secret key
  paystackWebhook
);

module.exports = router;
