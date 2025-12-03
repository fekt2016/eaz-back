const express = require('express');
const adminController = require('../../controllers/admin/adminController');
const authAdminController = require('../../controllers/admin/authAdminController');
const shippingConfigController = require('../../controllers/admin/shippingConfigController');
const sellerController = require('../../controllers/admin/sellerController');
const statsController = require('../../controllers/admin/statsController');
const taxController = require('../../controllers/admin/taxController');
const platformSettingsController = require('../../controllers/admin/platformSettingsController');
const adminAuditLogController = require('../../controllers/admin/adminAuditLogController');
const analyticsController = require('../../controllers/admin/analyticsController');
const sessionManagementController = require('../../controllers/admin/sessionManagementController');
const historyController = require('../../controllers/admin/historyController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

router.post('/signup', authAdminController.signupAdmin);
router.post('/login', authAdminController.adminLogin);
router.post('/forgotPassword', authAdminController.forgetPassword);
router.patch('/resetPassword/:token', authAdminController.resetPassword);

router.use(authController.protect, authController.restrictTo('admin'));

router.post('/user/signup', authAdminController.signupUser);
router.post(
  '/seller/signup',
  authController.protect,
  authAdminController.sigupSeller,
);
router.get(
  '/me',
  authController.protect,
  authController.restrictTo('admin'),
  adminController.getMe,
);
router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    adminController.getAllAdmins,
  );

// Platform Statistics Routes - MUST come before /:id route
router
  .route('/stats')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    statsController.getPlatformStats
  );

// Tax/VAT Routes
router
  .route('/tax/vat-summary')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    taxController.getVATSummary
  );

router
  .route('/tax/unremitted')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    taxController.getUnremittedVAT
  );

router
  .route('/tax/rates')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    taxController.getTaxRates
  );

router
  .route('/tax/withholding')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    taxController.getWithholdingTax
  );

router
  .route('/tax/mark-remitted')
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    taxController.markTaxRemitted
  );

// Platform Settings Routes
router
  .route('/settings/platform')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    platformSettingsController.getPlatformSettings
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    platformSettingsController.updatePlatformSettings
  );

router
  .route('/settings/audit-logs')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    platformSettingsController.getAuditLogs
  );

router
  .route('/stats/reset-revenue')
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    statsController.resetRevenue
  );

router
  .route('/stats/reset-revenue-only')
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    statsController.resetRevenueOnly
  );

// Device Session Management Routes - MUST come before /:id route
router
  .route('/sessions')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sessionManagementController.getAllSessions
  );

router
  .route('/sessions/suspicious')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sessionManagementController.getSuspiciousLogins
  );

router
  .route('/sessions/cleanup-logs')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sessionManagementController.getCleanupLogs
  );

router
  .route('/sessions/logout-device/:deviceId')
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sessionManagementController.forceLogoutDevice
  );

router
  .route('/sessions/user/:userId')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sessionManagementController.getUserSessions
  );

router
  .route('/sessions/logout-user/:userId')
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sessionManagementController.forceLogoutUser
  );

// Admin Audit Logs Routes - MUST come before /:id route
router
  .route('/audit-logs')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    adminAuditLogController.getAdminAuditLogs
  );

router
  .route('/audit-logs/stats')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    adminAuditLogController.getAuditStats
  );

router
  .route('/audit-logs/clear')
  .put(
    authController.protect,
    authController.restrictTo('superadmin'),
    adminAuditLogController.clearAuditLogs
  );

router
  .route('/audit-logs/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    adminAuditLogController.getAdminAuditLog
  );

// Shipping Configuration Routes
router
  .route('/shipping-config')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    shippingConfigController.getShippingConfig
  )
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    shippingConfigController.createShippingConfig
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    shippingConfigController.updateShippingConfig
  );

// Seller Management Routes
router
  .route('/seller/:id/balance')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    sellerController.getSellerBalance
  );

router
  .route('/seller/:id/reset-balance')
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    sellerController.resetSellerBalance
  );

router
  .route('/seller/:id/reset-locked-balance')
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    sellerController.resetLockedBalance
  );

router
  .route('/seller/:id/lock-funds')
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    sellerController.lockSellerFunds
  );

router
  .route('/seller/:id/unlock-funds')
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    sellerController.unlockSellerFunds
  );

// Analytics Routes
router
  .route('/analytics/kpi')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getKPICards
  );

router
  .route('/analytics/revenue')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getRevenueAnalytics
  );

router
  .route('/analytics/orders')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getOrdersAnalytics
  );

router
  .route('/analytics/sellers/top')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getTopSellers
  );

router
  .route('/analytics/products/top')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getTopProducts
  );

router
  .route('/analytics/customers')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getCustomerAnalytics
  );

router
  .route('/analytics/order-status')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getOrderStatusAnalytics
  );

router
  .route('/analytics/tax')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getTaxAnalytics
  );

router
  .route('/analytics/traffic')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getTrafficAnalytics
  );

router
  .route('/analytics/carts')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getCartAnalytics
  );

router
  .route('/analytics/fraud')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getFraudAnalytics
  );

router
  .route('/analytics/inventory')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    analyticsController.getInventoryAnalytics
  );

// Balance History Management Routes
router
  .route('/wallet-history')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    historyController.getAllWalletHistory
  );

router
  .route('/wallet-history/:userId')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    historyController.getUserWalletHistory
  );

router
  .route('/revenue-history')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    historyController.getAllSellerRevenueHistory
  );

router
  .route('/revenue-history/:sellerId')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    historyController.getSellerRevenueHistory
  );

router
  .route('/history/stats')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    historyController.getHistoryStats
  );

// Generic /:id route - MUST be last to avoid matching specific routes like /wallet-history
// This route handles GET, PATCH, DELETE for individual admin records
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    adminController.getAdmin,
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    adminController.updateAdmin,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin'),
    adminController.deleteAdmin,
  );

module.exports = router;
