const express = require('express');
const deviceSessionController = require('../../controllers/shared/deviceSessionController');
const { protect } = require('../../controllers/buyer/authController');
const { trackSessionActivity } = require('../../middleware/auth/trackSessionActivity');

const router = express.Router();

// All routes require authentication
// The protect middleware automatically handles different cookies based on route path:
// - /api/v1/seller routes use eazseller_jwt
// - /api/v1/admin routes use eazadmin_jwt
// - Default uses eazmain_jwt

// GET /api/v1/sessions/my-devices - Get all active sessions
router.get(
  '/my-devices',
  protect,
  trackSessionActivity,
  deviceSessionController.getMyDevices,
);

// DELETE /api/v1/sessions/logout-device/:deviceId - Logout specific device
router.delete(
  '/logout-device/:deviceId',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutDevice,
);

// DELETE /api/v1/sessions/logout-others - Logout all other devices
router.delete(
  '/logout-others',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutOthers,
);

// DELETE /api/v1/sessions/logout-all - Logout all devices
router.delete(
  '/logout-all',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutAll,
);

// Seller routes (using same protect - it handles eazseller_jwt cookie automatically)
router.get(
  '/seller/my-devices',
  protect,
  trackSessionActivity,
  deviceSessionController.getMyDevices,
);

router.delete(
  '/seller/logout-device/:deviceId',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutDevice,
);

router.delete(
  '/seller/logout-others',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutOthers,
);

router.delete(
  '/seller/logout-all',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutAll,
);

// Admin routes (using same protect - it handles eazadmin_jwt cookie automatically)
router.get(
  '/admin/my-devices',
  protect,
  trackSessionActivity,
  deviceSessionController.getMyDevices,
);

router.delete(
  '/admin/logout-device/:deviceId',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutDevice,
);

router.delete(
  '/admin/logout-others',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutOthers,
);

router.delete(
  '/admin/logout-all',
  protect,
  trackSessionActivity,
  deviceSessionController.logoutAll,
);

module.exports = router;

