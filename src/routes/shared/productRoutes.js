const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { optionalAuth } = require('../../middleware/auth/optionalAuth');
const validateVariantAttributes = require('../../middleware/validateVariantAttributes');
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
const { getPublicOfficialStoreProducts } = require('../../controllers/admin/saiisaiStoreController');
const promoPriceLock = require('../../middleware/promoPriceLock');

const router = express.Router();

router.route('/category-counts').get(getProductCountByCategory);
router.get('/category/:categoryId', getProductsByCategory); ///category/${categoryId})

// Public EazShop products endpoint (for homepage) - must be before /:id route
router.get('/eazshop', getPublicOfficialStoreProducts);

router
  .route('/')
  .get(optionalAuth, getAllProduct)
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    setProductIds,
    uploadProductImage,
    resizeProductImages,
    validateVariantAttributes,
    createProduct,
  );
// More specific routes should come before generic :id route
// optionalAuth: logged-in users see their own pending reviews; anonymous users see only approved
router.route('/:id/reviews').get(optionalAuth, getProductReviews);

// Variant routes - must be before /:id route
router
  .route('/:id/variants')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    getProductVariants
  )
  .post(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    conditionalUpload,
    resizeProductImages,
    createProductVariant
  );

router
  .route('/:id/variants/:variantId')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    getProductVariant
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    promoPriceLock,
    conditionalUpload,
    resizeProductImages,
    updateProductVariant
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    deleteProductVariant
  );

// Seller public products route - MUST be before /:id route to avoid route conflicts
router.route('/:sellerId/public').get(getAllPublicProductsBySeller);

router
  .route('/:id')
  .get(optionalAuth, getProductById)
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    promoPriceLock,
    conditionalUpload,
    resizeProductImages,
    validateVariantAttributes,
    updateProduct,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'superadmin', 'seller', 'official_store'),
    deleteProduct,
  );

module.exports = router;;
