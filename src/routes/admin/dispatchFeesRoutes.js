const express = require('express');
const dispatchFeesController = require('../../controllers/admin/dispatchFeesController');
const authController = require('../../controllers/buyer/authController');
const { OPS_ROLES } = require('../../config/rolePermissions');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo(...OPS_ROLES));

router
  .route('/')
  .get(dispatchFeesController.getDispatchFees)
  .put(dispatchFeesController.updateDispatchFees);

module.exports = router;

