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
} = require('../Controllers/userController');
const authController = require('../Controllers/authController');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authController.logout);

router.post('/forgotPassword', authController.forgotPassword);
router.patch('/resetPassword/:token', authController.resetPassword);

router.use(authController.protect);
router.patch('/updatePassword', authController.updatePassword);
router.get('/me', getMe, getUser);

// router.use(authController.restrictTo('user'));
router.patch(
  '/updateMe',
  authController.restrictTo('user'),
  uploadUserPhoto,
  resizeUserPhoto,
  updateMe,
);
router.delete('/deleteMe', authController.restrictTo('user'), deleteMe);
router.get('/me', authController.restrictTo('user'), getMe);

router.use(authController.protect, authController.restrictTo('admin'));

router.get('/get/count', userCount);
router.route('/').get(getAllUsers).post(createUser);
router.route('/:id').get(getUser).patch(updateUser).delete(deleteUser);

module.exports = router;
