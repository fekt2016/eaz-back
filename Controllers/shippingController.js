const Shipping = require('../Models/shippingModel');
const {
  calculateShippingCost,
  generateTrackingNumber,
  assignDeliveryAgent,
} = require('../services/shippingService');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// Calculate shipping costs for buyer
exports.calculateShipping = catchAsync(async (req, res) => {
  const { items, deliveryAddress } = req.body;

  // In real app, get seller location from product/seller data
  const sellerLocation = {
    region: 'Greater Accra',
    district: 'Accra Metropolitan',
  };

  const shippingInfo = calculateShippingCost(
    items,
    sellerLocation,
    deliveryAddress,
  );

  // Return only buyer-visible information
  res.status(200).json({
    status: 'success',
    data: {
      buyerCharge: shippingInfo.buyerCharge,
      estimatedDays: shippingInfo.estimatedDays,
      region: deliveryAddress.region,
    },
  });
});

// Create shipping record for an order
exports.createShipping = catchAsync(async (order, seller, buyerAddress) => {
  const sellerLocation = seller.businessAddress || {
    region: 'Greater Accra',
    district: 'Accra Metropolitan',
  };

  const shippingInfo = calculateShippingCost(
    order.items,
    sellerLocation,
    buyerAddress,
  );

  const shipping = await Shipping.create({
    order: order._id,
    seller: order.seller,
    buyer: order.user,
    trackingNumber: generateTrackingNumber(),
    charges: {
      baseCost: shippingInfo.baseCost,
      buyerCharge: shippingInfo.buyerCharge,
      sellerCharge: shippingInfo.sellerCharge,
      companyFee: shippingInfo.companyFee,
    },
    estimatedDays: shippingInfo.estimatedDays,
    deliveryAgent: assignDeliveryAgent(buyerAddress.district),
    status: 'processing',
  });

  return shipping;
});

// Update shipping status
exports.updateShippingStatus = catchAsync(async (trackingNumber, status) => {
  const updateData = { status };

  if (status === 'delivered') {
    updateData.actualDeliveryDate = Date.now();
  }

  const shipping = await Shipping.findOneAndUpdate(
    { trackingNumber },
    updateData,
    { new: true },
  );

  if (!shipping) {
    throw new AppError('Shipping not found', 404);
  }

  return shipping;
});
