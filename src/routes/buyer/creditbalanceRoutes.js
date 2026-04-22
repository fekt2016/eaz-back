const express = require('express');
const router = express.Router();
const creditbalanceController = require('../../controllers/buyer/creditbalanceController');
const authController = require('../../controllers/buyer/authController');
const { SUPERADMIN_ONLY } = require('../../config/rolePermissions');

// router.use(authController.protect);

router.get(
  '/balance',
  authController.protect,
  authController.restrictTo('user'),
  creditbalanceController.getCreditBalance,
);
router.post(
  '/add',
  authController.restrictTo(...SUPERADMIN_ONLY),
  creditbalanceController.addCredit,
);
router.get(
  '/transactions',
  authController.restrictTo('user'),
  creditbalanceController.getTransactions,
);

module.exports = router;;
