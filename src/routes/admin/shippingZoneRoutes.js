const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { SUPERADMIN_ONLY } = require('../../config/rolePermissions');
const shippingZoneController = require('../../controllers/admin/shippingZoneController');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

// Admin-only routes
router
  .route('/')
  .post(authController.restrictTo(...SUPERADMIN_ONLY), shippingZoneController.createShippingZone)
  .get(authController.restrictTo(...SUPERADMIN_ONLY), shippingZoneController.getAllShippingZones);

router
  .route('/:id')
  .get(authController.restrictTo(...SUPERADMIN_ONLY), shippingZoneController.getShippingZone)
  .patch(authController.restrictTo(...SUPERADMIN_ONLY), shippingZoneController.updateShippingZone)
  .delete(authController.restrictTo(...SUPERADMIN_ONLY), shippingZoneController.deleteShippingZone);

router.patch(
  '/:id/toggle',
  authController.restrictTo(...SUPERADMIN_ONLY),
  shippingZoneController.toggleShippingZoneActive
);

module.exports = router;

