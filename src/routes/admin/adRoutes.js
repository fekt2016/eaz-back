const express = require('express');
const authController = require('../../controllers/buyer/authController');
const adController = require('../../controllers/admin/adController');
const multer = require('multer');
const { cloudinaryUpload } = require('../../middleware/upload/cloudinaryUpload');

const router = express.Router();

// Public endpoint – return currently active ads for buyers
router.get('/public', adController.getPublicAds);

// Admin-only routes
router.use(
  authController.protect,
  authController.restrictTo('admin', 'superadmin', 'moderator'),
);

// Admin: upload advertisement image (returns Cloudinary URL)
router.post(
  '/upload-image',
  multer({ storage: multer.memoryStorage() }).fields([{ name: 'image', maxCount: 1 }]),
  cloudinaryUpload({
    folder: () => 'ads',
    publicIdPrefix: () => `ad-${Date.now()}`,
    resourceType: 'image',
  }),
  (req, res) => {
    const uploads = req.cloudinaryUploads || {};
    const imageMeta = uploads.image;
    const imageUrl = imageMeta?.url || req.body.image;

    if (!imageUrl) {
      return res.status(400).json({
        status: 'fail',
        message: 'Image upload failed. Please try again.',
      });
    }

    return res.status(201).json({
      status: 'success',
      data: {
        imageUrl,
      },
    });
  },
);

router
  .route('/')
  .get(adController.getAds)
  .post(adController.createAd);

router
  .route('/:id')
  .patch(adController.updateAd)
  .delete(adController.deleteAd);

module.exports = router;
