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
  sendOrderDetailEmail,
  validateCart, } = require('../../controllers/shared/orderController');
const {
  updateOrderStatus,
  updateDriverLocation,
  getOrderTracking,
  getOrderByTrackingNumber,
  addTrackingUpdate,
} = require('../../controllers/shared/orderTrackingController');
const { requestRefund, getRefundStatus } = require('../../controllers/buyer/refundController');

const authController = require('../../controllers/buyer/authController');
const { validateObjectId } = require('../../middleware/validateObjectId');
// SECURITY FIX #5: Input validation for orders
const { validateOrder, handleValidationErrors } = require('../../middleware/validation/orderValidator');

const router = express.Router();

router
  .route('/')
  .get(authController.protect, authController.restrictTo('admin'), getAllOrder)
  // SECURITY FIX #5: Add input validation middleware before order creation
  .post(
    authController.protect,
    authController.restrictTo('user'),
    validateOrder,
    handleValidationErrors,
    createOrder
  );

router.get('/get/totalsales', authController.protect, totalSales);
router.get('/get/count', authController.protect, getCount);
// router.get('/get/userorders', authController.protect, getUserOrder);

// Cart validation endpoint (must be before /:id route)
router.post(
  '/validate-cart',
  authController.protect,
  authController.restrictTo('user'),
  validateCart
);

const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');

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
  validateObjectId('id'), // SECURITY FIX #6
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
  .get(
    authController.protect,
    authController.restrictTo('user'),
    validateObjectId('id'), // SECURITY FIX #6
    getUserOrder
  );

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

// Admin payment confirmation route (must be before /:id route)
router.patch(
  '/:orderId/confirm-payment',
  authController.protect,
  authController.restrictTo('admin'),
  require('../../controllers/admin/orderController').confirmPayment
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
