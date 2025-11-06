const express = require('express');
const adminController = require('../../controllers/admin/adminController');
const authAdminController = require('../../controllers/admin/authAdminController');
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
