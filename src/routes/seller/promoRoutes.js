const express = require('express');
const authSellerController = require('../../controllers/seller/authSellerController');
const authController = require('../../controllers/buyer/authController');
const {
  requireSellerDashboardAccess,
} = require('../../middleware/seller/requireVerifiedSeller');
const promoController = require('../../controllers/seller/promoController');

const router = express.Router();

const requireSellerDashboardAccessIfSeller = (req, res, next) => {
  if (req.user && ['seller', 'official_store'].includes(req.user.role)) {
    return requireSellerDashboardAccess(req, res, next);
  }
  return next();
};

router.use(authSellerController.protectSeller);
router.use(authController.restrictTo('seller', 'official_store'));
router.use(requireSellerDashboardAccessIfSeller);

router.get('/active', promoController.getSellerPromos);
router.get('/my-submissions', promoController.getMyPromoSubmissions);
router.patch('/submissions/:submissionId/withdraw', promoController.withdrawSubmission);
router.patch('/submissions/:submissionId', promoController.updateSellerPromoSubmission);

router.get('/:id/eligible-products', promoController.getSellerPromoEligibleProducts);
router.post('/:id/submit', promoController.submitSellerPromoProducts);
router.get('/:id', promoController.getSellerPromo);

module.exports = router;
