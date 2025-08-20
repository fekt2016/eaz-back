const express = require('express');
const {
  getAllOrder,
  createOrder,
  getOrder,
  deleteOrder,
  updateOrder,
  totalSales,
  getCount,
  getUserOrders,
  getUserOrder,
  OrderDeleteOrderItem,
  getSellerOrders,
  getOrderBySeller,
} = require('../Controllers/orderController');

const authController = require('../Controllers/authController');

const router = express.Router();

router
  .route('/')
  .get(authController.protect, authController.restrictTo('admin'), getAllOrder)
  .post(authController.protect, authController.restrictTo('user'), createOrder);

router.get('/get/totalsales', authController.protect, totalSales);
router.get('/get/count', authController.protect, getCount);
// router.get('/get/userorders', authController.protect, getUserOrder);

router
  .route('/get-seller-orders')
  .get(
    authController.protect,
    authController.restrictTo('seller'),
    getSellerOrders,
  );
router.get(
  '/seller-order/:id',
  authController.protect,
  authController.restrictTo('seller'),
  getOrderBySeller,
);
router
  .route('/get-user-orders')
  .get(
    authController.protect,
    authController.restrictTo('user'),
    getUserOrders,
  );
router
  .route('/get-user-order/:id')
  .get(authController.protect, authController.restrictTo('user'), getUserOrder);

router
  .route('/:id')
  .get(authController.protect, authController.restrictTo('admin'), getOrder)
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    updateOrder,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'admin'),
    OrderDeleteOrderItem,
    deleteOrder,
  );

module.exports = router;
