const express = require('express');
const sellerControllor = require('../../controllers/seller/sellerController');
const authSellerController = require('../../controllers/seller/authSellerController');
const onboardingController = require('../../controllers/seller/onboardingController');
const balanceController = require('../../controllers/seller/balanceController');
const sellerAnalyticsController = require('../../controllers/seller/sellerAnalyticsController');
const sellerRefundController = require('../../controllers/seller/refundController');
const pickupLocationController = require('../../controllers/seller/pickupLocationController');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');

const authController = require('../../controllers/buyer/authController');
const { resizeImage, uploadProfileImage } = require('../../middleware/upload/multer');

const { otpLimiter, resetLimiter } = require('../../middleware/rateLimiting/otpLimiter');

const router = express.Router();
router.post('/signup', authSellerController.signupSeller);
router.post('/login', authSellerController.loginSeller);
router.post('/send-otp', otpLimiter, authSellerController.sendOtp);
// SECURITY FIX #4: Add OTP lockout protection
const { checkOtpLockout } = require('../../middleware/security/otpVerificationSecurity');
router.post('/verify-otp', otpLimiter, checkOtpLockout, authSellerController.verifyOtp); // ✅ Rate limiting + lockout
router.post('/verify-account', otpLimiter, authSellerController.verifyEmail); // ✅ New account verification endpoint
router.post('/resend-otp', otpLimiter, authSellerController.resendOtp); // ✅ New resend OTP endpoint
// ==================================================
// UNIFIED EMAIL-ONLY PASSWORD RESET FLOW
// ==================================================
// New unified endpoints (email-only, token-based)
router.post('/forgot-password', resetLimiter, authSellerController.requestPasswordReset);
router.post('/reset-password', resetLimiter, authSellerController.resetPasswordWithToken);

// Legacy endpoints (kept for backward compatibility)
router.post('/forgotPassword', resetLimiter, authSellerController.forgotPassword);
router.patch('/resetPassword/:token', authSellerController.resetPassword);
router.post('/logout', authSellerController.logout);

router.route('/public/featured').get(sellerControllor.getFeaturedSellers);
router.route('/public/best-sellers').get(sellerControllor.getBestSellers);
router.route('/public/:id').get(sellerControllor.getPublicSeller);
router.route('/profile/:id').get(sellerControllor.getSeller);

// 🔒 CRITICAL: Admin-only routes must be defined BEFORE protectSeller middleware
// Admin routes use admin_jwt/main_jwt, not seller_jwt
// These routes allow admins to view all sellers
router
  .route('/')
  .get(
    authController.protect, // Use standard protect (accepts admin_jwt/main_jwt)
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    sellerControllor.getAllSeller
  );

// Admin-only route to get or update a specific seller by ID
// IMPORTANT: This must be defined BEFORE protectSeller AND before /me route
// This route allows admins to view any seller by ID (not by /me)
// CRITICAL: Must exclude 'me' and 'status' from matching to prevent route conflicts
router
  .route('/:id')
  .get(
    (req, res, next) => {
      // Exclude 'me' and 'status' from matching this route
      if (req.params.id === 'me' || req.params.id === 'status') {
        return next('route'); // Skip to next route handler
      }
      next();
    },
    authController.protect, // Use standard protect for admin access
    authController.restrictTo('admin', 'superadmin', 'moderator'),
    sellerControllor.getSeller
  )
  .patch(
    (req, res, next) => {
      // Exclude 'me' and 'status' from matching this route
      if (req.params.id === 'me' || req.params.id === 'status') {
        return next('route'); // Skip to next route handler
      }
      next();
    },
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    sellerControllor.updateSeller
  );

// Admin: Approve/Reject seller verification and update individual document status.
// IMPORTANT: These MUST be defined BEFORE protectSeller so they work with admin_jwt/main_jwt.
router.patch(
  '/:id/approve-verification',
  authController.protect,
  authController.restrictTo('admin', 'superadmin', 'moderator'),
  onboardingController.approveSellerVerification
);
router.patch(
  '/:id/reject-verification',
  authController.protect,
  authController.restrictTo('admin', 'superadmin', 'moderator'),
  onboardingController.rejectSellerVerification
);
router.patch(
  '/:id/document-status',
  authController.protect,
  authController.restrictTo('admin', 'superadmin', 'moderator'),
  onboardingController.updateDocumentStatus
);

// 🔒 CRITICAL: Use protectSeller for seller-specific routes
// This ensures seller routes use seller_jwt cookie, not main_jwt
router.use(authSellerController.protectSeller);
router.use(authController.restrictTo('seller', 'admin', 'superadmin', 'moderator')); // restrictTo is safe to use (just checks role)

// ✅ CRITICAL: /me route MUST be defined here (after protectSeller)
// This ensures sellers can access their own profile using seller_jwt cookie
router.get(
  '/me',
  sellerControllor.getMe,
  sellerControllor.getSeller,
);

// Onboarding routes (protected, but don't require verification)
router.get(
  '/status',
  onboardingController.getOnboardingStatus
);

router
  .route('/me/products')
  .get(sellerControllor.getSellerProducts);
router
  .route('/me/products/:productId')
  .get(sellerControllor.getSellerProductById)
  .delete(sellerControllor.SellerDeleteProduct);

// Admin-only routes - must come AFTER specific routes
router.patch(
  '/update-onboarding',
  onboardingController.updateOnboarding
);

// Verification routes (protected, but don't require verification)
router.post(
  '/send-verification-email',
  authController.restrictTo('seller'),
  otpLimiter,
  authSellerController.sendEmailVerificationOtp
);
router.post(
  '/verify-email',
  authController.restrictTo('seller'),
  otpLimiter,
  authSellerController.verifyEmail
);

// Two-Factor Authentication routes
router.post(
  '/enable-2fa',
  authController.restrictTo('seller'),
  authSellerController.enableTwoFactor
);
router.get(
  '/2fa/setup',
  authController.restrictTo('seller'),
  authSellerController.getTwoFactorSetup
);
router.post(
  '/verify-2fa',
  authController.restrictTo('seller'),
  authSellerController.verifyTwoFactor
);
router.post(
  '/disable-2fa',
  authController.restrictTo('seller'),
  authSellerController.disableTwoFactor
);
router.get(
  '/2fa/backup-codes',
  authController.restrictTo('seller'),
  authSellerController.getBackupCodes
);
router.post(
  '/2fa/regenerate-backup-codes',
  authController.restrictTo('seller'),
  authSellerController.regenerateBackupCodes
);

// Password management
router.patch(
  '/me/update-password',
  authController.restrictTo('seller'),
  authSellerController.updatePassword
);

// Session management
router.get(
  '/me/sessions',
  authController.restrictTo('seller'),
  authSellerController.getSessions
);
router.delete(
  '/me/sessions/:sessionId',
  authController.restrictTo('seller'),
  authSellerController.revokeSession
);
router.delete(
  '/me/sessions',
  authController.restrictTo('seller'),
  authSellerController.revokeAllOtherSessions
);

// Notification preferences
router.get(
  '/me/notification-settings',
  authController.restrictTo('seller'),
  authSellerController.getNotificationSettings
);
router.patch(
  '/me/notification-settings',
  authController.restrictTo('seller'),
  authSellerController.updateNotificationSettings
);

// Activity logs - sellers can view their own activity
router.get(
  '/me/activity-logs',
  authController.restrictTo('seller'),
  (req, res, next) => {
    // Set userId to current seller's ID
    req.query.userId = req.user.id;
    req.query.role = 'seller';
    // Import and use the activity log controller
    const activityLogController = require('../../modules/activityLog/activityLog.controller');
    return activityLogController.getActivityLogs(req, res, next);
  }
);


// Seller balance and transactions routes
router.get(
  '/me/balance',
  authController.restrictTo('seller'),
  balanceController.getSellerBalance
);
router.get(
  '/me/transactions',
  authController.restrictTo('seller'),
  balanceController.getSellerTransactions
);
router.get(
  '/me/revenue-history',
  authController.restrictTo('seller'),
  balanceController.getSellerRevenueHistory
);
router.get(
  '/me/balance-history',
  authController.restrictTo('seller'),
  balanceController.getSellerRevenueHistory
); // Alias for revenue-history
router.get(
  '/me/earnings',
  authController.restrictTo('seller'),
  balanceController.getSellerEarnings
);
router.get(
  '/me/earnings/order/:orderId',
  authController.restrictTo('seller'),
  balanceController.getSellerEarningsByOrder
);

// Seller Analytics Routes
router.get(
  '/analytics/kpi',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerKPICards
);

router.get(
  '/analytics/revenue',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerRevenueAnalytics
);

router.get(
  '/analytics/orders/status',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerOrderStatusAnalytics
);

router.get(
  '/analytics/products/top',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerTopProducts
);

router.get(
  '/analytics/traffic',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerTrafficAnalytics
);

router.get(
  '/analytics/payouts',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerPayoutAnalytics
);

router.get(
  '/analytics/tax',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerTaxAnalytics
);

router.get(
  '/analytics/inventory',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerInventoryAnalytics
);

router.get(
  '/analytics/refunds',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerRefundAnalytics
);

router.get(
  '/analytics/performance',
  authController.restrictTo('seller'),
  sellerAnalyticsController.getSellerPerformanceScore
);

// Seller Refund Review Routes
router.get(
  '/refunds',
  authController.restrictTo('seller'),
  sellerRefundController.getSellerRefunds
);

router.get(
  '/refunds/:refundId',
  authController.restrictTo('seller'),
  sellerRefundController.getSellerRefundById
);

router.post(
  '/refunds/:refundId/approve-return',
  authController.restrictTo('seller'),
  sellerRefundController.approveReturn
);

router.post(
  '/refunds/:refundId/reject-return',
  authController.restrictTo('seller'),
  sellerRefundController.rejectReturn
);

// Middleware to map returnId to refundId for compatibility
const mapReturnIdToRefundId = (req, res, next) => {
  if (req.params.returnId) {
    req.params.refundId = req.params.returnId;
  }
  next();
};

// Seller Returns Routes (aliases for /refunds routes for consistency)
router.get(
  '/returns',
  authController.restrictTo('seller'),
  sellerRefundController.getSellerRefunds
);

router.get(
  '/returns/:returnId',
  authController.restrictTo('seller'),
  mapReturnIdToRefundId,
  sellerRefundController.getSellerRefundById
);

router.patch(
  '/returns/:returnId/approve',
  authController.restrictTo('seller'),
  mapReturnIdToRefundId,
  sellerRefundController.approveReturn
);

router.patch(
  '/returns/:returnId/reject',
  authController.restrictTo('seller'),
  mapReturnIdToRefundId,
  sellerRefundController.rejectReturn
);

// Pickup Location Routes
router.get(
  '/me/pickup-locations',
  authController.restrictTo('seller'),
  pickupLocationController.getPickupLocations
);

router.get(
  '/me/pickup-locations/:id',
  authController.restrictTo('seller'),
  pickupLocationController.getPickupLocationById
);

router.post(
  '/me/pickup-locations',
  authController.restrictTo('seller'),
  pickupLocationController.createPickupLocation
);

router.patch(
  '/me/pickup-locations/:id',
  authController.restrictTo('seller'),
  pickupLocationController.updatePickupLocation
);

router.delete(
  '/me/pickup-locations/:id',
  authController.restrictTo('seller'),
  pickupLocationController.deletePickupLocation
);

router.patch(
  '/me/pickup-locations/:id/set-default',
  authController.restrictTo('seller'),
  pickupLocationController.setDefaultPickupLocation
);

router.delete(
  '/deleteMe',

  authController.restrictTo('seller'),
  sellerControllor.deleteMe,
);
router.patch(
  '/updateMe',
  authController.protect,
  authController.restrictTo('seller'),
  sellerControllor.uploadBusinessDocuments, // Handle file uploads with multer
  sellerControllor.uploadBusinessDocumentsToCloudinary, // Upload files to Cloudinary
  sellerControllor.updateMe,
);
router.patch(
  '/updateSellerImage',

  authController.restrictTo('seller'),
  uploadProfileImage,
  resizeImage,
  sellerControllor.updateSellerImage,
);
router.patch(
  '/:id/status',

  authController.restrictTo('admin'),
  sellerControllor.sellerStatus,
);

// Admin: Approve/Reject seller verification
router.patch(
  '/:id/approve-verification',
  authController.restrictTo('admin'),
  onboardingController.approveSellerVerification
);
router.patch(
  '/:id/reject-verification',
  authController.restrictTo('admin'),
  onboardingController.rejectSellerVerification
);
// Admin: Update individual document status
router.patch(
  '/:id/document-status',
  authController.restrictTo('admin'),
  onboardingController.updateDocumentStatus
);
// NOTE: Payout verification routes have been moved to /api/v1/admin/sellers/:id/payout/*
// This separation ensures payout verification is completely independent from document verification
// Admin-only routes are now defined BEFORE protectSeller middleware (see above around line 42)

module.exports = router;;
