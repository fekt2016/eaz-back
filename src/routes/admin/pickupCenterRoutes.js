const express = require('express');
const pickupCenterController = require('../../controllers/admin/pickupCenterController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

router
  .route('/')
  .get(pickupCenterController.getAllPickupCenters)
  .post(pickupCenterController.createPickupCenter);

router
  .route('/:id')
  .get(pickupCenterController.getPickupCenter)
  .put(pickupCenterController.updatePickupCenter)
  .delete(pickupCenterController.deletePickupCenter);

module.exports = router;

