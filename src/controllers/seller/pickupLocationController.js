const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { generateGhanaPostAddress } = require('../../utils/gpsToGhanaPost');

/**
 * Get all pickup locations for the authenticated seller
 */
exports.getPickupLocations = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id).select('pickupLocations');
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      locations: seller.pickupLocations || [],
    },
  });
});

/**
 * Get a single pickup location by ID
 */
exports.getPickupLocationById = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const seller = await Seller.findById(req.user.id).select('pickupLocations');
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const location = seller.pickupLocations.id(id);
  
  if (!location) {
    return next(new AppError('Pickup location not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      location,
    },
  });
});

/**
 * Create a new pickup location
 */
exports.createPickupLocation = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id);
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const { name, region, city, address, latitude, longitude, digitalAddress, contactName, contactPhone, isDefault, notes } = req.body;

  // Validate required fields
  if (!name || !region || !city || !address || !contactName || !contactPhone) {
    return next(new AppError('Please provide all required fields: name, region, city, address, contactName, contactPhone', 400));
  }

  // Auto-generate digital address from coordinates if provided
  let generatedDigitalAddress = digitalAddress;
  if (latitude && longitude && !digitalAddress) {
    try {
      generatedDigitalAddress = generateGhanaPostAddress(latitude, longitude);
    } catch (error) {
      console.error('[Pickup Location] Error generating digital address:', error.message);
      // Don't fail if digital address generation fails, just log it
    }
  }

  // If setting as default, unset all other defaults
  if (isDefault === true) {
    seller.pickupLocations.forEach(loc => {
      loc.isDefault = false;
    });
  }

  // Create new location
  const newLocation = {
    name,
    region,
    city,
    address,
    latitude: latitude || null,
    longitude: longitude || null,
    digitalAddress: generatedDigitalAddress ? generatedDigitalAddress.toUpperCase().trim() : null,
    contactName,
    contactPhone,
    isDefault: isDefault || false,
    notes: notes || '',
  };

  seller.pickupLocations.push(newLocation);
  await seller.save();

  // Get the newly created location (last in array)
  const createdLocation = seller.pickupLocations[seller.pickupLocations.length - 1];

  res.status(201).json({
    status: 'success',
    data: {
      location: createdLocation,
    },
  });
});

/**
 * Update an existing pickup location
 */
exports.updatePickupLocation = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const seller = await Seller.findById(req.user.id);
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const location = seller.pickupLocations.id(id);
  
  if (!location) {
    return next(new AppError('Pickup location not found', 404));
  }

  const { name, region, city, address, latitude, longitude, digitalAddress, contactName, contactPhone, isDefault, notes } = req.body;

  // Update fields if provided
  if (name !== undefined) location.name = name;
  if (region !== undefined) location.region = region;
  if (city !== undefined) location.city = city;
  if (address !== undefined) location.address = address;
  if (latitude !== undefined) location.latitude = latitude;
  if (longitude !== undefined) location.longitude = longitude;
  if (contactName !== undefined) location.contactName = contactName;
  if (contactPhone !== undefined) location.contactPhone = contactPhone;
  if (notes !== undefined) location.notes = notes;

  // Auto-generate digital address from coordinates if provided and digitalAddress not explicitly set
  if (latitude !== undefined && longitude !== undefined) {
    const newLat = latitude !== null ? latitude : location.latitude;
    const newLng = longitude !== null ? longitude : location.longitude;
    
    if (newLat && newLng) {
      // Only auto-generate if digitalAddress is not explicitly provided
      if (digitalAddress === undefined || digitalAddress === null || digitalAddress === '') {
        try {
          location.digitalAddress = generateGhanaPostAddress(newLat, newLng).toUpperCase().trim();
        } catch (error) {
          console.error('[Pickup Location] Error generating digital address:', error.message);
          // Don't fail if digital address generation fails
        }
      } else {
        location.digitalAddress = digitalAddress.toUpperCase().trim();
      }
    } else if (newLat === null && newLng === null) {
      // If coordinates are cleared, clear digital address too
      location.digitalAddress = null;
    }
  } else if (digitalAddress !== undefined) {
    // If digitalAddress is explicitly provided without coordinates, use it
    location.digitalAddress = digitalAddress ? digitalAddress.toUpperCase().trim() : null;
  }

  // Handle default location change
  if (isDefault === true && !location.isDefault) {
    // Unset all other defaults
    seller.pickupLocations.forEach(loc => {
      if (loc._id.toString() !== id) {
        loc.isDefault = false;
      }
    });
    location.isDefault = true;
  } else if (isDefault === false) {
    location.isDefault = false;
  }

  await seller.save();

  res.status(200).json({
    status: 'success',
    data: {
      location,
    },
  });
});

/**
 * Delete a pickup location
 */
exports.deletePickupLocation = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const seller = await Seller.findById(req.user.id);
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const location = seller.pickupLocations.id(id);
  
  if (!location) {
    return next(new AppError('Pickup location not found', 404));
  }

  // Prevent deletion if it's the only location
  if (seller.pickupLocations.length === 1) {
    return next(new AppError('Cannot delete the only pickup location. Please add another location first.', 400));
  }

  const wasDefault = location.isDefault;

  // Remove the location
  seller.pickupLocations.pull(id);
  
  // If deleted location was default, set first location as default
  if (wasDefault && seller.pickupLocations.length > 0) {
    seller.pickupLocations[0].isDefault = true;
  }

  await seller.save();

  res.status(200).json({
    status: 'success',
    message: 'Pickup location deleted successfully',
  });
});

/**
 * Set a location as the default pickup location
 */
exports.setDefaultPickupLocation = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const seller = await Seller.findById(req.user.id);
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const location = seller.pickupLocations.id(id);
  
  if (!location) {
    return next(new AppError('Pickup location not found', 404));
  }

  // Unset all other defaults
  seller.pickupLocations.forEach(loc => {
    loc.isDefault = loc._id.toString() === id;
  });

  await seller.save();

  res.status(200).json({
    status: 'success',
    message: 'Default pickup location updated successfully',
    data: {
      location,
    },
  });
});

