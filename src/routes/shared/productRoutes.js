const express = require('express');
const authController = require('../../controllers/buyer/authController');
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
  getProductById, } = require('../../controllers/seller/productController');
const { getPublicEazShopProducts } = require('../../controllers/admin/eazshopStoreController');

const router = express.Router();

router.route('/category-counts').get(getProductCountByCategory);
router.get('/category/:categoryId', getProductsByCategory); ///category/${categoryId})

// Public EazShop products endpoint (for homepage) - must be before /:id route
router.get('/eazshop', getPublicEazShopProducts);

router
  .route('/')
  .get(getAllProduct)
  .post(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    setProductIds,
    uploadProductImage,
    resizeProductImages,
    createProduct,
  );
// More specific routes should come before generic :id route
router.route('/:id/reviews').get(getProductReviews);
router.route('/:sellerId/public').get(getAllPublicProductsBySeller);
router
  .route('/:id')
  .get(getProductById)
  .patch(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    conditionalUpload,
    resizeProductImages,
    updateProduct,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
    deleteProduct,
  );

module.exports = router;;
