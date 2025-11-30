const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const ShippingConfig = require('../../models/shipping/shippingConfigModel');
const { calculateShipping } = require('../../services/shippingCalculator');
const { detectNeighborhoodFromCoordinates, calculateZoneFromCoordinates } = require('../../services/neighborhoodService');
const { digitalAddressToCoordinates } = require('../../services/digitalAddressService');
const {
  calculateCartWeight,
  detectZone,
  isSameDayAvailable,
  calculateDeliveryEstimate,
  calculateShippingFee,
  getActiveShippingConfig,
} = require('../../utils/helpers/shippingHelpers');

/**
 * Calculate shipping fee
 * POST /api/v1/shipping/calculate
 */
exports.calculateShipping = catchAsync(async (req, res) => {
  const { weight, zone, shippingType, orderTime, items, buyerCity } = req.body;
  
  // Validate required fields
  if (!shippingType || !['same_day', 'standard'].includes(shippingType)) {
    throw new AppError('Invalid shipping type. Must be "same_day" or "standard"', 400);
  }
  
  // Get shipping config
  const config = await getActiveShippingConfig();
  
  if (!config || !config.enabled) {
    throw new AppError('Shipping service is currently unavailable', 503);
  }
  
  // Calculate weight if items provided, otherwise use provided weight
  let totalWeight = weight;
  if (items && items.length > 0 && !weight) {
    totalWeight = await calculateCartWeight(items);
  }
  
  if (!totalWeight || totalWeight <= 0) {
    totalWeight = 0.5; // Default minimum weight
  }
  
  // Detect zone if city provided, otherwise use provided zone
  let zoneId = zone;
  let zoneName = 'Nationwide';
  
  if (buyerCity && !zone) {
    const zoneInfo = detectZone(buyerCity, config);
    zoneId = zoneInfo.zoneId;
    zoneName = zoneInfo.name;
  } else if (zone) {
    const zoneObj = config.zones.find((z) => z.zoneId === zone);
    zoneName = zoneObj?.name || 'Nationwide';
  } else {
    zoneId = 'C'; // Default to Zone C
  }
  
  // Validate same-day delivery availability
  if (shippingType === 'same_day') {
    const orderDateTime = orderTime || new Date().toISOString();
    const available = isSameDayAvailable(orderDateTime, config.sameDayCutOff);
    
    if (!available) {
      const cutOffTime = config.sameDayCutOff || '15:00';
      throw new AppError(
        `Same-day delivery is only available for orders placed before ${cutOffTime}. Please select standard delivery.`,
        400
      );
    }
  }
  
  // Calculate shipping fee
  const calculation = calculateShippingFee({
    weight: totalWeight,
    zoneId,
    shippingType,
    config,
  });
  
  // Calculate delivery estimate
  const orderDate = orderTime ? new Date(orderTime) : new Date();
  const deliveryEstimate = calculateDeliveryEstimate(shippingType, orderDate, config);
  
  // Prepare response (matching required format)
  res.status(200).json({
    status: 'success',
    data: {
      shippingFee: calculation.shippingFee,
      deliveryEstimate,
      shippingType,
      baseRate: calculation.baseRate,
      weightMultiplier: calculation.weightMultiplier,
      finalWeight: calculation.weight,
      zone: calculation.zoneId,
      zoneName: calculation.zoneName,
      sameDayCutOff: config.sameDayCutOff,
      isSameDayAvailable: shippingType === 'same_day' || isSameDayAvailable(orderDate.toISOString(), config.sameDayCutOff),
    },
  });
});

/**
 * Get shipping options for a location
 * GET /api/v1/shipping/options
 */
exports.getShippingOptions = catchAsync(async (req, res) => {
  const { city, weight, items } = req.query;
  
  // Get shipping config
  const config = await getActiveShippingConfig();
  
  if (!config || !config.enabled) {
    throw new AppError('Shipping service is currently unavailable', 503);
  }
  
  // Calculate weight if items provided
  let totalWeight = weight ? parseFloat(weight) : null;
  if (items && !totalWeight) {
    // Parse items if string
    const itemsArray = typeof items === 'string' ? JSON.parse(items) : items;
    totalWeight = await calculateCartWeight(itemsArray);
  }
  
  if (!totalWeight || totalWeight <= 0) {
    totalWeight = 0.5; // Default minimum weight
  }
  
  // Detect zone
  let zoneId = 'C';
  let zoneName = 'Nationwide';
  
  if (city) {
    const zoneInfo = detectZone(city, config);
    zoneId = zoneInfo.zoneId;
    zoneName = zoneInfo.name;
  }
  
  // Check same-day availability
  const now = new Date();
  const sameDayAvailable = isSameDayAvailable(now.toISOString(), config.sameDayCutOff);
  
  // Calculate fees for both options
  const sameDayFee = calculateShippingFee({
    weight: totalWeight,
    zoneId,
    shippingType: 'same_day',
    config,
  });
  
  const standardFee = calculateShippingFee({
    weight: totalWeight,
    zoneId,
    shippingType: 'standard',
    config,
  });
  
  const deliveryEstimateSameDay = calculateDeliveryEstimate('same_day', now, config);
  const deliveryEstimateStandard = calculateDeliveryEstimate('standard', now, config);
  
  res.status(200).json({
    status: 'success',
    data: {
      zone: {
        id: zoneId,
        name: zoneName,
      },
      options: [
        {
          type: 'same_day',
          name: 'Same Day Delivery',
          fee: sameDayFee.shippingFee,
          estimate: deliveryEstimateSameDay,
          available: sameDayAvailable,
          cutOff: config.sameDayCutOff,
        },
        {
          type: 'standard',
          name: 'Standard Delivery',
          fee: standardFee.shippingFee,
          estimate: deliveryEstimateStandard,
          available: true,
        },
      ],
      weight: totalWeight,
    },
  });
});

