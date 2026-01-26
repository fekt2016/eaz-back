const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { optionalAuth } = require('../../middleware/auth/optionalAuth');
const { getAllProduct,
  deleteProduct,
  createProduct,
  updateProduct,
  setProductIds,
  resizeProductImages,
  uploadProductImage,
  conditionalUpload,
  getProductCountByCategory,
  getProductReviews,
  getAllPublicProductsBySeller,
  getProductsByCategory,
  getProductById,
  getProductVariants,
  getProductVariant,
  createProductVariant,
  updateProductVariant,
  deleteProductVariant, } = require('../../controllers/seller/productController');
const { getPublicEazShopProducts } = require('../../controllers/admin/eazshopStoreController');

const router = express.Router();

router.route('/category-counts').get(getProductCountByCategory);
router.get('/category/:categoryId', getProductsByCategory); ///category/${categoryId})

// Public EazShop products endpoint (for homepage) - must be before /:id route
router.get('/eazshop', getPublicEazShopProducts);

router
  .route('/')
  .get(optionalAuth, getAllProduct)
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    setProductIds,
    uploadProductImage,
    resizeProductImages,
    createProduct,
  );
// More specific routes should come before generic :id route
router.route('/:id/reviews').get(getProductReviews);

// Variant routes - must be before /:id route
router
  .route('/:id/variants')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    getProductVariants
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    conditionalUpload,
    resizeProductImages,
    createProductVariant
  );

router
  .route('/:id/variants/:variantId')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    getProductVariant
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    conditionalUpload,
    resizeProductImages,
    updateProductVariant
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    deleteProductVariant
  );

// Seller public products route - MUST be before /:id route to avoid route conflicts
router.route('/:sellerId/public').get(getAllPublicProductsBySeller);

router
  .route('/:id')
  .get(optionalAuth, getProductById)
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    conditionalUpload,
    resizeProductImages,
    updateProduct,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'moderator', 'seller'),
    deleteProduct,
  );

module.exports = router;;
