const express = require('express');
const { getAllCategories,
  createCategory,
  getCategory,
  updateCategory,
  uploadCategoryImage,
  resizeCategoryImages,
  deleteCategory,
  getParentCategories, } = require('../../controllers/shared/categoryController');
const authController = require('../../controllers/buyer/authController');
const router = express.Router();

router.get('/parents', getParentCategories);
router
  .route('/')
  .get(
    // Make categories publicly accessible for browsing
    getAllCategories,
  )
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    uploadCategoryImage,
    resizeCategoryImages,
    createCategory,
  );
router
  .route('/:id')
  .get(
    // authController.protect,
    // authController.restrictTo('admin', 'seller'),
    getCategory,
  )
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    uploadCategoryImage,
    resizeCategoryImages,
    updateCategory,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin'),
    deleteCategory,
  );

module.exports = router;;
