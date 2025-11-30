const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const ShippingConfig = require('../../models/shipping/shippingConfigModel');

/**
 * Get shipping configuration
 * GET /api/v1/admin/shipping-config
 */
exports.getShippingConfig = catchAsync(async (req, res) => {
  const config = await ShippingConfig.getOrCreateDefault();
  
  res.status(200).json({
    status: 'success',
    data: {
      config,
    },
  });
});

/**
 * Update shipping configuration
 * PATCH /api/v1/admin/shipping-config
 */
exports.updateShippingConfig = catchAsync(async (req, res) => {
  const {
    zones,
    weightMultipliers,
    sameDayCutOff,
    enabled,
    standardDeliveryDays,
  } = req.body;
  
  let config = await ShippingConfig.findOne({ shippingType: 'standard' });
  
  if (!config) {
    config = await ShippingConfig.getOrCreateDefault();
  }
  
  // Update fields
  if (zones !== undefined) {
    config.zones = zones;
  }
  if (weightMultipliers !== undefined) {
    config.weightMultipliers = weightMultipliers;
  }
  if (sameDayCutOff !== undefined) {
    config.sameDayCutOff = sameDayCutOff;
  }
  if (enabled !== undefined) {
    config.enabled = enabled;
  }
  if (standardDeliveryDays !== undefined) {
    config.standardDeliveryDays = standardDeliveryDays;
  }
  
  config.updatedBy = req.user._id;
  
  await config.save();
  
  res.status(200).json({
    status: 'success',
    data: {
      config,
    },
  });
});

/**
 * Create shipping configuration
 * POST /api/v1/admin/shipping-config
 */
exports.createShippingConfig = catchAsync(async (req, res) => {
  const {
    shippingType = 'standard',
    zones,
    weightMultipliers,
    sameDayCutOff = '15:00',
    enabled = true,
    standardDeliveryDays = { min: 1, max: 3 },
  } = req.body;
  
  // Check if config already exists
  const existing = await ShippingConfig.findOne({ shippingType });
  if (existing) {
    throw new AppError(`Shipping config for type "${shippingType}" already exists`, 400);
  }
  
  const config = await ShippingConfig.create({
    shippingType,
    zones: zones || [
      {
        zoneId: 'A',
        name: 'Same City',
        baseSameDayRate: 50,
        baseStandardRate: 25,
        cities: ['ACCRA', 'TEMA'],
      },
      {
        zoneId: 'B',
        name: 'Nearby City',
        baseSameDayRate: 75,
        baseStandardRate: 35,
        cities: ['KUMASI', 'TAKORADI'],
      },
      {
        zoneId: 'C',
        name: 'Nationwide',
        baseSameDayRate: 100,
        baseStandardRate: 50,
        cities: [],
      },
    ],
    weightMultipliers: weightMultipliers || [
      { min: 0, max: 1, multiplier: 1.0 },
      { min: 1, max: 5, multiplier: 1.2 },
      { min: 5, max: 10, multiplier: 1.5 },
      { min: 10, max: Infinity, multiplier: 2.0 },
    ],
    sameDayCutOff,
    enabled,
    standardDeliveryDays,
    createdBy: req.user._id,
  });
  
  res.status(201).json({
    status: 'success',
    data: {
      config,
    },
  });
});

