const express = require('express');
const router = express.Router();
const paymentController = require('../../controllers/shared/paymentController');
const authController = require('../../controllers/buyer/authController');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');
const { requirePayoutVerified } = require('../../middleware/seller/requirePayoutVerified');

// Seller routes - withdrawal requires payout verification
router.post(
  '/',
  authController.protect,
  authController.restrictTo('seller'),
  requirePayoutVerified, // CRITICAL: Block withdrawal if payout not verified
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
  authController.restrictTo('admin'),
  paymentController.getPendingRequests,
);

router.get(
  '/admin/:id',
  authController.protect,
  authController.restrictTo('admin'),
  paymentController.getPaymentRequestByIdAdmin,
);

router.put(
  '/admin/:id/process',
  authController.protect,
  authController.restrictTo('admin'),
  paymentController.processPaymentRequest,
);

module.exports = router;;
