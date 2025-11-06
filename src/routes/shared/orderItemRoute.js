const express = require('express');
const {
  getAllOrderItem,
  createOrderItem,
  updateOrderItem,
  deleteOrderItem,
  getOrderItem,
} = require('../../controllers/shared/orderItemController');
const router = express.Router();

router.route('/').get(getAllOrderItem).post(createOrderItem);
router
  .route('/:id')
  .get(getOrderItem)
  .patch(updateOrderItem)
  .delete(deleteOrderItem);

module.exports = router;
