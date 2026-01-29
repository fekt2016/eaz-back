const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const { calculateShippingQuote } = require('../../services/shipping/shippingCalculationService');

// Calculate shipping quote
exports.calculateShippingQuote = catchAsync(async (req, res, next) => {

  
  const { buyerCity, items, method, pickupCenterId, deliverySpeed } = req.body;
  logger.info("🚀 Extracted from body:", { buyerCity, itemsCount: items?.length, method, pickupCenterId, deliverySpeed });

  // Validate input
  if (!buyerCity) {
    return next(new AppError('Buyer city is required', 400));
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(new AppError('Items array is required and must not be empty', 400));
  }

  // Validate method
  const validMethods = ['pickup_center', 'dispatch', 'seller_delivery'];
  const deliveryMethod = method || 'seller_delivery';
  if (!validMethods.includes(deliveryMethod)) {
    return next(
      new AppError(`Invalid delivery method. Must be one of: ${validMethods.join(', ')}`, 400)
    );
  }

  // Validate pickupCenterId if method is pickup_center
  if (deliveryMethod === 'pickup_center' && !pickupCenterId) {
    return next(new AppError('Pickup center ID is required when method is pickup_center', 400));
  }

  // Validate each item has required fields
  for (const item of items) {
    if (!item.productId) {
      return next(new AppError('Each item must have a productId', 400));
    }
    if (!item.sellerId) {
      return next(new AppError('Each item must have a sellerId', 400));
    }
    if (!item.quantity || item.quantity < 1) {
      return next(new AppError('Each item must have a valid quantity', 400));
    }
  }

  // Validate city
  const validCities = ['ACCRA', 'TEMA'];
  if (!validCities.includes(buyerCity.toUpperCase())) {
    return next(
      new AppError('Saiisai currently delivers only in Accra and Tema.', 400)
    );
  }

  try {
    logger.info("Calling calculateShippingQuote with:", {
      buyerCity,
      itemsCount: items.length,
      method: deliveryMethod,
      pickupCenterId,
    });

    const quote = await calculateShippingQuote(buyerCity, items, deliveryMethod, pickupCenterId, deliverySpeed);

    logger.info("Shipping quote calculated successfully:", {
      totalShippingFee: quote.totalShippingFee,
      perSellerCount: quote.perSeller?.length || 0,
      deliveryMethod: quote.deliveryMethod,
    });

    res.status(200).json({
      success: true,
      buyerCity: quote.buyerCity,
      deliveryMethod: quote.deliveryMethod,
      perSeller: quote.perSeller,
      totalShippingFee: quote.totalShippingFee,
      pickupCenter: quote.pickupCenter,
      dispatchType: quote.dispatchType,
    });
  } catch (error) {
    logger.error("Error calculating shipping quote:", error);
    logger.error("Error stack:", error.stack);
    return next(new AppError(error.message || 'Failed to calculate shipping quote', 500));
  }
});

