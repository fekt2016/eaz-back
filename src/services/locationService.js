const { lookupDigitalAddress } = require('../utils/helpers/digitalAddressHelper');

/**
 * Location Service
 * Handles digital address validation, conversion, and reverse geocoding
 */

/**
 * Validate GhanaPostGPS digital address format
 * Format: XX-XXX-XXXX (RegionCode-DistrictCode-UniqueCode)
 * Examples: GA-492-8893, AS-123-4567
 */
function validateDigitalAddress(digitalAddress) {
  if (!digitalAddress || typeof digitalAddress !== 'string') {
    return { valid: false, error: 'Digital address is required' };
  }

  // Remove spaces and convert to uppercase
  const cleaned = digitalAddress.trim().toUpperCase().replace(/\s+/g, '');

  // Pattern: 2 letters, dash, 3 digits, dash, 4 digits
  const pattern = /^([A-Z]{2})-(\d{3})-(\d{4})$/;

  if (!pattern.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid format. Expected format: XX-XXX-XXXX (e.g., GA-492-8893)',
    };
  }

  const match = cleaned.match(pattern);
  const regionCode = match[1];
  const districtCode = match[2];
  const uniqueCode = match[3];

  // Validate region codes (common Ghana regions)
  const validRegionCodes = [
    'GA', // Greater Accra
    'AS', // Ashanti
    'WE', // Western
    'CE', // Central
    'EA', // Eastern
    'VO', // Volta
    'NO', // Northern
    'UE', // Upper East
    'UW', // Upper West
    'BA', // Brong Ahafo
    'AH', // Ahafo
    'BO', // Bono
    'OT', // Oti
    'NE', // North East
    'SA', // Savannah
    'WE', // Western North
  ];

  if (!validRegionCodes.includes(regionCode)) {
    return {
      valid: false,
      error: `Invalid region code: ${regionCode}. Must be a valid Ghana region code.`,
    };
  }

  return {
    valid: true,
    cleaned,
    regionCode,
    districtCode,
    uniqueCode,
  };
}

/**
 * Convert GhanaPostGPS digital address to GPS coordinates
 * This is a mock implementation - in production, use actual GhanaPostGPS API
 */
function digitalAddressToCoordinates(digitalAddress) {
  const validation = validateDigitalAddress(digitalAddress);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const { regionCode, districtCode, uniqueCode } = validation;

  // Mock conversion logic based on region codes
  // In production, this would call the GhanaPostGPS API

  // Base coordinates for major regions
  const regionBases = {
    GA: { lat: 5.6037, lng: -0.1870 }, // Accra
    AS: { lat: 6.6885, lng: -1.6244 }, // Kumasi
    WE: { lat: 4.8845, lng: -1.7554 }, // Takoradi
    CE: { lat: 5.1053, lng: -1.2466 }, // Cape Coast
    EA: { lat: 6.2374, lng: -0.4502 }, // Koforidua
    VO: { lat: 6.2048, lng: 0.4773 }, // Ho
    NO: { lat: 9.4000, lng: -0.8397 }, // Tamale
    UE: { lat: 10.7855, lng: -0.8513 }, // Bolgatanga
    UW: { lat: 10.4826, lng: -2.5079 }, // Wa
  };

  const base = regionBases[regionCode] || { lat: 5.6037, lng: -0.1870 }; // Default to Accra

  // Add variation based on district and unique codes
  const districtOffset = (parseInt(districtCode) % 100) / 1000; // ±0.1 degrees
  const uniqueOffset = (parseInt(uniqueCode) % 1000) / 10000; // ±0.01 degrees

  const latitude = base.lat + districtOffset;
  const longitude = base.lng + uniqueOffset;

  return {
    latitude: parseFloat(latitude.toFixed(6)),
    longitude: parseFloat(longitude.toFixed(6)),
  };
}

/**
 * Convert GPS coordinates to detailed physical address using reverse geocoding
 * This uses the existing lookupDigitalAddress helper and enhances it
 */
async function coordinatesToPhysicalAddress(latitude, longitude, digitalAddress) {
  // First, try to get address from digital address lookup
  let addressData = null;
  try {
    addressData = await lookupDigitalAddress(digitalAddress);
  } catch (error) {
    console.warn('Digital address lookup failed, using coordinates only:', error.message);
  }

  // If we have address data, enhance it with coordinates
  if (addressData) {
    return {
      ...addressData,
      latitude,
      longitude,
      digitalAddress,
    };
  }

  // Fallback: Use coordinate-based reverse geocoding
  // In production, integrate with Google Maps Geocoding API or similar
  return getAddressFromCoordinates(latitude, longitude, digitalAddress);
}

/**
 * Fallback: Get address details from coordinates
 * This is a mock implementation - in production, use Google Maps API
 */
function getAddressFromCoordinates(lat, lng, digitalAddress) {
  // Determine city based on coordinates
  let city = 'ACCRA';
  let region = 'Greater Accra';
  let town = 'Unknown';
  let district = 'Unknown';

  // Greater Accra region
  if (lat >= 5.4 && lat <= 6.0 && lng >= -0.4 && lng <= 0.3) {
    city = 'ACCRA';
    region = 'Greater Accra';
    
    // Determine town/district within Accra
    if (lat >= 5.55 && lat <= 5.65 && lng >= -0.25 && lng <= -0.1) {
      town = 'Osu';
      district = 'Osu Klottey';
    } else if (lat >= 5.6 && lat <= 5.7 && lng >= -0.15 && lng <= -0.05) {
      town = 'East Legon';
      district = 'La Nkwantanang Madina';
    } else if (lat >= 5.5 && lat <= 5.6 && lng >= -0.2 && lng <= -0.1) {
      town = 'Labone';
      district = 'La';
    } else {
      town = 'Accra Central';
      district = 'Accra Metropolitan';
    }
  }
  // Ashanti region (Kumasi)
  else if (lat >= 6.6 && lat <= 6.8 && lng >= -1.7 && lng <= -1.5) {
    city = 'KUMASI';
    region = 'Ashanti';
    town = 'Kumasi';
    district = 'Kumasi Metropolitan';
  }
  // Western region (Takoradi)
  else if (lat >= 4.8 && lat <= 5.0 && lng >= -1.8 && lng <= -1.6) {
    city = 'TAKORADI';
    region = 'Western';
    town = 'Takoradi';
    district = 'Sekondi-Takoradi Metropolitan';
  }
  // Central region (Cape Coast)
  else if (lat >= 5.1 && lat <= 5.3 && lng >= -1.3 && lng <= -1.1) {
    city = 'CAPE COAST';
    region = 'Central';
    town = 'Cape Coast';
    district = 'Cape Coast Metropolitan';
  }
  // Tema
  else if (lat >= 5.65 && lat <= 5.75 && lng >= 0.0 && lng <= 0.1) {
    city = 'TEMA';
    region = 'Greater Accra';
    town = 'Tema';
    district = 'Tema Metropolitan';
  }
  // Kasoa
  else if (lat >= 5.5 && lat <= 5.6 && lng >= -0.45 && lng <= -0.35) {
    city = 'KASOA';
    region = 'Central';
    town = 'Kasoa';
    district = 'Awutu Senya East';
  }

  // Generate street address based on coordinates
  const streetNumber = Math.floor((lat * 1000) % 1000);
  const streetName = ['Main Street', 'High Street', 'Ring Road', 'Independence Avenue', 'Oxford Street'][
    Math.floor((lng * 100) % 5)
  ];

  return {
    digitalAddress,
    streetAddress: `${streetNumber} ${streetName}`,
    town,
    city,
    region: region.toLowerCase(),
    district,
    postalArea: city,
    latitude: lat,
    longitude: lng,
    nearestLandmark: `${town} Market`,
    zone: determineZone(city, region),
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
 * Merge address data from multiple sources
 * Prioritizes digital address lookup, falls back to coordinate-based lookup
 */
function mergeAddressSources(primaryData, fallbackData) {
  return {
    digitalAddress: primaryData?.digitalAddress || fallbackData?.digitalAddress || '',
    streetAddress: primaryData?.streetAddress || fallbackData?.streetAddress || '',
    town: primaryData?.town || fallbackData?.town || '',
    city: primaryData?.city || fallbackData?.city || '',
    region: primaryData?.region || fallbackData?.region || '',
    district: primaryData?.district || fallbackData?.district || '',
    postalArea: primaryData?.postalArea || fallbackData?.postalArea || '',
    latitude: primaryData?.latitude || fallbackData?.latitude || null,
    longitude: primaryData?.longitude || fallbackData?.longitude || null,
    nearestLandmark: primaryData?.nearestLandmark || fallbackData?.nearestLandmark || '',
    zone: primaryData?.zone || fallbackData?.zone || 'C',
  };
}

/**
 * Main function: Lookup full address details from digital address
 */
async function lookupDigitalAddressFull(digitalAddress) {
  // Step 1: Validate digital address format
  const validation = validateDigitalAddress(digitalAddress);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Step 2: Convert digital address to coordinates
  const coordinates = digitalAddressToCoordinates(validation.cleaned);

  // Step 3: Get physical address from coordinates
  const addressData = await coordinatesToPhysicalAddress(
    coordinates.latitude,
    coordinates.longitude,
    validation.cleaned
  );

  // Step 4: Ensure zone is determined
  if (!addressData.zone) {
    addressData.zone = determineZone(addressData.city, addressData.region);
  }

  return addressData;
}

module.exports = {
  validateDigitalAddress,
  digitalAddressToCoordinates,
  coordinatesToPhysicalAddress,
  determineZone,
  mergeAddressSources,
  lookupDigitalAddressFull,
};

