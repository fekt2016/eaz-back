const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const ShippingRate = require('../../models/shipping/shippingRateModel');

/**
 * Create a new shipping rate
 * POST /api/v1/shipping-rates
 */
exports.createShippingRate = catchAsync(async (req, res, next) => {
  const {
    shippingType,
    zone,
    weightMin,
    weightMax,
    baseFee,
    perKgFee,
    weightAddOn,
    standardMultiplier,
    sameDayMultiplier,
    expressMultiplier,
    estimatedDays,
    isActive,
  } = req.body;

  // Validate required fields
  if (!shippingType || !zone || weightMin === undefined || weightMax === undefined || baseFee === undefined) {
    return next(new AppError('Missing required fields', 400));
  }

  // Validate zone
  if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(zone)) {
    return next(new AppError('Invalid zone. Must be "A", "B", "C", "D", "E", or "F"', 400));
  }

  // Validate shippingType (still use 'standard' as base, multipliers handle the rest)
  if (!['standard', 'same_day'].includes(shippingType)) {
    return next(new AppError('Invalid shipping type. Must be "standard" or "same_day"', 400));
  }

  // Validate weight range
  if (weightMax <= weightMin) {
    return next(new AppError('weightMax must be greater than weightMin', 400));
  }

  // Check for overlapping rates
  const overlappingRate = await ShippingRate.findOne({
    shippingType,
    zone,
    isActive: true,
    $or: [
      { weightMin: { $lte: weightMax, $gte: weightMin } },
      { weightMax: { $lte: weightMax, $gte: weightMin } },
      { weightMin: { $lte: weightMin }, weightMax: { $gte: weightMax } },
    ],
  });

  if (overlappingRate) {
    return next(
      new AppError(
        `Overlapping weight range exists: ${overlappingRate.weightMin}-${overlappingRate.weightMax}kg`,
        400
      )
    );
  }

  const shippingRate = await ShippingRate.create({
    shippingType,
    zone,
    weightMin,
    weightMax,
    baseFee,
    perKgFee: perKgFee || 0,
    weightAddOn: weightAddOn || 0,
    standardMultiplier: standardMultiplier || 1.0,
    sameDayMultiplier: sameDayMultiplier || 1.2,
    expressMultiplier: expressMultiplier || 1.4,
    fragileSurcharge: fragileSurcharge || 0,
    weekendSurcharge: weekendSurcharge || 0,
    nightSurcharge: nightSurcharge || 0,
    estimatedDays: estimatedDays || (shippingType === 'same_day' ? 'Delivered Today' : '1-3 days'),
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    status: 'success',
    data: {
      shippingRate,
    },
  });
});

/**
 * Update shipping rate
 * PATCH /api/v1/shipping-rates/:id
 */
exports.updateShippingRate = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const updateData = req.body;

  const shippingRate = await ShippingRate.findById(id);

  if (!shippingRate) {
    return next(new AppError('Shipping rate not found', 404));
  }

  // If updating weight range, check for overlaps (excluding current rate)
  if (updateData.weightMin !== undefined || updateData.weightMax !== undefined) {
    const weightMin = updateData.weightMin ?? shippingRate.weightMin;
    const weightMax = updateData.weightMax ?? shippingRate.weightMax;

    if (weightMax <= weightMin) {
      return next(new AppError('weightMax must be greater than weightMin', 400));
    }

    const overlappingRate = await ShippingRate.findOne({
      _id: { $ne: id },
      shippingType: updateData.shippingType || shippingRate.shippingType,
      zone: updateData.zone || shippingRate.zone,
      isActive: true,
      $or: [
        { weightMin: { $lte: weightMax, $gte: weightMin } },
        { weightMax: { $lte: weightMax, $gte: weightMin } },
        { weightMin: { $lte: weightMin }, weightMax: { $gte: weightMax } },
      ],
    });

    if (overlappingRate) {
      return next(
        new AppError(
          `Overlapping weight range exists: ${overlappingRate.weightMin}-${overlappingRate.weightMax}kg`,
          400
        )
      );
    }
  }

  Object.assign(shippingRate, updateData);
  await shippingRate.save();

  res.status(200).json({
    status: 'success',
    data: {
      shippingRate,
    },
  });
});

/**
 * Delete shipping rate
 * DELETE /api/v1/shipping-rates/:id
 */
exports.deleteShippingRate = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const shippingRate = await ShippingRate.findByIdAndDelete(id);

  if (!shippingRate) {
    return next(new AppError('Shipping rate not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Shipping rate deleted successfully',
  });
});

/**
 * Get all shipping rates
 * GET /api/v1/shipping-rates
 */
exports.getAllShippingRates = catchAsync(async (req, res) => {
  const { shippingType, zone, isActive } = req.query;
  
  // Build filter object - ignore empty strings, null, and undefined
  const filter = {};
  if (shippingType && shippingType !== '' && shippingType !== 'all') {
    filter.shippingType = shippingType;
  }
  if (zone && zone !== '' && zone !== 'all') {
    filter.zone = zone;
  }
  if (isActive !== undefined && isActive !== '' && isActive !== null) {
    // Convert string 'true'/'false' to boolean
    filter.isActive = isActive === 'true' || isActive === true;
  }
  
  // Find shipping rates with filters and sort
  const shippingRates = await ShippingRate.find(filter).sort({
    shippingType: 1,
    zone: 1,
    weightMin: 1,
  });

  logger.info("shippingRates", shippingRates);
  
  res.status(200).json({
    status: 'success',
    results: shippingRates.length,
    data: {
      shippingRates,
    },
  });
});

/**
 * Get rates by zone
 * GET /api/v1/shipping-rates/zone/:zone
 */
exports.getRatesByZone = catchAsync(async (req, res, next) => {
  const { zone } = req.params;
  const { shippingType, isActive } = req.query;

  const filter = { zone };
  if (shippingType) filter.shippingType = shippingType;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const shippingRates = await ShippingRate.find(filter).sort({
    shippingType: 1,
    weightMin: 1,
  });

  res.status(200).json({
    status: 'success',
    results: shippingRates.length,
    data: {
      shippingRates,
    },
  });
});

/**
 * Calculate shipping fee
 * POST /api/v1/shipping-rates/calculate
 * Supports both old format (weight, shippingType, zone) and new format (origin, destination, weight, type)
 */
exports.calculateFee = catchAsync(async (req, res, next) => {
  const { weight, shippingType, zone, origin, destination, destinationAddress, type, distanceKm, fragile, orderTime } = req.body;

  // Validate weight
  if (!weight || weight <= 0) {
    return next(new AppError('Valid weight is required', 400));
  }

  // Determine if using new distance-based format or old zone-based format
  // FIXED ORIGIN: Warehouse location is always used as origin, never geocoded
  // Only customer destination is geocoded if address string provided
  const useDistanceBased = !!(destination || destinationAddress) || distanceKm !== undefined;
  
  if (useDistanceBased) {
    // New distance-based calculation
    // IMPORTANT: Origin is always the fixed warehouse location
    // Only destination (customer address) is geocoded if needed
    const shippingCalculator = require('../../services/shippingCalculator');
const logger = require('../../utils/logger');
    
    try {
      const result = await shippingCalculator.calculateShipping({
        distanceKm,
        destLat: destination?.lat,
        destLng: destination?.lng,
        destinationAddress: destinationAddress || (destination?.address ? `${destination.address}, Ghana` : null),
        weight,
        type: type || shippingType || 'standard',
        fragile: fragile || false,
        orderTime: orderTime || new Date(),
      });

      res.status(200).json({
        status: 'success',
        data: {
          shippingFee: result.fee,
          estimatedDays: result.estimatedDelivery,
          baseFee: result.baseFee,
          perKgFee: result.perKgFee,
          weightAddOn: result.weightAddOn,
          multiplier: result.multiplier,
          baseCost: result.baseCost,
          weight,
          shippingType: result.shippingType,
          zone: result.zone,
          distanceKm: result.distanceKm,
          breakdown: result.breakdown,
        },
      });
    } catch (error) {
      return next(new AppError(error.message, 400));
    }
  } else {
    // Old zone-based calculation (backward compatibility)
    const finalShippingType = shippingType || type || 'standard';
    if (!['standard', 'same_day', 'express'].includes(finalShippingType)) {
      return next(new AppError('Invalid shipping type. Must be "standard", "same_day", or "express"', 400));
    }
    if (!zone || !['A', 'B', 'C', 'D', 'E', 'F'].includes(zone)) {
      return next(new AppError('Invalid zone. Must be "A", "B", "C", "D", "E", or "F"', 400));
    }

    try {
      const result = await ShippingRate.calculateFee(weight, finalShippingType, zone);

      res.status(200).json({
        status: 'success',
        data: {
          shippingFee: result.fee,
          estimatedDays: result.estimatedDays,
          baseFee: result.baseFee,
          perKgFee: result.perKgFee,
          weightAddOn: result.weightAddOn || 0,
          multiplier: result.multiplier || 1.0,
          baseCost: result.baseCost,
          weight,
          shippingType: finalShippingType,
          zone,
        },
      });
    } catch (error) {
      return next(new AppError(error.message, 404));
    }
  }
});

