/**
 * Admin Payout Routes
 */

const express = require('express');
const payoutController = require('../../controllers/admin/payoutController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
// Allow superadmin and admin (moderators cannot approve/reject)
router.use(authController.restrictTo('admin', 'superadmin'));

// Get all withdrawal requests
router.get('/requests', payoutController.getAllWithdrawalRequests);

// Get single withdrawal request
router.get('/request/:id', payoutController.getWithdrawalRequest);

// Approve withdrawal request
router.post('/request/:id/approve', payoutController.approveWithdrawalRequest);

// Reject withdrawal request
router.post('/request/:id/reject', payoutController.rejectWithdrawalRequest);

// Verify transfer status
router.post('/request/:id/verify', payoutController.verifyTransferStatus);

module.exports = router;

