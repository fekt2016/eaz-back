const express = require('express');
const { cloudinaryUpload } = require('../../middleware/upload/cloudinaryUpload');
const authController = require('../../controllers/buyer/authController');
const promoController = require('../../controllers/admin/promoController');

const router = express.Router();

router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

router.get('/slug-availability', promoController.checkSlugAvailability);

router.post(
  '/upload-banner',
  promoController.upload.fields([{ name: 'banner', maxCount: 1 }]),
  cloudinaryUpload({
    folder: () => 'promos/banners',
    publicIdPrefix: () => `promo-banner-${Date.now()}`,
    resourceType: 'image',
  }),
  promoController.uploadPromoBanner,
);

router.post(
  '/banner/upload',
  promoController.upload.fields([{ name: 'banner', maxCount: 1 }]),
  cloudinaryUpload({
    folder: () => 'promos/banners',
    publicIdPrefix: () => `promo-banner-${Date.now()}`,
    resourceType: 'image',
  }),
  promoController.uploadPromoBanner,
);

router.patch('/submissions/:submissionId', promoController.reviewPromoSubmission);

router.get('/:id/submissions', promoController.getPromoSubmissions);
router.patch('/:id/cancel', promoController.cancelPromo);

router
  .route('/:id')
  .get(promoController.getPromoById)
  .patch(promoController.updatePromo);

router.route('/').get(promoController.getPromos).post(promoController.createPromo);

module.exports = router;
