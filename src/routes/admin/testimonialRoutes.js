const express = require('express');
const testimonialController = require('../../controllers/admin/testimonialController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

router.get('/', testimonialController.getAllTestimonials);

router.patch('/:id/approve', testimonialController.approveTestimonial);
router.patch('/:id/reject', testimonialController.rejectTestimonial);
router.patch('/:id/unpublish', testimonialController.unpublishTestimonial);
router.delete('/:id', testimonialController.deleteTestimonial);

module.exports = router;
