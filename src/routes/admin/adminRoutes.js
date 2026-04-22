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
const { ALL_ADMIN_ROLES, OPS_ROLES, SUPERADMIN_ONLY } = require('../../config/rolePermissions');
const { updateOrderStatus } = require('../../controllers/shared/orderTrackingController');
const { deleteOrder } = require('../../controllers/shared/orderController');
const { validateObjectId } = require('../../middleware/validateObjectId');
const { resetLimiter } = require('../../middleware/rateLimiting/otpLimiter');

const router = express.Router();

router.post('/signup', authAdminController.signupAdmin);
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

router.use(authController.protect);

// Superadmin creates another admin (records `createdBy`; does not replace current session)
router.post(
  '/register',
  authController.restrictTo(...SUPERADMIN_ONLY),
  authAdminController.createAdminBySuperadmin,
);

// Admin-only order tracking/status update (avoid buyer-route auth ambiguity)
router.post(
  '/orders/:orderId/status',
  validateObjectId('orderId'),
  authController.restrictTo(...OPS_ROLES),
  updateOrderStatus
);

// Admin-only hard delete for orders (unpaid orders only in UI; backend still
// performs full backup + revenue reversal logic in shared deleteOrder).
// IMPORTANT: use ':id' so shared deleteOrder (which reads req.params.id)
// sees the correct value.
router.delete(
  '/orders/:id',
  validateObjectId('id'),
  authController.restrictTo(...OPS_ROLES),
  deleteOrder
);

router.post(
  '/user/signup',
  authController.restrictTo(...OPS_ROLES),
  authAdminController.signupUser,
);
router.post(
  '/seller/signup',
  authController.restrictTo(...OPS_ROLES),
  authAdminController.sigupSeller,
);
router.get(
  '/me',
  authController.restrictTo(...ALL_ADMIN_ROLES),
  adminController.getMe,
);
router.patch(
  '/me/password',
  authController.restrictTo(...ALL_ADMIN_ROLES),
  authAdminController.updateMyPassword,
);
router.get(
  '/me/activity-analytics',
  authController.restrictTo(...OPS_ROLES),
  adminController.getMyActivityAnalytics,
);
router
  .route('/')
  .get(
    authController.restrictTo(...SUPERADMIN_ONLY),
    adminController.getAllAdmins,
  );

// Platform Statistics Routes - MUST come before /:id route
router
  .route('/stats')
  .get(
    authController.restrictTo(...OPS_ROLES),
    statsController.getPlatformStats
  );

// Tax/VAT Routes
router
  .route('/tax/vat-summary')
  .get(
    authController.restrictTo(...OPS_ROLES),
    taxController.getVATSummary
  );

router
  .route('/tax/unremitted')
  .get(
    authController.restrictTo(...OPS_ROLES),
    taxController.getUnremittedVAT
  );

router
  .route('/tax/rates')
  .get(
    authController.restrictTo(...OPS_ROLES),
    taxController.getTaxRates
  );

router
  .route('/tax/withholding')
  .get(
    authController.restrictTo(...OPS_ROLES),
    taxController.getWithholdingTax
  );

router
  .route('/tax/mark-remitted')
  .post(
    authController.restrictTo(...OPS_ROLES),
    taxController.markTaxRemitted
  );

// Platform Settings Routes
router
  .route('/settings/platform')
  .get(
    authController.restrictTo(...OPS_ROLES),
    platformSettingsController.getPlatformSettings
  )
  .patch(
    authController.restrictTo(...OPS_ROLES),
    platformSettingsController.updatePlatformSettings
  );

router
  .route('/settings/audit-logs')
  .get(
    authController.restrictTo(...OPS_ROLES),
    platformSettingsController.getAuditLogs
  );

router
  .route('/stats/reset-revenue')
  .post(
    authController.restrictTo(...SUPERADMIN_ONLY),
    statsController.resetRevenue
  );

router
  .route('/stats/reset-revenue-only')
  .post(
    authController.restrictTo(...SUPERADMIN_ONLY),
    statsController.resetRevenueOnly
  );

// Device Session Management Routes - MUST come before /:id route
router
  .route('/sessions')
  .get(
    authController.restrictTo(...OPS_ROLES),
    sessionManagementController.getAllSessions
  );

router
  .route('/sessions/suspicious')
  .get(
    authController.restrictTo(...OPS_ROLES),
    sessionManagementController.getSuspiciousLogins
  );

router
  .route('/sessions/cleanup-logs')
  .get(
    authController.restrictTo(...OPS_ROLES),
    sessionManagementController.getCleanupLogs
  );

router
  .route('/sessions/logout-device/:deviceId')
  .delete(
    authController.restrictTo(...OPS_ROLES),
    sessionManagementController.forceLogoutDevice
  );

router
  .route('/sessions/user/:userId')
  .get(
    authController.restrictTo(...OPS_ROLES),
    sessionManagementController.getUserSessions
  );

router
  .route('/sessions/logout-user/:userId')
  .delete(
    authController.restrictTo(...OPS_ROLES),
    sessionManagementController.forceLogoutUser
  );

// Admin Audit Logs Routes - MUST come before /:id route
router
  .route('/audit-logs')
  .get(
    authController.restrictTo(...OPS_ROLES),
    adminAuditLogController.getAdminAuditLogs
  );

router
  .route('/audit-logs/stats')
  .get(
    authController.restrictTo(...OPS_ROLES),
    adminAuditLogController.getAuditStats
  );

router
  .route('/audit-logs/clear')
  .put(
    authController.restrictTo(...SUPERADMIN_ONLY),
    adminAuditLogController.clearAuditLogs
  );

router
  .route('/audit-logs/:id')
  .get(
    authController.restrictTo(...OPS_ROLES),
    adminAuditLogController.getAdminAuditLog
  );

// Shipping Configuration Routes
router
  .route('/shipping-config')
  .get(
    authController.restrictTo(...OPS_ROLES),
    shippingConfigController.getShippingConfig
  )
  .post(
    authController.restrictTo(...SUPERADMIN_ONLY),
    shippingConfigController.createShippingConfig
  )
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    shippingConfigController.updateShippingConfig
  );

// International shipping (read-only matrix for admin UI)
router.get(
  '/international-shipping/matrix',
  authController.restrictTo(...SUPERADMIN_ONLY),
  internationalShippingController.getInternationalShippingMatrix,
);

// International Shipping Management (CRUD for configs and duty by category)
router
  .route('/international-shipping/configs')
  .get(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.getInternationalShippingConfigs
  )
  .post(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.createInternationalShippingConfig
  );

router
  .route('/international-shipping/configs/:country')
  .get(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.getInternationalShippingConfigByCountry
  )
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.updateInternationalShippingConfig
  )
  .delete(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.deleteInternationalShippingConfig
  );

router
  .route('/international-shipping/duty-by-category')
  .get(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.getImportDutyByCategory
  )
  .post(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.createImportDutyByCategory
  );

router
  .route('/international-shipping/duty-by-category/:id')
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.updateImportDutyByCategory
  )
  .delete(
    authController.restrictTo(...SUPERADMIN_ONLY),
    internationalShippingManagementController.deleteImportDutyByCategory
  );

// Seller Management Routes
router
  .route('/seller/:id/balance')
  .get(
    authController.restrictTo(...OPS_ROLES),
    sellerController.getSellerBalance
  );

router
  .route('/seller/:id/reset-balance')
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    sellerController.resetSellerBalance
  );

router
  .route('/seller/:id/reset-locked-balance')
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    sellerController.resetLockedBalance
  );

router
  .route('/seller/:id/lock-funds')
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    sellerController.lockSellerFunds
  );

router
  .route('/seller/:id/unlock-funds')
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    sellerController.unlockSellerFunds
  );

// Payout Verification Routes (SEPARATED from Document Verification)
router
  .route('/sellers/:id/payout')
  .get(
    authController.restrictTo(...OPS_ROLES),
    payoutVerificationController.getPayoutVerificationDetails
  );

router
  .route('/sellers/:id/payout/approve')
  .patch(
    authController.restrictTo(...OPS_ROLES),
    payoutVerificationController.approvePayoutVerification
  );

router
  .route('/sellers/:id/payout/reject')
  .patch(
    authController.restrictTo(...OPS_ROLES),
    payoutVerificationController.rejectPayoutVerification
  );

// Analytics Routes
router
  .route('/analytics/kpi')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getKPICards
  );

router
  .route('/analytics/revenue')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getRevenueAnalytics
  );

router
  .route('/analytics/orders')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getOrdersAnalytics
  );

router
  .route('/analytics/sellers/top')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getTopSellers
  );

router
  .route('/analytics/products/top')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getTopProducts
  );

router
  .route('/analytics/customers')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getCustomerAnalytics
  );

router
  .route('/analytics/order-status')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getOrderStatusAnalytics
  );

router
  .route('/analytics/tax')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getTaxAnalytics
  );

router
  .route('/analytics/traffic')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getTrafficAnalytics
  );

router
  .route('/analytics/carts')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getCartAnalytics
  );

router
  .route('/analytics/fraud')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getFraudAnalytics
  );

router
  .route('/analytics/inventory')
  .get(
    authController.restrictTo(...OPS_ROLES),
    analyticsController.getInventoryAnalytics
  );

// Balance History Management Routes
router
  .route('/wallet-history')
  .get(
    authController.restrictTo(...OPS_ROLES),
    historyController.getAllWalletHistory
  );

router
  .route('/wallet-history/:userId')
  .get(
    authController.restrictTo(...OPS_ROLES),
    historyController.getUserWalletHistory
  );

router
  .route('/revenue-history')
  .get(
    authController.restrictTo(...OPS_ROLES),
    historyController.getAllSellerRevenueHistory
  );

router
  .route('/revenue-history/:sellerId')
  .get(
    authController.restrictTo(...OPS_ROLES),
    historyController.getSellerRevenueHistory
  );

// Admin view of all seller transactions (credits/debits)
router
  .route('/transactions')
  .get(
    authController.restrictTo(...OPS_ROLES),
    historyController.getAllSellerTransactions
  );

router
  .route('/history/stats')
  .get(
    authController.restrictTo(...OPS_ROLES),
    historyController.getHistoryStats
  );

// Product Moderation Routes - MUST come before /:id route
router
  .route('/products/pending')
  .get(
    authController.restrictTo(...OPS_ROLES),
    productController.getPendingProducts
  );

router
  .route('/products/update-visibility')
  .post(
    authController.restrictTo(...OPS_ROLES),
    productController.updateAllProductsVisibility
  );

router
  .route('/products/fix-approved-visibility')
  .post(
    authController.restrictTo(...OPS_ROLES),
    productController.fixApprovedProductsVisibility
  );

router
  .route('/products/:id/approve')
  .patch(
    authController.restrictTo(...OPS_ROLES),
    productController.approveProduct
  );

router
  .route('/products/:id/reject')
  .patch(
    authController.restrictTo(...OPS_ROLES),
    productController.rejectProduct
  );

router
  .route('/products/:productId')
  .delete(
    authController.restrictTo(...OPS_ROLES),
    productController.removeProduct
  );

// Generic /:id route - MUST be last to avoid matching specific routes like /wallet-history
// This route handles GET, PATCH, DELETE for individual admin records
router
  .route('/:id')
  .get(
    authController.restrictTo(...SUPERADMIN_ONLY),
    adminController.getAdmin,
  )
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    adminController.updateAdmin,
  )
  .delete(
    authController.restrictTo(...SUPERADMIN_ONLY),
    adminController.deleteAdmin,
  );

module.exports = router;
