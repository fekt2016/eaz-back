const express = require('express');
const authController = require('../../controllers/buyer/authController');
const followController = require('../../controllers/buyer/followController');
const router = express.Router();

router.route('/:sellerId/followers').get(followController.getSellerfollowers);
router
  .route('/status/:sellerId')
  .get(authController.protect, followController.getFollowStatus);
router
  .get('/products', authController.protect, authController.restrictTo('user', 'seller', 'admin', 'driver', 'official_store'), followController.getFollowedSellerProducts);
router
  .route('/:sellerId')
  .get(
    authController.protect,
    authController.restrictTo('seller'),
    followController.getFollowedShops,
  )
  .post(
    authController.protect,
    authController.restrictTo('user', 'seller', 'admin', 'driver', 'official_store'),
    followController.followSeller,
  )
  .delete(
    authController.protect,
    authController.restrictTo('user', 'seller', 'admin', 'driver', 'official_store'),
    followController.unfollowSeller,
  );
router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('user', 'seller', 'admin', 'driver', 'official_store'),
    followController.getFollowedShops,
  );

module.exports = router;;
