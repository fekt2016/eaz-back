const express = require('express');
const router = express.Router();
const addressController = require('../Controllers/addressController');
const authController = require('../Controllers/authController');

// Apply authentication middleware to all routes

router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('user'),
    addressController.getAddresses,
  )
  .post(
    authController.protect,
    authController.restrictTo('user'),
    addressController.createAddress,
  );
router
  .route('/:id')
  .patch(addressController.updateAddress)
  .delete(addressController.deleteAddress);
router.patch('/:id/set-default', addressController.setDefaultAddress);

module.exports = router;
