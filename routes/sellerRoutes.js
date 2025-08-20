const express = require('express');
const sellerControllor = require('../Controllers/sellerController');
const authSellerController = require('../Controllers/authSellerController');

const authController = require('../Controllers/authController');
const { resizeImage, uploadProfileImage } = require('../middleware/multer');

const router = express.Router();
router.post('/signup', authSellerController.signupSeller);
router.post('/login', authSellerController.loginSeller);
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

router.get(
  '/me',

  sellerControllor.getMe,
  sellerControllor.getSeller,
);

router.delete(
  '/deleteMe',

  authController.restrictTo('seller'),
  sellerControllor.deleteMe,
);
router.patch(
  '/updateMe',

  authController.restrictTo('seller'),
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
router
  .route('/')
  .get(authController.restrictTo('admin'), sellerControllor.getAllSeller);
router
  .route('/:id')
  .patch(
    authController.restrictTo('admin', 'seller'),
    sellerControllor.updateSeller,
  );

module.exports = router;
