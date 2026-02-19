const express = require('express');
const authController = require('../../controllers/buyer/authController');
const eazshopStoreController = require('../../controllers/admin/eazshopStoreController');
const uploadProductImage = require('../../controllers/seller/productController').uploadProductImage;
const resizeProductImages = require('../../controllers/seller/productController').resizeProductImages;

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

// Products routes
router
  .route('/products')
  .get(eazshopStoreController.getEazShopProducts)
  .post(
    uploadProductImage,
    resizeProductImages,
    eazshopStoreController.createEazShopProduct
  );

router
  .route('/products/:id')
  .patch(
    uploadProductImage,
    resizeProductImages,
    eazshopStoreController.updateEazShopProduct
  );

router.patch('/products/:id/toggle', eazshopStoreController.toggleEazShopProduct);

// Mark/unmark products as EazShop
router.patch('/products/:id/mark-eazshop', eazshopStoreController.markProductAsEazShop);
router.patch('/products/:id/unmark-eazshop', eazshopStoreController.unmarkProductAsEazShop);

// Orders routes
router.get('/orders', eazshopStoreController.getEazShopOrders);

// Shipping fees routes
router
  .route('/shipping-fees')
  .get(eazshopStoreController.getEazShopShippingFees)
  .patch(eazshopStoreController.updateEazShopShippingFees);

// Pickup centers routes
router.get('/pickup-centers', eazshopStoreController.getPickupCenters);

module.exports = router;

