const express = require('express');
const {
  getAllCategories,
  createCategory,
  getCategory,
  updateCategory,
  uploadCategoryImage,
  resizeCategoryImages,
  deleteCategory,
} = require('../Controllers/categoryController');
const authController = require('../Controllers/authController');
const router = express.Router();

router
  .route('/')
  .get(
    authController.protect,
    authController.restrictTo('admin', 'seller'),
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
    authController.protect,
    authController.restrictTo('admin', 'seller'),
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
  ),
  (module.exports = router);
