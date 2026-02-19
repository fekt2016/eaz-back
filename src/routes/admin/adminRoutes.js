const express = require('express');
const adminController = require('../../controllers/admin/adminController');
const authAdminController = require('../../controllers/admin/authAdminController');
const shippingConfigController = require('../../controllers/admin/shippingConfigController');
const sellerController = require('../../controllers/admin/sellerController');
const payoutVerificationController = require('../../controllers/admin/payoutVerificationController');
const statsController = require('../../controllers/admin/statsController');
const taxController = require('../../controllers/admin/taxController');
const platformSettingsController = require('../../controllers/admin/platformSettingsController');
const internationalShippingController = require('../../controllers/admin/internationalShippingController');
const internationalShippingManagementController = require('../../controllers/admin/internationalShippingManagementController');
const adminAuditLogController = require('../../controllers/admin/adminAuditLogController');
const analyticsController = require('../../controllers/admin/analyticsController');
const sessionManagementController = require('../../controllers/admin/sessionManagementController');
const historyController = require('../../controllers/admin/historyController');
const productController = require('../../controllers/admin/productController');
const authController = require('../../controllers/buyer/authController');
const { updateOrderStatus } = require('../../controllers/shared/orderTrackingController');
const { deleteOrder } = require('../../controllers/shared/orderController');
const { validateObjectId } = require('../../middleware/validateObjectId');
const { resetLimiter } = require('../../middleware/rateLimiting/otpLimiter');

const router = express.Router();

router.post('/signup', authAdminController.signupAdmin);
router.post('/register', authAdminController.signupAdmin); // Alias for frontend compatibility
router.post('/login', authAdminController.adminLogin);

// ==================================================
// UNIFIED EMAIL-ONLY PASSWORD RESET FLOW
// ==================================================
// New unified endpoints (email-only, token-based)
router.post('/forgot-password', resetLimiter, authAdminController.requestPasswordReset);
router.post('/reset-password', resetLimiter, authAdminController.resetPasswordWithToken);

// Legacy endpoints (kept for backward compatibility)
router.post('/forgotPassword', resetLimiter, authAdminController.forgetPassword);
router.patch('/resetPassword/:token', authAdminController.resetPassword);

router.use(authController.protect, authController.restrictTo('admin', 'superadmin'));

// Admin-only order tracking/status update (avoid buyer-route auth ambiguity)
router.post(
  '/orders/:orderId/status',
  validateObjectId('orderId'),
  updateOrderStatus
);

// Admin-only hard delete for orders (unpaid orders only in UI; backend still
// performs full backup + revenue reversal logic in shared deleteOrder).
// IMPORTANT: use ':id' so shared deleteOrder (which reads req.params.id)
// sees the correct value.
router.delete(
  '/orders/:id',
  validateObjectId('id'),
  deleteOrder
);

router.post('/user/signup', authAdminController.signupUser);
router.post(
  '/seller/signup',
  authController.protect,
  authAdminController.sigupSeller,
);
router.get(
  '/me',
  authController.protect,
  authController.restrictTo('admin', 'superadmin', 'moderator'),
  adminController.getMe,
);
router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    adminController.getAllAdmins,
  );

// Platform Statistics Routes - MUST come before /:id route
router
  .route('/stats')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    statsController.getPlatformStats
  );

// Tax/VAT Routes
router
  .route('/tax/vat-summary')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    taxController.getVATSummary
  );

router
  .route('/tax/unremitted')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    taxController.getUnremittedVAT
  );

router
  .route('/tax/rates')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    taxController.getTaxRates
  );

router
  .route('/tax/withholding')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    taxController.getWithholdingTax
  );

router
  .route('/tax/mark-remitted')
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    taxController.markTaxRemitted
  );

// Platform Settings Routes
router
  .route('/settings/platform')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    platformSettingsController.getPlatformSettings
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    platformSettingsController.updatePlatformSettings
  );

router
  .route('/settings/audit-logs')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    platformSettingsController.getAuditLogs
  );

router
  .route('/stats/reset-revenue')
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    statsController.resetRevenue
  );

router
  .route('/stats/reset-revenue-only')
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
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
    authController.restrictTo('admin', 'superadmin'),
    shippingConfigController.getShippingConfig
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    shippingConfigController.createShippingConfig
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    shippingConfigController.updateShippingConfig
  );

// International shipping (read-only matrix for admin UI)
router.get(
  '/international-shipping/matrix',
  authController.protect,
  authController.restrictTo('admin', 'superadmin'),
  internationalShippingController.getInternationalShippingMatrix,
);

// International Shipping Management (CRUD for configs and duty by category)
router
  .route('/international-shipping/configs')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.getInternationalShippingConfigs
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.createInternationalShippingConfig
  );

router
  .route('/international-shipping/configs/:country')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.getInternationalShippingConfigByCountry
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.updateInternationalShippingConfig
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.deleteInternationalShippingConfig
  );

router
  .route('/international-shipping/duty-by-category')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.getImportDutyByCategory
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.createImportDutyByCategory
  );

router
  .route('/international-shipping/duty-by-category/:id')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.updateImportDutyByCategory
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    internationalShippingManagementController.deleteImportDutyByCategory
  );

// Seller Management Routes
router
  .route('/seller/:id/balance')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sellerController.getSellerBalance
  );

router
  .route('/seller/:id/reset-balance')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sellerController.resetSellerBalance
  );

router
  .route('/seller/:id/reset-locked-balance')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sellerController.resetLockedBalance
  );

router
  .route('/seller/:id/lock-funds')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sellerController.lockSellerFunds
  );

router
  .route('/seller/:id/unlock-funds')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    sellerController.unlockSellerFunds
  );

// Payout Verification Routes (SEPARATED from Document Verification)
router
  .route('/sellers/:id/payout')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    payoutVerificationController.getPayoutVerificationDetails
  );

router
  .route('/sellers/:id/payout/approve')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    payoutVerificationController.approvePayoutVerification
  );

router
  .route('/sellers/:id/payout/reject')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    payoutVerificationController.rejectPayoutVerification
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
    authController.restrictTo('admin', 'superadmin'),
    historyController.getAllWalletHistory
  );

router
  .route('/wallet-history/:userId')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    historyController.getUserWalletHistory
  );

router
  .route('/revenue-history')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    historyController.getAllSellerRevenueHistory
  );

router
  .route('/revenue-history/:sellerId')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    historyController.getSellerRevenueHistory
  );

// Admin view of all seller transactions (credits/debits)
router
  .route('/transactions')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    historyController.getAllSellerTransactions
  );

router
  .route('/history/stats')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    historyController.getHistoryStats
  );

// Product Moderation Routes - MUST come before /:id route
router
  .route('/products/pending')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    productController.getPendingProducts
  );

router
  .route('/products/update-visibility')
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    productController.updateAllProductsVisibility
  );

router
  .route('/products/fix-approved-visibility')
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    productController.fixApprovedProductsVisibility
  );

router
  .route('/products/:id/approve')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    productController.approveProduct
  );

router
  .route('/products/:id/reject')
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    productController.rejectProduct
  );

router
  .route('/products/:productId')
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    productController.removeProduct
  );

// Generic /:id route - MUST be last to avoid matching specific routes like /wallet-history
// This route handles GET, PATCH, DELETE for individual admin records
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    adminController.getAdmin,
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    adminController.updateAdmin,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin'),
    adminController.deleteAdmin,
  );

module.exports = router;
