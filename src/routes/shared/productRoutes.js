const express = require('express');
const authController = require('../../controllers/buyer/authController');
const {
  getAllProduct,
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
} = require('../../controllers/seller/ProductController.cjs');

const router = express.Router();

router.route('/category-counts').get(getProductCountByCategory);
router.get('/category/:categoryId', getProductsByCategory); ///category/${categoryId})

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
router.route('/:id/reviews').get(getProductReviews);
router.route('/:sellerId/public').get(getAllPublicProductsBySeller);

module.exports = router;
