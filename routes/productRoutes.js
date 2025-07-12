const express = require('express');
const authController = require('../Controllers/authController');
const {
  getAllProduct,
  getProduct,
  deleteProduct,
  createProduct,
  updateProduct,
  bestProductPrice,
  setProductIds,
  resizeProductImages,
  uploadProductImage,
  getSellerProduct,
  conditionalUpload,
  getProductCountByCategory,
} = require('../Controllers/ProductController');

const reviewRouter = require('./../routes/reviewRoutes');

const router = express.Router();
// router.use('/:productId/review', reviewRouter);
// router.route('/best-products-price').get(bestProductPrice, getAllProduct);
router.route('/category-counts').get(getProductCountByCategory);

// router.route('/seller').get(
//   authController.protect,
//   // authController.restrictTo('seller'),
//   getSellerProduct,
// );

router.route('/').get(getAllProduct).post(
  authController.protect,
  // authController.restrictTo('admin', 'seller'),
  setProductIds,
  uploadProductImage,
  resizeProductImages,
  createProduct,
);
router
  .route('/:id')
  .get(getProduct)
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

module.exports = router;
