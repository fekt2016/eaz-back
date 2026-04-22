const express = require('express');
const router = express.Router();
const paymentController = require('../../controllers/shared/paymentController');
const authController = require('../../controllers/buyer/authController');
const { OPS_ROLES } = require('../../config/rolePermissions');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');
const { requirePayoutVerified } = require('../../middleware/seller/requirePayoutVerified');
const { withdrawalLimiter } = require('../../middleware/rateLimiting/otpLimiter');

// Seller routes - withdrawal requires payout verification + rate limiting
router.post(
  '/',
  authController.protect,
  authController.restrictTo('seller'),
  requirePayoutVerified, // CRITICAL: Block withdrawal if payout not verified
  withdrawalLimiter, // SECURITY: Max 3 withdrawal requests per hour
  paymentController.createPaymentRequest,
);

router.get(
  '/',
  authController.protect,
  authController.restrictTo('seller'),
  paymentController.getSellerRequests,
);

router.get(
  '/:id',
  authController.protect,
  authController.restrictTo('seller'),
  paymentController.getRequestById,
);

// Delete payment request (seller only) - must be before admin routes to avoid conflicts
router.delete(
  '/:id',
  authController.protect,
  authController.restrictTo('seller'),
  paymentController.deletePaymentRequest,
);

// Admin routes
router.get(
  '/admin/pending',
  authController.protect,
  authController.restrictTo(...OPS_ROLES),
  paymentController.getPendingRequests,
);

router.get(
  '/admin/:id',
  authController.protect,
  authController.restrictTo(...OPS_ROLES),
  paymentController.getPaymentRequestByIdAdmin,
);

router.put(
  '/admin/:id/process',
  authController.protect,
  authController.restrictTo(...OPS_ROLES),
  paymentController.processPaymentRequest,
);

module.exports = router;;
