const axios = require('axios');
const locationService = require('./locationService');
const logger = require('../utils/logger');

/**
 * Hybrid Location Resolver
 * Combines GPS coordinates, GhanaPostGPS, and Google Maps for accurate address resolution
 */

/**
 * Reverse geocode coordinates using Google Maps API
 * Falls back to mock data if API key is not available
 */
async function reverseGeocodeWithGoogleMaps(latitude, longitude) {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    logger.warn('Google Maps API key not found, using mock reverse geocoding');
    return mockGoogleMapsReverseGeocode(latitude, longitude);
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${latitude},${longitude}`,
        key: googleMapsApiKey,
        region: 'gh', // Bias results to Ghana
      },
      timeout: 5000,
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      return parseGoogleMapsResponse(response.data.results[0]);
    } else {
      logger.warn('Google Maps API returned no results, using mock data');
      return mockGoogleMapsReverseGeocode(latitude, longitude);
    }
  } catch (error) {
    logger.error('Google Maps API error:', error.message);
    logger.warn('Falling back to mock reverse geocoding');
    return mockGoogleMapsReverseGeocode(latitude, longitude);
  }
}

/**
 * Parse Google Maps geocoding response into structured address
 */
function parseGoogleMapsResponse(result) {
  const addressComponents = result.address_components;
  const geometry = result.geometry;

  // Extract address components
  let streetAddress = '';
  let town = '';
  let city = '';
  let region = '';
  let district = '';
  let postalCode = '';

  for (const component of addressComponents) {
    const types = component.types;

    if (types.includes('street_number') || types.includes('route')) {
      streetAddress = component.long_name + (streetAddress ? ' ' + streetAddress : '');
    }
    if (types.includes('sublocality') || types.includes('sublocality_level_1')) {
      town = component.long_name;
    }
    if (types.includes('neighborhood')) {
      if (!town) town = component.long_name;
    }
    if (types.includes('locality')) {
      city = component.long_name;
    }
    if (types.includes('administrative_area_level_1')) {
      region = component.long_name;
    }
    if (types.includes('administrative_area_level_2')) {
      district = component.long_name;
    }
    if (types.includes('postal_code')) {
      postalCode = component.long_name;
    }
  }

  // Fallback: use formatted_address if streetAddress is empty
  if (!streetAddress && result.formatted_address) {
    const parts = result.formatted_address.split(',');
    streetAddress = parts[0] || '';
  }

  return {
    streetAddress: streetAddress || '',
    town: town || '',
    city: city || '',
    region: region.toLowerCase() || '',
    district: district || '',
    postalCode: postalCode || '',
    formattedAddress: result.formatted_address || '',
    latitude: geometry.location.lat,
    longitude: geometry.location.lng,
    placeId: result.place_id || '',
  };
}

/**
 * Mock Google Maps reverse geocoding (fallback when API is unavailable)
 */
function mockGoogleMapsReverseGeocode(lat, lng) {
  // Determine location based on coordinates
  let streetAddress = '';
  let town = '';
  let city = '';
  let region = '';
  let district = '';

  // Greater Accra region
  if (lat >= 5.4 && lat <= 6.0 && lng >= -0.4 && lng <= 0.3) {
    city = 'Accra';
    region = 'Greater Accra';
    
    if (lat >= 5.55 && lat <= 5.65 && lng >= -0.25 && lng <= -0.1) {
      town = 'Osu';
      district = 'Osu Klottey';
      streetAddress = `${Math.floor((lat * 1000) % 100)} Oxford Street`;
    } else if (lat >= 5.6 && lat <= 5.7 && lng >= -0.15 && lng <= -0.05) {
      town = 'East Legon';
      district = 'La Nkwantanang Madina';
      streetAddress = `${Math.floor((lat * 1000) % 100)} Legon Road`;
    } else if (lat >= 5.5 && lat <= 5.6 && lng >= -0.2 && lng <= -0.1) {
      town = 'Labone';
      district = 'La';
      streetAddress = `${Math.floor((lat * 1000) % 100)} Labone Road`;
    } else {
      town = 'Accra Central';
      district = 'Accra Metropolitan';
      streetAddress = `${Math.floor((lat * 1000) % 100)} High Street`;
    }
  }
  // Ashanti region (Kumasi)
  else if (lat >= 6.6 && lat <= 6.8 && lng >= -1.7 && lng <= -1.5) {
    city = 'Kumasi';
    region = 'Ashanti';
    town = 'Kumasi';
    district = 'Kumasi Metropolitan';
    streetAddress = `${Math.floor((lat * 1000) % 100)} Kejetia Road`;
  }
  // Western region (Takoradi)
  else if (lat >= 4.8 && lat <= 5.0 && lng >= -1.8 && lng <= -1.6) {
    city = 'Takoradi';
    region = 'Western';
    town = 'Takoradi';
    district = 'Sekondi-Takoradi Metropolitan';
    streetAddress = `${Math.floor((lat * 1000) % 100)} Market Circle Road`;
  }
  // Central region (Cape Coast)
  else if (lat >= 5.1 && lat <= 5.3 && lng >= -1.3 && lng <= -1.1) {
    city = 'Cape Coast';
    region = 'Central';
    town = 'Cape Coast';
    district = 'Cape Coast Metropolitan';
    streetAddress = `${Math.floor((lat * 1000) % 100)} Kotokuraba Road`;
  }
  // Tema
  else if (lat >= 5.65 && lat <= 5.75 && lng >= 0.0 && lng <= 0.1) {
    city = 'Tema';
    region = 'Greater Accra';
    town = 'Tema';
    district = 'Tema Metropolitan';
    streetAddress = `${Math.floor((lat * 1000) % 100)} Community 1 Road`;
  }
  // Kasoa
  else if (lat >= 5.5 && lat <= 5.6 && lng >= -0.45 && lng <= -0.35) {
    city = 'Kasoa';
    region = 'Central';
    town = 'Kasoa';
    district = 'Awutu Senya East';
    streetAddress = `${Math.floor((lat * 1000) % 100)} Kasoa Road`;
  }
  // Default fallback
  else {
    city = 'Accra';
    region = 'Greater Accra';
    town = 'Unknown';
    district = 'Unknown';
    streetAddress = `${Math.floor((lat * 1000) % 100)} Main Street`;
  }

  return {
    streetAddress,
    town,
    city,
    region: region.toLowerCase(),
    district,
    postalCode: '',
    formattedAddress: `${streetAddress}, ${town}, ${city}, ${region}`,
    latitude: lat,
    longitude: lng,
    placeId: '',
  };
}

/**
 * Get GPS coordinates with high accuracy
 * This would be called from the frontend, but we validate here
 */
function validateGPSAccuracy(latitude, longitude) {
  // Check if coordinates are within Ghana's bounds
  if (latitude < 4 || latitude > 12 || longitude < -4 || longitude > 2) {
    return {
      valid: false,
      error: 'Coordinates are outside Ghana',
    };
  }

  // Check if coordinates seem reasonable (not 0,0 or extreme values)
  if (latitude === 0 && longitude === 0) {
    return {
      valid: false,
      error: 'Invalid GPS coordinates (0,0)',
    };
  }

  return {
    valid: true,
  };
}

/**
 * Determine shipping zone based on city and region
 */
function determineZone(city, region) {
  const cityUpper = city.toUpperCase();
  const regionUpper = region.toUpperCase();

  // Zone A: Accra core areas
  if (
    cityUpper === 'ACCRA' &&
    (cityUpper.includes('OSU') ||
      cityUpper.includes('EAST LEGON') ||
      cityUpper.includes('LABONE') ||
      cityUpper.includes('CANTONMENTS') ||
      cityUpper.includes('AIRPORT'))
  ) {
    return 'A';
  }

  // Zone B: Greater Accra outskirts and nearby cities
  if (
    regionUpper.includes('GREATER ACCRA') ||
    cityUpper === 'TEMA' ||
    cityUpper === 'KASOA' ||
    cityUpper === 'MADINA' ||
    cityUpper === 'ADENTA'
  ) {
    return 'B';
  }

  // Zone C: All other regions
  return 'C';
}

/**
 * Main hybrid lookup function
 * Combines GPS → GhanaPostGPS → Google Maps → Merged result
 */
async function hybridLocationLookup(latitude, longitude) {
  // Step 1: Validate GPS coordinates
  const validation = validateGPSAccuracy(latitude, longitude);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Step 2: Convert GPS to GhanaPostGPS digital address
  let digitalAddress = '';
  let districtFromDigitalAddress = '';
  
  try {
    // Use the existing locationService to convert coordinates to digital address
    const digitalAddressResult = locationService.digitalAddressToCoordinates(
      `${latitude},${longitude}`
    );
    
    // Reverse: convert coordinates back to digital address format
    // This is a simplified approach - in production, use actual GhanaPostGPS API
    const regionCode = determineRegionCode(latitude, longitude);
    const districtCode = Math.floor((Math.abs(longitude) * 100) % 1000).toString().padStart(3, '0');
    const uniqueCode = Math.floor((Math.abs(latitude) * 1000) % 10000).toString().padStart(4, '0');
    digitalAddress = `${regionCode}-${districtCode}-${uniqueCode}`;
    
    // Get district from digital address lookup
    try {
      const digitalAddressData = await locationService.lookupDigitalAddressFull(digitalAddress);
      districtFromDigitalAddress = digitalAddressData.district || '';
    } catch (error) {
      logger.warn('Could not get district from digital address:', error.message);
    }
  } catch (error) {
    logger.warn('Digital address conversion failed:', error.message);
  }

  // Step 3: Reverse geocode with Google Maps
  const googleMapsData = await reverseGeocodeWithGoogleMaps(latitude, longitude);

  // Step 4: Merge results intelligently
  const mergedResult = {
    // Always use Google Maps for these fields (more accurate)
    streetAddress: googleMapsData.streetAddress || '',
    town: googleMapsData.town || googleMapsData.neighborhood || '',
    city: googleMapsData.city || '',
    region: googleMapsData.region || '',
    
    // Use GhanaPostGPS for digital address
    digitalAddress: digitalAddress || '',
    
    // Prefer Google Maps district, fallback to digital address district
    district: googleMapsData.district || districtFromDigitalAddress || '',
    
    // Coordinates from GPS
    latitude: latitude,
    longitude: longitude,
    
    // Additional data
    postalCode: googleMapsData.postalCode || '',
    formattedAddress: googleMapsData.formattedAddress || '',
    placeId: googleMapsData.placeId || '',
    
    // Determine zone based on merged city/region
    zone: determineZone(googleMapsData.city || '', googleMapsData.region || ''),
  };

  return mergedResult;
}

/**
 * Determine region code from coordinates
 */
function determineRegionCode(lat, lng) {
  // Greater Accra: lat ~5.5-6.0, lng ~-0.3-0.3
  if (lat >= 5.5 && lat <= 6.0 && lng >= -0.3 && lng <= 0.3) {
    return 'GA';
  }
  // Ashanti (Kumasi): lat ~6.6-6.8, lng ~-1.7-1.5
  if (lat >= 6.6 && lat <= 6.8 && lng >= -1.7 && lng <= -1.5) {
    return 'AS';
  }
  // Western (Takoradi): lat ~4.8-5.0, lng ~-1.8-1.6
  if (lat >= 4.8 && lat <= 5.0 && lng >= -1.8 && lng <= -1.6) {
    return 'WE';
  }
  // Central (Cape Coast): lat ~5.1-5.3, lng ~-1.3-1.1
  if (lat >= 5.1 && lat <= 5.3 && lng >= -1.3 && lng <= -1.1) {
    return 'CE';
  }
  // Default to Greater Accra
  return 'GA';
}

module.exports = {
  hybridLocationLookup,
  reverseGeocodeWithGoogleMaps,
  validateGPSAccuracy,
  determineZone,
};

