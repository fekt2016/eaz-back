const express = require('express');
const walletController = require('../../controllers/buyer/walletController');
const walletWebhookController = require('../../controllers/buyer/walletWebhookController');
const creditbalanceController = require('../../controllers/buyer/creditbalanceController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// Webhook route (no authentication required - uses signature verification)
router.post('/webhook', walletWebhookController.paystackWalletWebhook);

// All other routes require authentication
router.use(authController.protect);

// New wallet routes
router.get('/balance', walletController.getWalletBalance);
router.get('/transactions', walletController.getWalletTransactions);
router.get('/history', walletController.getWalletHistory); // Balance history endpoint
router.post('/topup', walletController.initiateTopup);
router.post('/verify', walletController.verifyTopup);

// Admin adjustment route
router.post(
  '/adjust',
  authController.restrictTo('admin'),
  walletController.adjustWallet
);

// Keep old routes for backward compatibility
router.get('/old/balance', authController.restrictTo('user'), creditbalanceController.getCreditBalance);
router.post('/old/add', authController.restrictTo('admin'), creditbalanceController.addCredit);
router.get('/old/transactions', authController.restrictTo('user'), creditbalanceController.getTransactions);

module.exports = router;

