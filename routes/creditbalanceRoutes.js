const express = require('express');
const router = express.Router();
const creditbalanceController = require('../Controllers/creditbalanceController');
const authController = require('../Controllers/authController');

// router.use(authController.protect);

router.get(
  '/balance',
  authController.protect,
  authController.restrictTo('user'),
  creditbalanceController.getCreditBalance,
);
router.post(
  '/add',
  authController.restrictTo('admin'),
  creditbalanceController.addCredit,
);
router.get(
  '/transactions',
  authController.restrictTo('user'),
  creditbalanceController.getTransactions,
);

module.exports = router;
