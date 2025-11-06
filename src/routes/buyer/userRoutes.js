const express = require('express');

const {
  getAllUsers,
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
  upLoadUserAvatar,
} = require('../../controllers/buyer/userController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/email-verification', authController.emailVerification);
router.get('/email-verification/:token', authController.verifyEmail);
router.post('/resend-verification', authController.emailVerification);
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/logout', authController.logout);

// router.post('/forgotPassword', authController.forgotPassword);
// router.patch('/resetPassword/:token', authController.resetPassword);
router.post('/forgot-password', authController.sendPasswordResetOtp);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);

router.get(
  '/profile',
  authController.protect,
  authController.restrictTo('user'),
  getProfile,
);

router.patch(
  '/updatePassword',
  authController.protect,
  authController.restrictTo('user'),
  authController.updatePassword,
);
// router.get('/me', getMe, getUser);

router.use(authController.protect, authController.restrictTo('user'));
router.patch('/updateMe', updateMe);
router.patch(
  '/avatar',
  authController.protect,
  authController.restrictTo('user'),
  uploadUserPhoto,
  resizeUserPhoto,
  upLoadUserAvatar,
);

//user deactivation his account
router.delete(
  '/deleteMe',
  authController.protect,
  authController.restrictTo('user'),
  deleteMe,
);
router.get('/me', getMe);

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

module.exports = router;
