/**
 * Seller Payout Routes
 */

const express = require('express');
const payoutController = require('../../controllers/seller/payoutController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require seller authentication
router.use(authController.protect);
router.use(authController.restrictTo('seller'));

// Create withdrawal request
router.post('/request', payoutController.createWithdrawalRequest);

// Get seller's withdrawal requests
router.get('/requests', payoutController.getSellerWithdrawalRequests);

// Get seller balance
router.get('/balance', payoutController.getSellerBalance);

// Cancel withdrawal request
router.patch('/request/:id/cancel', payoutController.cancelWithdrawalRequest);

// Delete withdrawal request
router.delete('/request/:id', payoutController.deleteWithdrawalRequest);

// Submit PIN for mobile money transfer
router.post('/request/:id/submit-pin', payoutController.submitTransferPin);

// Verify OTP for Paystack transfer
router.post('/request/:id/verify-otp', payoutController.verifyOtp);

// Resend OTP for Paystack transfer
router.post('/request/:id/resend-otp', payoutController.resendOtp);

module.exports = router;

