const express = require('express');
const { getAllOrder,
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
  updateOrderShippingAddress,
  updateOrderAddressAndRecalculate,
  payShippingDifference,
  sendOrderDetailEmail, } = require('../../controllers/shared/orderController');
const {
  updateOrderStatus,
  updateDriverLocation,
  getOrderTracking,
  getOrderByTrackingNumber,
  addTrackingUpdate,
} = require('../../controllers/shared/orderTrackingController');
const { requestRefund, getRefundStatus } = require('../../controllers/buyer/refundController');

const authController = require('../../controllers/buyer/authController');

const router = express.Router();

router
  .route('/')
  .get(authController.protect, authController.restrictTo('admin'), getAllOrder)
  .post(authController.protect, authController.restrictTo('user'), createOrder);

router.get('/get/totalsales', authController.protect, totalSales);
router.get('/get/count', authController.protect, getCount);
// router.get('/get/userorders', authController.protect, getUserOrder);

const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');

router
  .route('/get-seller-orders')
  .get(
    authController.protect,
    authController.restrictTo('seller'),
    requireVerifiedSeller,
    getSellerOrders,
  );
router.get(
  '/seller-order/:id',
  authController.protect,
  authController.restrictTo('seller'),
  requireVerifiedSeller,
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

// Update order shipping address (user only, within 24 hours)
// Must be before /:id route to avoid route conflicts
router.patch(
  '/:id/shipping-address',
  authController.protect,
  authController.restrictTo('user'),
  updateOrderShippingAddress
);

// Update order address and recalculate shipping
router.patch(
  '/:orderId/update-address',
  authController.protect,
  authController.restrictTo('user'),
  updateOrderAddressAndRecalculate
);

// Pay shipping difference
router.post(
  '/:orderId/pay-shipping-difference',
  authController.protect,
  authController.restrictTo('user'),
  payShippingDifference
);

// Send order detail email
router.post(
  '/:orderId/send-email',
  authController.protect,
  authController.restrictTo('user'),
  sendOrderDetailEmail
);

// Order Tracking Routes
router.post(
  '/:orderId/status',
  authController.protect,
  authController.restrictTo('admin', 'seller'),
  updateOrderStatus
);

router.patch(
  '/:orderId/driver-location',
  authController.protect,
  updateDriverLocation
);

router.get(
  '/:orderId/tracking',
  authController.protect,
  getOrderTracking
);

// Public tracking by tracking number (no auth required)
router.get(
  '/track/:trackingNumber',
  getOrderByTrackingNumber
);

// Add tracking update (admin/seller only)
router.post(
  '/:id/tracking',
  authController.protect,
  authController.restrictTo('admin', 'seller'),
  addTrackingUpdate
);

// Refund Request Routes (buyer only)
router.post(
  '/:orderId/request-refund',
  authController.protect,
  authController.restrictTo('user'),
  requestRefund
);

router.get(
  '/:orderId/refund-status',
  authController.protect,
  authController.restrictTo('user'),
  getRefundStatus
);

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

module.exports = router;;
