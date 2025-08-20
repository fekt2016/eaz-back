const express = require('express');
const router = express.Router();
const paymentRequestController = require('../controllers/paymentRequestController');
const authController = require('../controllers/authController');

// Seller routes
router.post(
  '/',
  authController.protect,
  authController.restrictTo('seller'),
  paymentRequestController.createPaymentRequest,
);

router.get(
  '/',
  authController.protect,
  authController.restrictTo('seller'),
  paymentRequestController.getSellerRequests,
);

router.get(
  '/:id',
  authController.protect,
  authController.restrictTo('seller'),
  paymentRequestController.getRequestById,
);

// Admin routes
router.get(
  '/admin/pending',
  authController.protect,
  authController.restrictTo('admin'),
  paymentRequestController.getPendingRequests,
);

router.put(
  '/admin/:id/process',
  authController.protect,
  authController.restrictTo('admin'),
  paymentRequestController.processPaymentRequest,
);

module.exports = router;
