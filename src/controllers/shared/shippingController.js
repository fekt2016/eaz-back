const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { getZoneFromNeighborhood, getZoneFromNeighborhoodName } = require('../../utils/getZoneFromNeighborhood');
const { calcShipping, calcShippingWithBreakdown } = require('../../utils/calcShipping');
const { isWorkingHours } = require('../../services/zoneService');

/**
 * Calculate shipping fee based on neighborhood
 * POST /api/v1/shipping/calc-shipping
 * 
 * Request body:
 * {
 *   neighborhoodId: string (optional if neighborhoodName and city provided),
 *   neighborhoodName: string (optional),
 *   city: string (optional, required if using neighborhoodName),
 *   weight: number (required),
 *   shippingType: string (required, 'standard', 'same_day', or 'express')
 * }
 */
exports.calcShipping = catchAsync(async (req, res, next) => {
  const { neighborhoodId, neighborhoodName, city, weight, shippingType = 'standard', fragile = false } = req.body;

  // Validate required fields
  if (!weight || weight <= 0) {
    return next(new AppError('Valid weight is required', 400));
  }

  // Validate shipping type
  const validShippingTypes = ['standard', 'same_day', 'express'];
  if (!validShippingTypes.includes(shippingType)) {
    return next(new AppError(`Invalid shipping type. Must be one of: ${validShippingTypes.join(', ')}`, 400));
  }

  let neighborhood, zone;

  try {
    // Get zone from neighborhood
    if (neighborhoodId) {
      ({ neighborhood, zone } = await getZoneFromNeighborhood(neighborhoodId));
    } else if (neighborhoodName && city) {
      ({ neighborhood, zone } = await getZoneFromNeighborhoodName(neighborhoodName, city));
    } else {
      return next(new AppError('Either neighborhoodId or (neighborhoodName and city) must be provided', 400));
    }
  } catch (error) {
    return next(new AppError(error.message, 404));
  }

  // Calculate shipping fee (with fragile surcharge if applicable)
  const fee = calcShipping(zone, weight, shippingType, fragile);
  const breakdown = calcShippingWithBreakdown(zone, weight, shippingType, fragile);

  res.status(200).json({
    status: 'success',
    data: {
      neighborhood: {
        id: neighborhood._id,
        name: neighborhood.name,
        city: neighborhood.city,
        municipality: neighborhood.municipality,
      },
      zone: {
        name: zone.name,
        distanceRange: `${zone.minKm}-${zone.maxKm} km`,
        estimatedDays: zone.estimatedDays,
      },
      distance: neighborhood.distanceFromHQ,
      shippingFee: fee,
      breakdown: breakdown.breakdown,
    },
  });
});

/**
 * Get shipping options for all types based on neighborhood
 * POST /api/v1/shipping/shipping-options
 * 
 * Request body:
 * {
 *   neighborhoodId: string (optional if neighborhoodName and city provided),
 *   neighborhoodName: string (optional),
 *   city: string (optional, required if using neighborhoodName),
 *   weight: number (required)
 * }
 * 
 * Returns options for: standard, same_day, express
 */
exports.getShippingOptions = catchAsync(async (req, res, next) => {
  const { neighborhoodId, neighborhoodName, city, weight, fragile = false } = req.body;

  // Validate required fields
  if (!weight || weight <= 0) {
    return next(new AppError('Valid weight is required', 400));
  }

  let neighborhood, zone;

  try {
    // Get zone from neighborhood
    if (neighborhoodId) {
      ({ neighborhood, zone } = await getZoneFromNeighborhood(neighborhoodId));
    } else if (neighborhoodName && city) {
      ({ neighborhood, zone } = await getZoneFromNeighborhoodName(neighborhoodName, city));
    } else {
      return next(new AppError('Either neighborhoodId or (neighborhoodName and city) must be provided', 400));
    }
  } catch (error) {
    return next(new AppError(error.message, 404));
  }

  // Get current time in Ghana (UTC+0 / Africa/Accra)
  const now = new Date();
  const ghanaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Accra' }));
  const hour = ghanaTime.getHours();
  const minute = ghanaTime.getMinutes();

  // Check same-day availability (cut-off time: 15:00 / 3pm Ghana time)
  const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const cutOffTime = '15:00';
  const isSameDayAvailable = currentTime < cutOffTime;

  // Check Express Delivery availability: only during working hours (Mon–Fri 08:00–18:00 Ghana time)
  const isExpressAvailable = isWorkingHours(now);

  // Express estimate: if available now → starts today; otherwise starts at next working slot
  let expressEstimate;
  if (isExpressAvailable) {
    expressEstimate = 'Starts today — delivered within 1-2 hours';
  } else {
    const dayOfWeek = ghanaTime.getDay(); // 0=Sun, 6=Sat
    const isAfterHours = hour >= 18;
    if (dayOfWeek === 0) {
      // Sunday — next working day is Monday
      expressEstimate = 'Starts Monday from 8:00 AM';
    } else if (isAfterHours && dayOfWeek === 6) {
      // Saturday after 6pm — next working day is Monday
      expressEstimate = 'Starts Monday from 8:00 AM';
    } else if (isAfterHours) {
      // Mon–Fri after 6pm — starts tomorrow
      expressEstimate = 'Starts tomorrow from 8:00 AM';
    } else {
      // Before 8am on any working day (Mon–Sat)
      expressEstimate = 'Starts today from 8:00 AM';
    }
  }

  // Calculate fees for all shipping types (with fragile surcharge if applicable)
  const standardFee = calcShipping(zone, weight, 'standard', fragile);
  const standardBreakdown = calcShippingWithBreakdown(zone, weight, 'standard', fragile);

  const sameDayFee = calcShipping(zone, weight, 'same_day', fragile);
  const sameDayBreakdown = calcShippingWithBreakdown(zone, weight, 'same_day', fragile);

  const expressFee = calcShipping(zone, weight, 'express', fragile);
  const expressBreakdown = calcShippingWithBreakdown(zone, weight, 'express', fragile);

  // Build options array
  const options = [
    {
      type: 'standard',
      name: 'Standard Delivery',
      fee: standardFee,
      estimate: zone.estimatedDays || '2-3 Business Days',
      available: true,
      breakdown: standardBreakdown.breakdown,
    },
    {
      type: 'same_day',
      name: 'Next Day Delivery',
      fee: sameDayFee,
      estimate: 'Arrives Today',
      available: isSameDayAvailable,
      cutOff: cutOffTime,
      breakdown: sameDayBreakdown.breakdown,
    },
    {
      type: 'express',
      name: 'Express Delivery',
      fee: expressFee,
      estimate: expressEstimate,
      available: true,  // Always selectable — delivery starts at next working hours
      workingHours: '08:00–18:00, Mon–Fri',
      breakdown: expressBreakdown.breakdown,
    },
  ];

  res.status(200).json({
    status: 'success',
    data: {
      neighborhood: {
        id: neighborhood._id,
        name: neighborhood.name,
        city: neighborhood.city,
        municipality: neighborhood.municipality,
      },
      zone: {
        name: zone.name,
        distanceRange: `${zone.minKm}-${zone.maxKm} km`,
        estimatedDays: zone.estimatedDays,
      },
      distance: neighborhood.distanceFromHQ,
      options,
    },
  });
});
