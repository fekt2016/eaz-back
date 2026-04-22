const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { SUPERADMIN_ONLY } = require('../../config/rolePermissions');
const saiisaiStoreController = require('../../controllers/admin/saiisaiStoreController');
const uploadProductImage = require('../../controllers/seller/productController').uploadProductImage;
const resizeProductImages = require('../../controllers/seller/productController').resizeProductImages;

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

// Products routes
router
  .route('/products')
  .get(saiisaiStoreController.getOfficialStoreProducts)
  .post(
    uploadProductImage,
    resizeProductImages,
    saiisaiStoreController.createEazShopProduct // Kept for legacy support in body parsing
  );

router
  .route('/products/:id')
  .patch(
    uploadProductImage,
    resizeProductImages,
    saiisaiStoreController.updateOfficialStoreProduct
  );

router.patch('/products/:id/toggle', saiisaiStoreController.toggleOfficialStoreProduct);

// Mark/unmark products as Official Store
router.patch('/products/:id/mark-official', saiisaiStoreController.markProductAsOfficial);
router.patch('/products/:id/unmark-official', saiisaiStoreController.unmarkProductAsOfficial);

// Orders routes
router.get('/orders', saiisaiStoreController.getOfficialStoreOrders);

// Official store analytics (credits split EazShop main vs accepted sellers)
router.get('/analytics', saiisaiStoreController.getOfficialStoreAnalytics);

// Shipping fees routes (superadmin: rate-like configuration)
router
  .route('/shipping-fees')
  .get(
    authController.restrictTo(...SUPERADMIN_ONLY),
    saiisaiStoreController.getOfficialStoreShippingFees,
  )
  .patch(
    authController.restrictTo(...SUPERADMIN_ONLY),
    saiisaiStoreController.updateOfficialStoreShippingFees,
  );

// Pickup centers routes
router.get(
  '/pickup-centers',
  authController.restrictTo(...SUPERADMIN_ONLY),
  saiisaiStoreController.getPickupCenters,
);

module.exports = router;

