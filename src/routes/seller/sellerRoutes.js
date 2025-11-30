const express = require('express');
const sellerControllor = require('../../controllers/seller/sellerController');
const authSellerController = require('../../controllers/seller/authSellerController');
const onboardingController = require('../../controllers/seller/onboardingController');
const balanceController = require('../../controllers/seller/balanceController');
const sellerAnalyticsController = require('../../controllers/seller/sellerAnalyticsController');
const { requireVerifiedSeller } = require('../../middleware/seller/requireVerifiedSeller');

const authController = require('../../controllers/buyer/authController');
const { resizeImage, uploadProfileImage } = require('../../middleware/upload/multer');

const router = express.Router();
router.post('/signup', authSellerController.signupSeller);
router.post('/login', authSellerController.loginSeller);
router.post('/send-otp', authSellerController.sendOtp);
router.post('/verify-otp', authSellerController.verifyOtp);
router.post('/forgotPassword', authSellerController.forgotPassword);
router.patch('/resetPassword/:token', authSellerController.resetPassword);
router.post('/logout', authSellerController.logout);

router.route('/public/featured').get(sellerControllor.getFeaturedSellers);
router.route('/public/:id').get(sellerControllor.getPublicSeller);
router.route('/profile/:id').get(sellerControllor.getSeller);
//protected routes
router.use(authController.protect);
router
  .route('/me/products')
  .get(authController.restrictTo('seller'), sellerControllor.getSellerProducts);
router
  .route('/me/products/:productId')
  .get(
    authController.restrictTo('seller'),
    sellerControllor.getSellerProductById,
  )
  .delete(sellerControllor.SellerDeleteProduct);

// Onboarding routes (protected, but don't require verification)
router.get(
  '/status',
  authController.restrictTo('seller'),
  onboardingController.getOnboardingStatus
);
router.patch(
  '/update-onboarding',
  authController.restrictTo('seller'),
  onboardingController.updateOnboarding
);

// Verification routes (protected, but don't require verification)
router.post(
  '/send-verification-email',
  authController.restrictTo('seller'),
  authSellerController.sendEmailVerificationOtp
);
router.post(
  '/verify-email',
  authController.restrictTo('seller'),
  authSellerController.verifyEmail
);

router.get(
  '/me',
  sellerControllor.getMe,
  sellerControllor.getSeller,
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
router
  .route('/')
  .get(authController.restrictTo('admin'), sellerControllor.getAllSeller);
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    sellerControllor.getSeller,
  )
  .patch(
    authController.restrictTo('admin', 'seller'),
    sellerControllor.updateSeller,
  );

module.exports = router;;
