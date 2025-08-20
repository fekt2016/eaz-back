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
} = require('../Controllers/userController');
const authController = require('../Controllers/authController');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/logout', authController.logout);

router.post('/forgotPassword', authController.forgotPassword);
router.patch('/resetPassword/:token', authController.resetPassword);

router.get(
  '/profile',
  authController.protect,
  authController.restrictTo('user'),
  getProfile,
);

router.patch('/updatePassword', authController.updatePassword);
// router.get('/me', getMe, getUser);

router.use(authController.protect, authController.restrictTo('user'));
router.patch('/updateMe', uploadUserPhoto, resizeUserPhoto, updateMe);
router.patch(
  '/avatar',
  authController.protect,
  authController.restrictTo('user'),
  uploadUserPhoto,
  resizeUserPhoto,
  upLoadUserAvatar,
);
router.delete('/deleteMe', deleteMe);
router.get('/me', getMe);

router.use(authController.restrictTo('admin'));

router.get('/get/count', userCount);
router.route('/').get(getAllUsers).post(createUser);
router.route('/:id').get(getUser).patch(updateUser).delete(deleteUser);

module.exports = router;
