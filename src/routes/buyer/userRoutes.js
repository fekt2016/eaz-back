const express = require('express');

const { getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  createUser,
  updateMe,
  deleteMe,
  userCount,
  getMe,
  uploadUserPhoto,
  resizeUserPhoto,
  getProfile,
  upLoadUserAvatar, } = require('../../controllers/buyer/userController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

const { otpLimiter, resetLimiter } = require('../../middleware/rateLimiting/otpLimiter');

router.post('/login', authController.login);
router.post('/signup', authController.signup);
router.post('/email-verification', authController.emailVerification);
router.get('/email-verification/:token', authController.verifyEmail);
router.post('/resend-verification', authController.emailVerification);
router.post('/resend-otp', otpLimiter, authController.resendOtp); // ✅ New resend OTP endpoint
router.post('/verify-account', otpLimiter, authController.verifyAccount); // ✅ New account verification endpoint
router.post('/send-otp', otpLimiter, authController.sendOtp);
// SECURITY FIX #4 (Phase 2 Enhancement): Enhanced OTP verification with lockout protection
const { checkOtpLockout } = require('../../middleware/security/otpVerificationSecurity');
router.post('/verify-otp', otpLimiter, checkOtpLockout, authController.verifyOtp); // ✅ Rate limited + lockout protection
router.post('/logout', authController.logout);

// ==================================================
// UNIFIED EMAIL-ONLY PASSWORD RESET FLOW
// ==================================================
// New unified endpoints (email-only, token-based)
// SECURITY FIX #6: Use OTP rate limiter (5 requests per hour) for forgot-password
router.post('/forgot-password', otpLimiter, authController.requestPasswordReset);
router.post('/reset-password', resetLimiter, authController.resetPasswordWithToken);

// Legacy OTP-based endpoints (deprecated - kept for backward compatibility)
// SECURITY FIX #4 & #6: Rate limiting added to prevent brute-force attacks
// TODO: Remove these after migration
// router.post('/forgot-password', otpLimiter, authController.sendPasswordResetOtp); // ✅ Uses OTP rate limiter (5 per hour)
// router.post('/verify-reset-otp', otpLimiter, authController.verifyResetOtp); // ✅ Rate limited
// router.post('/reset-password', resetLimiter, authController.resetPassword);

router.get(
  '/profile',
  authController.protect,
  authController.restrictTo('user', 'admin'),
  getProfile,
);

router.patch(
  '/updatePassword',
  authController.protect,
  authController.restrictTo('user', 'admin'),
  authController.updatePassword,
);
// router.get('/me', getMe, getUser);

// Routes that should be accessible to both users and admins
router.patch(
  '/updateMe',
  authController.protect,
  authController.restrictTo('user', 'admin'),
  updateMe,
);
router.patch(
  '/avatar',
  authController.protect,
  // Avatar upload is a buyer-only route (role: 'user')
  authController.restrictTo('user'),
  uploadUserPhoto,
  resizeUserPhoto,
  upLoadUserAvatar,
);

//user deactivation his account
router.delete(
  '/deleteMe',
  authController.protect,
  authController.restrictTo('user', 'admin'),
  deleteMe,
);
router.get(
  '/me',
  authController.protect,
  authController.restrictTo('user', 'admin'),
  getMe,
);

router.get(
  '/get/count',
  authController.protect,
  authController.restrictTo('admin'),
  userCount,
);
router
  .route('/')
  .get(authController.protect, authController.restrictTo('admin'), getAllUsers)
  .post(createUser);
router
  .route('/:id')
  .get(authController.protect, authController.restrictTo('admin'), getUser)
  .patch(authController.protect, authController.restrictTo('admin'), updateUser)
  .delete(
    authController.protect,
    authController.restrictTo('admin'),
    deleteUser,
  );

module.exports = router;;
