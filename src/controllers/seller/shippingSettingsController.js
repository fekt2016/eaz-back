const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const SellerShippingSettings = require('../../models/shipping/sellerShippingSettingsModel');

// Get seller's shipping settings
exports.getMyShippingSettings = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;

  let settings = await SellerShippingSettings.findOne({ seller: sellerId });

  // If no settings exist, create default ones
  if (!settings) {
    settings = await SellerShippingSettings.getOrCreateDefault(sellerId);
  }

  res.status(200).json({
    status: 'success',
    data: { settings },
  });
});

// Update seller's shipping settings
exports.updateMyShippingSettings = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const {
    sameCityShippingFee,
    crossCityShippingFee,
    heavyItemShippingFee,
    pickupAvailable,
    expressAvailable,
    expressSurcharge,
  } = req.body;

  // Validate fees are positive numbers
  if (sameCityShippingFee !== undefined && sameCityShippingFee < 0) {
    return next(new AppError('Same city shipping fee must be positive', 400));
  }
  if (crossCityShippingFee !== undefined && crossCityShippingFee < 0) {
    return next(new AppError('Cross city shipping fee must be positive', 400));
  }
  if (heavyItemShippingFee !== undefined && heavyItemShippingFee < 0) {
    return next(new AppError('Heavy item shipping fee must be positive', 400));
  }
  if (expressSurcharge !== undefined && expressSurcharge < 0) {
    return next(new AppError('Express surcharge must be positive', 400));
  }

  // Find or create settings
  let settings = await SellerShippingSettings.findOne({ seller: sellerId });

  if (!settings) {
    // Create new settings with provided values or defaults
    settings = await SellerShippingSettings.create({
      seller: sellerId,
      sameCityShippingFee: sameCityShippingFee ?? 20,
      crossCityShippingFee: crossCityShippingFee ?? 30,
      heavyItemShippingFee: heavyItemShippingFee ?? 50,
      pickupAvailable: pickupAvailable ?? false,
      expressAvailable: expressAvailable ?? false,
      expressSurcharge: expressSurcharge ?? 15,
    });
  } else {
    // Update existing settings
    if (sameCityShippingFee !== undefined) settings.sameCityShippingFee = sameCityShippingFee;
    if (crossCityShippingFee !== undefined) settings.crossCityShippingFee = crossCityShippingFee;
    if (heavyItemShippingFee !== undefined) settings.heavyItemShippingFee = heavyItemShippingFee;
    if (pickupAvailable !== undefined) settings.pickupAvailable = pickupAvailable;
    if (expressAvailable !== undefined) settings.expressAvailable = expressAvailable;
    if (expressSurcharge !== undefined) settings.expressSurcharge = expressSurcharge;

    await settings.save();
  }

  res.status(200).json({
    status: 'success',
    data: { settings },
  });
});

