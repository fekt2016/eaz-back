const express = require('express');
const {
  getAllPaymentMthd,
  createPaymentMethod,
  updatePaymentMethod,
} = require('../Controllers/paymentMethodController');

const router = express.Router();

router.route('/').get(getAllPaymentMthd).post(createPaymentMethod);
router.route('/:id').patch(updatePaymentMethod);

module.exports = router;
