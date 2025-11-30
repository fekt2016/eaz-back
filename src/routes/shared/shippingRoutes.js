const express = require('express');
const shippingQuoteController = require('../../controllers/shared/shippingQuoteController');
const shippingCalculationController = require('../../controllers/shared/shippingCalculationController');
const shippingController = require('../../controllers/shared/shippingController');
const authController = require('../../controllers/buyer/authController');
const PickupCenter = require('../../models/shipping/pickupCenterModel');
const catchAsync = require('../../utils/helpers/catchAsync');

const router = express.Router();

// Get active pickup centers (public endpoint for checkout)
router.get(
  '/pickup-centers',
  catchAsync(async (req, res) => {
    const { city } = req.query;
    const query = { isActive: true };
    if (city) query.city = city.toUpperCase();

    const pickupCenters = await PickupCenter.find(query).sort({ city: 1, area: 1 });

    res.status(200).json({
      status: 'success',
      results: pickupCenters.length,
      data: { pickupCenters },
    });
  })
);

// Calculate shipping quote (public endpoint, but can be protected if needed)
router.post(
  '/quote',
  (req, res, next) => {
    console.log("📍 ===== SHIPPING QUOTE ROUTE HIT =====");
    console.log("📍 POST /shipping/quote");
    console.log("📍 Request body:", req.body);
    next();
  },
  shippingQuoteController.calculateShippingQuote
);

// New shipping calculation endpoints
router.post('/calculate', shippingCalculationController.calculateShipping);
router.get('/options', shippingCalculationController.getShippingOptions);

// Neighborhood-based shipping calculation
router.post('/calc-shipping', shippingController.calcShipping);
router.post('/shipping-options', shippingController.getShippingOptions);

module.exports = router;

