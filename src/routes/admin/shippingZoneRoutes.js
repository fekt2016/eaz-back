const express = require('express');
const authController = require('../../controllers/buyer/authController');
const shippingZoneController = require('../../controllers/admin/shippingZoneController');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

// Admin-only routes
router
  .route('/')
  .post(authController.restrictTo('admin'), shippingZoneController.createShippingZone)
  .get(authController.restrictTo('admin'), shippingZoneController.getAllShippingZones);

router
  .route('/:id')
  .get(authController.restrictTo('admin'), shippingZoneController.getShippingZone)
  .patch(authController.restrictTo('admin'), shippingZoneController.updateShippingZone)
  .delete(authController.restrictTo('admin'), shippingZoneController.deleteShippingZone);

router.patch(
  '/:id/toggle',
  authController.restrictTo('admin'),
  shippingZoneController.toggleShippingZoneActive
);

module.exports = router;

