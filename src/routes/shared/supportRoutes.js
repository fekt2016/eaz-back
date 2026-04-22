const express = require('express');
const supportController = require('../../controllers/shared/supportController');
const authController = require('../../controllers/buyer/authController');
const { ALL_ADMIN_ROLES } = require('../../config/rolePermissions');
const {
  supportTicketCreateLimiter,
  supportTicketReplyLimiter,
} = require('../../middleware/rateLimiting/supportLimiter');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

// User/Seller routes
router.post(
  '/tickets',
  supportTicketCreateLimiter,
  supportController.uploadSupportFiles,
  supportController.validateSupportFileSignatures,
  supportController.createTicket
);

router.get('/tickets/my', supportController.getMyTickets);
router.get('/tickets/product-related', supportController.getProductRelatedTickets);
router.get('/tickets/:id', supportController.getTicketById);

router.post(
  '/tickets/:id/reply',
  supportTicketReplyLimiter,
  supportController.uploadSupportFiles,
  supportController.validateSupportFileSignatures,
  supportController.replyToTicket
);

// Admin routes
router.patch(
  '/tickets/:id/status',
  authController.restrictTo(...ALL_ADMIN_ROLES),
  supportController.updateTicketStatus
);

router.get(
  '/admin/tickets',
  authController.restrictTo(...ALL_ADMIN_ROLES),
  supportController.getAllTickets
);

router.get(
  '/admin/stats',
  authController.restrictTo(...ALL_ADMIN_ROLES),
  supportController.getSupportStats
);

// Seller-specific routes (restricted to sellers only)
router.get(
  '/seller/tickets',
  authController.restrictTo('seller'),
  supportController.getSellerTickets
);

router.get(
  '/seller/tickets/:id',
  authController.restrictTo('seller'),
  supportController.getSellerTicketById
);

module.exports = router;

