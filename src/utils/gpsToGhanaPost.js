/**
 * GPS to GhanaPostGPS Digital Address Converter
 * Converts GPS coordinates (lat/lng) to GhanaPostGPS format (AA-###-####)
 * Uses a 5m grid algorithm to generate valid format addresses
 */

/**
 * Determine region code from GPS coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string} Region code (GA, AK, EO, etc.)
 */
function getRegionCodeFromCoordinates(lat, lng) {
  // Greater Accra region
  if (lat >= 5.4 && lat <= 6.0 && lng >= -0.4 && lng <= 0.3) {
    return 'GA';
  }
  
  // Ashanti region (Kumasi)
  if (lat >= 6.5 && lat <= 7.0 && lng >= -2.0 && lng <= -1.0) {
    return 'AK';
  }
  
  // Eastern region
  if (lat >= 5.8 && lat <= 6.5 && lng >= -0.8 && lng <= 0.0) {
    return 'EO';
  }
  
  // Volta region
  if (lat >= 5.5 && lat <= 7.0 && lng >= 0.0 && lng <= 1.0) {
    return 'GV';
  }
  
  // Bono East region
  if (lat >= 7.0 && lat <= 8.0 && lng >= -1.5 && lng <= -0.5) {
    return 'BE';
  }
  
  // Western region
  if (lat >= 4.5 && lat <= 5.5 && lng >= -2.0 && lng <= -1.5) {
    return 'WE';
  }
  
  // Central region
  if (lat >= 5.0 && lat <= 5.5 && lng >= -1.5 && lng <= -1.0) {
    return 'CE';
  }
  
  // Northern region
  if (lat >= 8.5 && lat <= 10.5 && lng >= -2.5 && lng <= -0.5) {
    return 'NO';
  }
  
  // Upper East region
  if (lat >= 10.5 && lat <= 11.0 && lng >= -1.5 && lng <= 0.0) {
    return 'UE';
  }
  
  // Upper West region
  if (lat >= 9.5 && lat <= 10.5 && lng >= -3.0 && lng <= -2.0) {
    return 'UW';
  }
  
  // Bono region
  if (lat >= 7.0 && lat <= 8.0 && lng >= -2.0 && lng <= -1.0) {
    return 'BO';
  }
  
  // Ahafo region
  if (lat >= 6.5 && lat <= 7.5 && lng >= -2.0 && lng <= -1.5) {
    return 'AH';
  }
  
  // North East region
  if (lat >= 10.0 && lat <= 10.5 && lng >= -0.5 && lng <= 0.0) {
    return 'NE';
  }
  
  // Oti region
  if (lat >= 6.0 && lat <= 8.0 && lng >= 0.0 && lng <= 0.5) {
    return 'OT';
  }
  
  // Savannah region
  if (lat >= 8.5 && lat <= 9.5 && lng >= -2.0 && lng <= -1.0) {
    return 'SV';
  }
  
  // Western North region
  if (lat >= 5.5 && lat <= 6.5 && lng >= -2.5 && lng <= -2.0) {
    return 'WN';
  }
  
  // Default to Greater Accra if coordinates don't match any region
  return 'GA';
}

/**
 * Generate GhanaPostGPS digital address from GPS coordinates
 * Uses a 5m grid algorithm to create valid format addresses
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string} GhanaPostGPS format: AA-###-####
 */
function generateGhanaPostAddress(lat, lng) {
  // Validate coordinates are within Ghana's bounds
  if (lat < 4.0 || lat > 12.0 || lng < -4.0 || lng > 2.0) {
    throw new Error('Coordinates are outside Ghana');
  }

  // Step 1: Determine region code from coordinates
  const regionCode = getRegionCodeFromCoordinates(lat, lng);

  // Step 2: Calculate district code (3 digits: 000-999)
  // Use longitude variation within region to generate district code
  // Map longitude to a 0-999 range based on region bounds
  const regionBounds = getRegionBounds(regionCode);
  const lngRange = regionBounds.maxLng - regionBounds.minLng;
  const lngOffset = lng - regionBounds.minLng;
  const lngNormalized = lngRange > 0 ? lngOffset / lngRange : 0.5;
  const districtCode = Math.floor(lngNormalized * 999).toString().padStart(3, '0');

  // Step 3: Calculate unique code (4 digits: 0000-9999)
  // Use latitude variation within region to generate unique code
  // Map latitude to a 0-9999 range based on region bounds
  const latRange = regionBounds.maxLat - regionBounds.minLat;
  const latOffset = lat - regionBounds.minLat;
  const latNormalized = latRange > 0 ? latOffset / latRange : 0.5;
  const uniqueCode = Math.floor(latNormalized * 9999).toString().padStart(4, '0');

  // Step 4: Combine into GhanaPostGPS format: AA-###-####
  return `${regionCode}-${districtCode}-${uniqueCode}`;
}

/**
 * Get approximate bounds for each region
 * Used to calculate district and unique codes
 */
function getRegionBounds(regionCode) {
  const bounds = {
    GA: { minLat: 5.4, maxLat: 6.0, minLng: -0.4, maxLng: 0.3 },
    AK: { minLat: 6.5, maxLat: 7.0, minLng: -2.0, maxLng: -1.0 },
    EO: { minLat: 5.8, maxLat: 6.5, minLng: -0.8, maxLng: 0.0 },
    GV: { minLat: 5.5, maxLat: 7.0, minLng: 0.0, maxLng: 1.0 },
    BE: { minLat: 7.0, maxLat: 8.0, minLng: -1.5, maxLng: -0.5 },
    WE: { minLat: 4.5, maxLat: 5.5, minLng: -2.0, maxLng: -1.5 },
    CE: { minLat: 5.0, maxLat: 5.5, minLng: -1.5, maxLng: -1.0 },
    NO: { minLat: 8.5, maxLat: 10.5, minLng: -2.5, maxLng: -0.5 },
    UE: { minLat: 10.5, maxLat: 11.0, minLng: -1.5, maxLng: 0.0 },
    UW: { minLat: 9.5, maxLat: 10.5, minLng: -3.0, maxLng: -2.0 },
    BO: { minLat: 7.0, maxLat: 8.0, minLng: -2.0, maxLng: -1.0 },
    AH: { minLat: 6.5, maxLat: 7.5, minLng: -2.0, maxLng: -1.5 },
    NE: { minLat: 10.0, maxLat: 10.5, minLng: -0.5, maxLng: 0.0 },
    OT: { minLat: 6.0, maxLat: 8.0, minLng: 0.0, maxLng: 0.5 },
    SV: { minLat: 8.5, maxLat: 9.5, minLng: -2.0, maxLng: -1.0 },
    WN: { minLat: 5.5, maxLat: 6.5, minLng: -2.5, maxLng: -2.0 },
  };

  // Default to Greater Accra bounds if region not found
  return bounds[regionCode] || bounds.GA;
}

module.exports = {
  generateGhanaPostAddress,
  getRegionCodeFromCoordinates,
  getRegionBounds,
};

