const express = require('express');
const discountController = require('../Controllers/discountController');
const authController = require('../Controllers/authController');
const router = express.Router();

router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    discountController.getAllDiscount,
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    discountController.createDiscount,
  );
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    discountController.getDiscount,
  )
  .patch(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    discountController.updateDiscount,
  )
  .delete(
    authController.protect,
    authController.restrictTo('seller', 'admin'),
    discountController.deleteDiscount,
  );

module.exports = router;
