const express = require('express');

const {
  getAllPayment,
  createPayment,
  updatePayment,
  deletePayment,
} = require('../Controllers/paymentController');
const router = express.Router();

router.route('/').get(getAllPayment).post(createPayment);
router.route('/:id').patch(updatePayment).delete(deletePayment);

module.exports = router;
