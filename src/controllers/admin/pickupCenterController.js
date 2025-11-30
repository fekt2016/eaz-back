const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const PickupCenter = require('../../models/shipping/pickupCenterModel');

// Get all pickup centers
exports.getAllPickupCenters = catchAsync(async (req, res, next) => {
  const { city, isActive } = req.query;
  
  const query = {};
  if (city) query.city = city.toUpperCase();
  if (isActive !== undefined) query.isActive = isActive === 'true';

  const pickupCenters = await PickupCenter.find(query).sort({ city: 1, area: 1 });

  res.status(200).json({
    status: 'success',
    results: pickupCenters.length,
    data: { pickupCenters },
  });
});

// Get single pickup center
exports.getPickupCenter = catchAsync(async (req, res, next) => {
  const pickupCenter = await PickupCenter.findById(req.params.id);

  if (!pickupCenter) {
    return next(new AppError('Pickup center not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { pickupCenter },
  });
});

// Create pickup center
exports.createPickupCenter = catchAsync(async (req, res, next) => {
  const {
    pickupName,
    address,
    city,
    area,
    googleMapLink,
    instructions,
    openingHours,
    isActive,
  } = req.body;

  const pickupCenter = await PickupCenter.create({
    pickupName,
    address,
    city: city?.toUpperCase(),
    area,
    googleMapLink,
    instructions,
    openingHours: openingHours || 'Monday - Friday: 9:00 AM - 6:00 PM',
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    status: 'success',
    data: { pickupCenter },
  });
});

// Update pickup center
exports.updatePickupCenter = catchAsync(async (req, res, next) => {
  const {
    pickupName,
    address,
    city,
    area,
    googleMapLink,
    instructions,
    openingHours,
    isActive,
  } = req.body;

  const pickupCenter = await PickupCenter.findByIdAndUpdate(
    req.params.id,
    {
      ...(pickupName && { pickupName }),
      ...(address && { address }),
      ...(city && { city: city.toUpperCase() }),
      ...(area && { area }),
      ...(googleMapLink !== undefined && { googleMapLink }),
      ...(instructions !== undefined && { instructions }),
      ...(openingHours !== undefined && { openingHours }),
      ...(isActive !== undefined && { isActive }),
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!pickupCenter) {
    return next(new AppError('Pickup center not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { pickupCenter },
  });
});

// Delete pickup center (soft delete by setting isActive to false)
exports.deletePickupCenter = catchAsync(async (req, res, next) => {
  const pickupCenter = await PickupCenter.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );

  if (!pickupCenter) {
    return next(new AppError('Pickup center not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: null,
    message: 'Pickup center deactivated successfully',
  });
});

