const express = require('express');
const authSellerController = require('../../controllers/seller/authSellerController');
const authController = require('../../controllers/buyer/authController');
const {
  imageUpload,
  validateImageBuffer,
} = require('../../middleware/imageValidation');
const imageController = require('../../controllers/seller/imageController');

const router = express.Router();

router.use(authSellerController.protectSeller);

router.post(
  '/upload-image',
  authController.restrictTo('seller', 'official_store'),
  imageUpload.single('image'),
  validateImageBuffer,
  imageController.uploadProductImage
);

module.exports = router;
