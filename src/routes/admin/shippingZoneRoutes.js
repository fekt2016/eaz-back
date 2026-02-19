const express = require('express');
const authController = require('../../controllers/buyer/authController');
const shippingZoneController = require('../../controllers/admin/shippingZoneController');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

// Admin-only routes
router
  .route('/')
  .post(authController.restrictTo('admin', 'superadmin'), shippingZoneController.createShippingZone)
  .get(authController.restrictTo('admin', 'superadmin'), shippingZoneController.getAllShippingZones);

router
  .route('/:id')
  .get(authController.restrictTo('admin', 'superadmin'), shippingZoneController.getShippingZone)
  .patch(authController.restrictTo('admin', 'superadmin'), shippingZoneController.updateShippingZone)
  .delete(authController.restrictTo('admin', 'superadmin'), shippingZoneController.deleteShippingZone);

router.patch(
  '/:id/toggle',
  authController.restrictTo('admin', 'superadmin'),
  shippingZoneController.toggleShippingZoneActive
);

module.exports = router;

