const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { lookupDigitalAddress } = require('../../utils/helpers/digitalAddressHelper');
const locationService = require('../../services/locationService');
const hybridResolver = require('../../services/locationHybridResolver');
const googleMapsService = require('../../services/googleMapsService');
const hybridAddressResolver = require('../../services/hybridAddressResolver');
const hybridLocationResolver = require('../../services/hybridResolver');
const { reverseGeocodeSimple } = require('../../services/googleMapsService');

/**
 * Convert GPS coordinates to GhanaPostGPS Digital Address
 * GET /api/v1/location/convert-coordinates?lat=...&lng=...
 */
exports.convertCoordinatesToDigitalAddress = catchAsync(async (req, res, next) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return next(new AppError('Invalid latitude or longitude values', 400));
  }

  // Validate coordinates are within Ghana's bounds (approximately)
  // Ghana: Latitude ~4.5°N to 11.2°N, Longitude ~3.2°W to 1.3°E
  if (latitude < 4 || latitude > 12 || longitude < -4 || longitude > 2) {
    return next(new AppError('Coordinates are outside Ghana', 400));
  }

  // Convert GPS coordinates to GhanaPostGPS Digital Address
  // This is a mock implementation - in production, use actual GhanaPostGPS API
  const digitalAddress = convertGPSToGhanaPostGPS(latitude, longitude);

  res.status(200).json({
    status: 'success',
    data: {
      digitalAddress,
      coordinates: {
        lat: latitude,
        lng: longitude,
      },
    },
  });
});

/**
 * Mock function to convert GPS coordinates to GhanaPostGPS format
 * In production, this would call the actual GhanaPostGPS API
 * Format: GA-XXX-YYYY (RegionCode-DistrictCode-UniqueCode)
 */
function convertGPSToGhanaPostGPS(lat, lng) {
  // GhanaPostGPS uses a grid system
  // Region codes: GA (Greater Accra), AS (Ashanti), etc.
  // For Greater Accra region (most common):
  
  // Determine region based on coordinates
  let regionCode = 'GA'; // Default to Greater Accra
  
  // Greater Accra: lat ~5.5-6.0, lng ~-0.3-0.3
  if (lat >= 5.5 && lat <= 6.0 && lng >= -0.3 && lng <= 0.3) {
    regionCode = 'GA';
  }
  // Ashanti (Kumasi): lat ~6.6-6.8, lng ~-1.7-1.5
  else if (lat >= 6.6 && lat <= 6.8 && lng >= -1.7 && lng <= -1.5) {
    regionCode = 'AS';
  }
  // Western (Takoradi): lat ~4.8-5.0, lng ~-1.8-1.6
  else if (lat >= 4.8 && lat <= 5.0 && lng >= -1.8 && lng <= -1.6) {
    regionCode = 'WE';
  }
  // Central (Cape Coast): lat ~5.1-5.3, lng ~-1.3-1.1
  else if (lat >= 5.1 && lat <= 5.3 && lng >= -1.3 && lng <= -1.1) {
    regionCode = 'CE';
  }

  // Generate district code (3 digits) based on longitude
  // Normalize longitude to 0-999 range
  const normalizedLng = Math.abs(lng) * 100;
  const districtCode = Math.floor(normalizedLng % 1000).toString().padStart(3, '0');

  // Generate unique code (4 digits) based on latitude
  // Normalize latitude to 0-9999 range
  const normalizedLat = Math.abs(lat) * 1000;
  const uniqueCode = Math.floor(normalizedLat % 10000).toString().padStart(4, '0');

  return `${regionCode}-${districtCode}-${uniqueCode}`;
}

/**
 * Get physical address from GPS coordinates
 * GET /api/v1/location/reverse-geocode?lat=...&lng=...
 */
exports.reverseGeocode = catchAsync(async (req, res, next) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return next(new AppError('Invalid latitude or longitude values', 400));
  }

  // First convert to digital address
  const digitalAddress = convertGPSToGhanaPostGPS(latitude, longitude);

  // Then lookup the physical address from digital address
  try {
    const addressDetails = await lookupDigitalAddress(digitalAddress);
    
    res.status(200).json({
      status: 'success',
      data: {
        ...addressDetails,
        coordinates: {
          lat: latitude,
          lng: longitude,
        },
      },
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to reverse geocode', 400));
  }
});

/**
 * Lookup full address details from GhanaPostGPS digital address
 * POST /api/v1/location/lookup-digital-address
 */
exports.lookupDigitalAddressFull = catchAsync(async (req, res, next) => {
  const { digitalAddress } = req.body;

  if (!digitalAddress) {
    return next(new AppError('Digital address is required', 400));
  }

  try {
    const addressData = await locationService.lookupDigitalAddressFull(digitalAddress);

    res.status(200).json({
      status: 'success',
      data: addressData,
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to lookup digital address', 400));
  }
});

/**
 * Hybrid location lookup using GPS coordinates
 * Combines GhanaPostGPS and Google Maps for accurate address resolution
 * GET /api/v1/location/hybrid-lookup?lat=...&lng=...
 */
exports.hybridLocationLookup = catchAsync(async (req, res, next) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return next(new AppError('Invalid latitude or longitude values', 400));
  }

  try {
    const addressData = await hybridResolver.hybridLocationLookup(latitude, longitude);

    res.status(200).json({
      status: 'success',
      data: addressData,
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to perform hybrid location lookup', 400));
  }
});

/**
 * Reverse geocode GPS coordinates using Google Maps API
 * POST /api/v1/location/reverse-geocode
 */
exports.reverseGeocode = catchAsync(async (req, res, next) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return next(new AppError('Invalid latitude or longitude values', 400));
  }

  // Validate coordinates are within Ghana's bounds (approximately)
  if (latitude < 4 || latitude > 12 || longitude < -4 || longitude > 2) {
    return next(new AppError('Coordinates are outside Ghana', 400));
  }

  try {
    const addressData = await googleMapsService.reverseGeocode(latitude, longitude);

    res.status(200).json({
      status: 'success',
      data: addressData,
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to reverse geocode', 400));
  }
});

/**
 * Hybrid address lookup - supports both digital address and GPS coordinates
 * POST /api/v1/location/lookup
 * Body: { digitalAddress?: string, lat?: number, lng?: number }
 */
exports.lookupAddress = catchAsync(async (req, res, next) => {
  const { digitalAddress, lat, lng } = req.body;

  // Option A: User entered a digital address manually
  if (digitalAddress) {
    try {
      const result = await hybridAddressResolver.resolveFullAddress(digitalAddress);
      return res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      return next(new AppError(error.message || 'Failed to resolve digital address', 400));
    }
  }

  // Option B: Use GPS coordinates
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return next(new AppError('Invalid latitude or longitude values', 400));
    }

    // Validate coordinates are within Ghana's bounds
    if (latitude < 4 || latitude > 12 || longitude < -4 || longitude > 2) {
      return next(new AppError('Coordinates are outside Ghana', 400));
    }

    try {
      const result = await hybridAddressResolver.resolveAddressFromCoordinates(latitude, longitude);
      return res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      return next(new AppError(error.message || 'Failed to resolve address from coordinates', 400));
    }
  }

  return next(new AppError('Provide digitalAddress or coordinates (lat, lng)', 400));
});

/**
 * Full location resolution from GPS coordinates
 * Generates GhanaPostGPS digital address and reverse geocodes with Google Maps
 * POST /api/v1/location/full-location
 */
exports.fullLocation = catchAsync(async (req, res, next) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return next(new AppError('Invalid latitude or longitude values', 400));
  }

  // Validate coordinates are within Ghana's bounds
  if (latitude < 4 || latitude > 12 || longitude < -4 || longitude > 2) {
    return next(new AppError('Coordinates are outside Ghana', 400));
  }

  try {
    const result = await hybridLocationResolver.resolveFullLocation(latitude, longitude);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to resolve full location', 400));
  }
});

/**
 * Get location from GPS coordinates using Google Maps Reverse Geocoding
 * POST /api/v1/location/from-gps
 */
exports.getLocationFromGPS = catchAsync(async (req, res, next) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return next(new AppError('Invalid latitude or longitude values', 400));
  }

  try {
    const data = await reverseGeocodeSimple(latitude, longitude);

    if (!data) {
      return next(new AppError('No address found for the provided coordinates', 404));
    }

    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    return next(new AppError(error.message || 'Failed to get location from GPS', 400));
  }
});

