const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const DispatchFees = require('../../models/shipping/dispatchFeesModel');

// Get dispatch fees
exports.getDispatchFees = catchAsync(async (req, res, next) => {
  const fees = await DispatchFees.getOrCreate();

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

// Update dispatch fees
exports.updateDispatchFees = catchAsync(async (req, res, next) => {
  const { sameCity, crossCity, heavyItem } = req.body;

  // Validate fees are positive
  if (sameCity !== undefined && sameCity < 0) {
    return next(new AppError('Same city fee must be positive', 400));
  }
  if (crossCity !== undefined && crossCity < 0) {
    return next(new AppError('Cross city fee must be positive', 400));
  }
  if (heavyItem !== undefined && heavyItem < 0) {
    return next(new AppError('Heavy item fee must be positive', 400));
  }

  // Get or create fees document
  let fees = await DispatchFees.findOne();
  
  if (!fees) {
    fees = await DispatchFees.create({
      sameCity: sameCity ?? 25,
      crossCity: crossCity ?? 35,
      heavyItem: heavyItem ?? 60,
    });
  } else {
    if (sameCity !== undefined) fees.sameCity = sameCity;
    if (crossCity !== undefined) fees.crossCity = crossCity;
    if (heavyItem !== undefined) fees.heavyItem = heavyItem;
    await fees.save();
  }

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

