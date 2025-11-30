const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const ShippingZone = require('../../models/shipping/shippingZoneModel');

/**
 * Create a new shipping zone
 * POST /api/v1/shipping-zones
 */
exports.createShippingZone = catchAsync(async (req, res, next) => {
  const {
    name,
    minKm,
    maxKm,
    baseRate,
    perKgRate,
    sameDayMultiplier,
    expressMultiplier,
    estimatedDays,
    isActive,
  } = req.body;

  // Validate required fields
  if (!name || minKm === undefined || maxKm === undefined || baseRate === undefined) {
    return next(new AppError('Missing required fields: name, minKm, maxKm, baseRate', 400));
  }

  // Validate zone name
  if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(name.toUpperCase())) {
    return next(new AppError('Invalid zone name. Must be "A", "B", "C", "D", "E", or "F"', 400));
  }

  // Validate distance range
  if (maxKm <= minKm) {
    return next(new AppError('maxKm must be greater than minKm', 400));
  }

  // Check if zone already exists
  const existingZone = await ShippingZone.findOne({ name: name.toUpperCase() });
  if (existingZone) {
    return next(new AppError(`Zone ${name.toUpperCase()} already exists`, 400));
  }

  // Check for overlapping distance ranges
  const overlappingZone = await ShippingZone.findOne({
    _id: { $ne: existingZone?._id },
    isActive: true,
    $or: [
      { minKm: { $lte: maxKm, $gte: minKm } },
      { maxKm: { $lte: maxKm, $gte: minKm } },
      { minKm: { $lte: minKm }, maxKm: { $gte: maxKm } },
    ],
  });

  if (overlappingZone) {
    return next(
      new AppError(
        `Overlapping distance range exists: Zone ${overlappingZone.name} (${overlappingZone.minKm}-${overlappingZone.maxKm} km)`,
        400
      )
    );
  }

  const shippingZone = await ShippingZone.create({
    name: name.toUpperCase(),
    minKm,
    maxKm,
    baseRate,
    perKgRate: perKgRate || 0,
    sameDayMultiplier: sameDayMultiplier || 1.2,
    expressMultiplier: expressMultiplier || 1.4,
    estimatedDays: estimatedDays || '2-3',
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    status: 'success',
    data: {
      shippingZone,
    },
  });
});

/**
 * Update shipping zone
 * PATCH /api/v1/shipping-zones/:id
 */
exports.updateShippingZone = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const updateData = req.body;

  const shippingZone = await ShippingZone.findById(id);

  if (!shippingZone) {
    return next(new AppError('Shipping zone not found', 404));
  }

  // If updating distance range, check for overlaps (excluding current zone)
  if (updateData.minKm !== undefined || updateData.maxKm !== undefined) {
    const minKm = updateData.minKm ?? shippingZone.minKm;
    const maxKm = updateData.maxKm ?? shippingZone.maxKm;

    if (maxKm <= minKm) {
      return next(new AppError('maxKm must be greater than minKm', 400));
    }

    const overlappingZone = await ShippingZone.findOne({
      _id: { $ne: id },
      isActive: true,
      $or: [
        { minKm: { $lte: maxKm, $gte: minKm } },
        { maxKm: { $lte: maxKm, $gte: minKm } },
        { minKm: { $lte: minKm }, maxKm: { $gte: maxKm } },
      ],
    });

    if (overlappingZone) {
      return next(
        new AppError(
          `Overlapping distance range exists: Zone ${overlappingZone.name} (${overlappingZone.minKm}-${overlappingZone.maxKm} km)`,
          400
        )
      );
    }
  }

  // If updating name, validate it
  if (updateData.name) {
    if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(updateData.name.toUpperCase())) {
      return next(new AppError('Invalid zone name. Must be "A", "B", "C", "D", "E", or "F"', 400));
    }
    updateData.name = updateData.name.toUpperCase();

    // Check if new name conflicts with another zone
    const nameConflict = await ShippingZone.findOne({
      _id: { $ne: id },
      name: updateData.name,
    });

    if (nameConflict) {
      return next(new AppError(`Zone ${updateData.name} already exists`, 400));
    }
  }

  Object.assign(shippingZone, updateData);
  await shippingZone.save();

  res.status(200).json({
    status: 'success',
    data: {
      shippingZone,
    },
  });
});

/**
 * Delete shipping zone
 * DELETE /api/v1/shipping-zones/:id
 */
exports.deleteShippingZone = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const shippingZone = await ShippingZone.findByIdAndDelete(id);

  if (!shippingZone) {
    return next(new AppError('Shipping zone not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Shipping zone deleted successfully',
  });
});

/**
 * Get all shipping zones
 * GET /api/v1/shipping-zones
 */
exports.getAllShippingZones = catchAsync(async (req, res) => {
  const { isActive } = req.query;

  const filter = {};
  if (isActive !== undefined && isActive !== '' && isActive !== null) {
    filter.isActive = isActive === 'true' || isActive === true;
  }

  const shippingZones = await ShippingZone.find(filter).sort({
    minKm: 1,
  });

  res.status(200).json({
    status: 'success',
    results: shippingZones.length,
    data: {
      shippingZones,
    },
  });
});

/**
 * Get zone by ID
 * GET /api/v1/shipping-zones/:id
 */
exports.getShippingZone = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const shippingZone = await ShippingZone.findById(id);

  if (!shippingZone) {
    return next(new AppError('Shipping zone not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      shippingZone,
    },
  });
});

/**
 * Toggle shipping zone active status
 * PATCH /api/v1/shipping-zones/:id/toggle
 */
exports.toggleShippingZoneActive = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const shippingZone = await ShippingZone.findById(id);

  if (!shippingZone) {
    return next(new AppError('Shipping zone not found', 404));
  }

  shippingZone.isActive = !shippingZone.isActive;
  await shippingZone.save();

  res.status(200).json({
    status: 'success',
    data: {
      shippingZone,
    },
  });
});

