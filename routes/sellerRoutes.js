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

router
  .route('/me/products')
  .get(
    authController.protect,
    authController.restrictTo('seller'),
    sellerControllor.getSellerProducts,
  );
router
  .route('/me/products/:productId')
  .get(
    authController.protect,
    authController.restrictTo('seller'),
    sellerControllor.getSellerProductById,
  )
  .delete(sellerControllor.SellerDeleteProduct);

router.get(
  '/me',
  authController.protect,
  sellerControllor.getMe,
  sellerControllor.getSeller,
);

router.delete(
  '/deleteMe',
  authController.protect,
  authController.restrictTo('seller'),
  sellerControllor.deleteMe,
);
router.patch(
  '/updateMe',
  authController.protect,
  authController.restrictTo('seller'),
  sellerControllor.updateMe,
);
router.patch(
  '/updateSellerImage',
  authController.protect,
  authController.restrictTo('seller'),
  uploadProfileImage,
  resizeImage,
  sellerControllor.updateSellerImage,
);
router.patch(
  '/:id/status',
  authController.protect,
  authController.restrictTo('admin'),
  sellerControllor.sellerStatus,
);
router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('admin'),
    sellerControllor.getAllSeller,
  );
router
  .route('/:id')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    sellerControllor.getSeller,
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    sellerControllor.updateSeller,
  );
module.exports = router;
