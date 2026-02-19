const express = require('express');
const {
  createShippingRate,
  updateShippingRate,
  deleteShippingRate,
  getAllShippingRates,
  getRatesByZone,
  calculateFee,
} = require('../../controllers/admin/shippingRateController');
const authController = require('../../controllers/buyer/authController');
const catchAsync = require('../../utils/helpers/catchAsync');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

// Admin-only routes
router
  .route('/')
  .post(authController.restrictTo('admin', 'superadmin'), createShippingRate)
  .get(authController.restrictTo('admin', 'superadmin'), getAllShippingRates);

router
  .route('/:id')
  .patch(authController.restrictTo('admin', 'superadmin'), updateShippingRate)
  .delete(authController.restrictTo('admin', 'superadmin'), deleteShippingRate);

router.get('/zone/:zone', authController.restrictTo('admin', 'superadmin'), getRatesByZone);

// Toggle active status
router.patch('/:id/toggle', authController.restrictTo('admin', 'superadmin'), catchAsync(async (req, res, next) => {
  const ShippingRate = require('../../models/shipping/shippingRateModel');
  const AppError = require('../../utils/errors/appError');

  const rate = await ShippingRate.findById(req.params.id);
  if (!rate) {
    return next(new AppError('Shipping rate not found', 404));
  }

  rate.isActive = !rate.isActive;
  await rate.save();

  res.status(200).json({
    status: 'success',
    data: {
      shippingRate: rate,
    },
  });
}));

// Public route for calculating fees (authenticated users)
router.post('/calculate', calculateFee);

module.exports = router;

