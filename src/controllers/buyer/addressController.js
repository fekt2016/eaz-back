const mongoose = require('mongoose');
const Address = require('../../models/user/addressModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const { lookupDigitalAddress } = require('../../utils/helpers/digitalAddressHelper');

// Get all addresses for current user
exports.getAddresses = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const addresses = await Address.find({ user: userId });

  if (!addresses) next(new AppError('No addresses found', 404));

  res.json({
    status: 'success',
    results: addresses.length,
    data: { addresses },
  });
});

// Create new address
exports.createAddress = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const { isDefault, ...addressData } = req.body;
    
    // Normalize city to lowercase
    if (addressData.city) {
      addressData.city = addressData.city.toLowerCase().trim();
    }
    
    // Normalize region to lowercase and handle "greater accra region" -> "greater accra"
    if (addressData.region) {
      const normalizedRegion = addressData.region.toLowerCase().trim();
      if (normalizedRegion === 'greater accra region') {
        addressData.region = 'greater accra';
      } else {
        addressData.region = normalizedRegion;
      }
    }
    
    const address = new Address({
      user: userId,
      ...addressData,
    });

    if (isDefault) {
      await Address.updateMany(
        { user: req.user.id },
        { $set: { isDefault: false } },
      );
      address.isDefault = true;
    }
    await address.save();
 

    res
      .status(201)
      .json({ success: true, message: 'Address created', address });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Update address
exports.updateAddress = catchAsync(async (req, res, next ) => {
  const { isDefault, ...updateData } = req.body;
  logger.info("updateData received:", updateData);
  logger.info("address ID from params:", req.params.id);
  
  // Find address for this user
  const address = await Address.findOne({
    _id: req.params.id,
    user: req.user.id,
  });

  if (!address) {
    return res.status(404).json({
      success: false,
      message: "Address not found"
    });
  }

  // Normalize updateData before applying
  const normalizedData = { ...updateData };
  
  // Normalize all string fields to lowercase (except special fields)
  if (normalizedData.fullName) {
    normalizedData.fullName = normalizedData.fullName.toLowerCase().trim();
  }
  if (normalizedData.streetAddress) {
    normalizedData.streetAddress = normalizedData.streetAddress.toLowerCase().trim();
  }
  if (normalizedData.area) {
    normalizedData.area = normalizedData.area.toLowerCase().trim();
  }
  if (normalizedData.landmark) {
    normalizedData.landmark = normalizedData.landmark.toLowerCase().trim();
  }
  if (normalizedData.city) {
    normalizedData.city = normalizedData.city.toLowerCase().trim();
  }
  if (normalizedData.region) {
    const normalizedRegion = normalizedData.region.toLowerCase().trim();
    // Handle "greater accra region" -> "greater accra"
    if (normalizedRegion === 'greater accra region') {
      normalizedData.region = 'greater accra';
    } else {
      normalizedData.region = normalizedRegion;
    }
  }
  if (normalizedData.country) {
    normalizedData.country = normalizedData.country.toLowerCase().trim();
  }
  if (normalizedData.additionalInformation) {
    normalizedData.additionalInformation = normalizedData.additionalInformation.toLowerCase().trim();
  }
  
  // Digital address should be uppercase
  if (normalizedData.digitalAddress) {
    normalizedData.digitalAddress = normalizedData.digitalAddress.toUpperCase().trim();
  }
  
  // Contact phone should be trimmed only
  if (normalizedData.contactPhone) {
    normalizedData.contactPhone = normalizedData.contactPhone.trim();
  }

  // Apply normalized updates
  Object.assign(address, normalizedData);

  // 🛑 Handle default address switching
  if (isDefault !== undefined) {
    if (isDefault) {
      await Address.updateMany(
        { user: req.user.id, _id: { $ne: req.params.id } },
        { $set: { isDefault: false } }
      );
      address.isDefault = true;
    } else {
      address.isDefault = false;
    }
  }

  // Save the address
  try {
    await address.save();
    logger.info("Address saved successfully:", address);
  } catch (error) {
    logger.error("Error saving address:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update address",
      error: error.errors
    });
  }

  res.json({
    success: true,
    message: "Address updated",
    address
  });
});


// Delete address
exports.deleteAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findOneAndDelete({
    _id: req.params.id,
    user: req.user.id,
  });

  if (!address) {
    return res
      .status(404)
      .json({ success: false, message: 'Address not found' });
  }

  // If deleted address was default, set a new default if available
  if (address.isDefault) {
    const newDefault = await Address.findOne({ user: req.user.id });
    if (newDefault) {
      newDefault.isDefault = true;
      await newDefault.save();
    }
  }

  res.json({ success: true, message: 'Address deleted' });
});

// Set default address
exports.setDefaultAddress = async (req, res) => {
  try {
    await Address.updateMany(
      { user: req.user.id },
      { $set: { isDefault: false } },
    );

    const address = await Address.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: { isDefault: true } },
      { new: true },
    );

    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: 'Address not found' });
    }

    res.json({ success: true, message: 'Default address updated', address });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getUserAddresses = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const addresses = await Address.find({ user: userId });
  
  // Address.find() always returns an array, so check length instead
  if (!addresses || addresses.length === 0) {
    return res.status(200).json({ 
      status: 'success', 
      message: 'No addresses found', 
      data: { addresses: [] } 
    });
  }
  
  res.status(200).json({ 
    status: 'success', 
    message: 'Addresses found', 
    data: { addresses } 
  });
});
exports.getAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findById(req.params.id);
  if (!address) next(new AppError('No address found', 404));
  res.json({ success: true, message: 'Address found', address });
});


exports.lookupDigitalAddress = catchAsync(async (req, res, next) => {
  const { digitalAddress } = req.body;

  if (!digitalAddress) {
    return next(new AppError('Digital address is required', 400));
  }

  try {
    const addressDetails = await lookupDigitalAddress(digitalAddress);
    res.status(200).json({
      status: 'success',
      data: addressDetails,
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

/**
 * Create address with zone information
 * POST /api/v1/address/create
 */
exports.createAddressWithZone = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { isDefault, zone, ...addressData } = req.body;

  try {
    const address = new Address({
      user: userId,
      ...addressData,
    });

    if (isDefault) {
      await Address.updateMany(
        { user: req.user.id },
        { $set: { isDefault: false } },
      );
      address.isDefault = true;
    }

    await address.save();

    // Return address with zone info
    const addressWithZone = address.toObject();
    if (zone) {
      addressWithZone.zone = zone;
    }

    res.status(201).json({
      status: 'success',
      message: 'Address created successfully',
      data: { address: addressWithZone },
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});
