const express = require('express');
const refundController = require('../../controllers/admin/refundController');
const authController = require('../../controllers/buyer/authController');
const { OPS_ROLES } = require('../../config/rolePermissions');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo(...OPS_ROLES));

// Get all refunds with filters
router.get('/', refundController.getAllRefunds);

// Get single refund
router.get('/:refundId', refundController.getRefundById);

// Approve full refund
router.post('/:refundId/approve', refundController.approveRefund);

// Approve partial refund
router.post('/:refundId/approve-partial', refundController.approvePartialRefund);

// Reject refund
router.post('/:refundId/reject', refundController.rejectRefund);

// Update refund
router.patch('/:refundId', refundController.updateRefund);

module.exports = router;

