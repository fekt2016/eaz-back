const express = require('express');
const router = express.Router();
const addressController = require('../../controllers/buyer/addressController');
const authController = require('../../controllers/buyer/authController');

// Apply authentication middleware to all routes

router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('user'),
    addressController.getUserAddresses,
  )
  .post(
    authController.protect,
    authController.restrictTo('user'),
    addressController.createAddress,
  );
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('user'),
    addressController.getAddress,
  )
  .patch(
    authController.protect,
    authController.restrictTo('user'),
    addressController.updateAddress,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user'),
    addressController.deleteAddress,
  );
router.patch(
  '/:id/set-default',
  authController.protect,
  authController.restrictTo('user'),
  addressController.setDefaultAddress,
);

module.exports = router;
