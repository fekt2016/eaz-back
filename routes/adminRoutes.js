const express = require('express');
const adminController = require('../Controllers/adminController');
const authAdminController = require('../Controllers/authAdminController');
const authController = require('../Controllers/authController');

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
