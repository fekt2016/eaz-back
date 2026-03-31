const express = require('express');
const { optionalAuth } = require('../../middleware/auth/optionalAuth');
const statusController = require('../../controllers/buyer/statusController');

const router = express.Router();

/**
 * GET /api/v1/statuses
 * Get status feed for buyers (seller video statuses, grouped by seller).
 * Public - no auth required. When authenticated, followed sellers appear first.
 */
router.get('/', optionalAuth, statusController.getStatusFeed);

/**
 * GET /api/v1/statuses/seller/:sellerId
 * Get all status videos for one seller (for buyer on seller profile).
 * Returns one group: { seller, statuses }.
 */
router.get('/seller/:sellerId', optionalAuth, statusController.getStatusesBySeller);

/**
 * POST /api/v1/statuses/:id/view
 * Mark status as viewed. Auth optional - persists view when logged in.
 */
router.post('/:id/view', optionalAuth, statusController.markStatusViewed);

module.exports = router;
