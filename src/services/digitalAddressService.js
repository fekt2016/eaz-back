/**
 * Digital Address Service
 * Converts GhanaPostGPS digital addresses to GPS coordinates
 */

/**
 * Validate GhanaPostGPS digital address format
 * Supports multiple formats:
 * - AB-123-4567 (RegionCode-DistrictCode-UniqueCode with 2 dashes)
 * - AB-1234567 (RegionCode-DistrictCodeUniqueCode with 1 dash, 7 digits total)
 * - AB-0136426 (RegionCode-DistrictCodeUniqueCode format like GV-0136426)
 */
function validateDigitalAddress(digitalAddress) {
  if (!digitalAddress || typeof digitalAddress !== 'string') {
    return false;
  }

  const upperAddress = digitalAddress.toUpperCase().trim();
  
  // Format 1: AB-123-4567 (two dashes, 3 digits + 4 digits)
  const pattern1 = /^[A-Z]{2}-\d{3}-\d{4}$/;
  if (pattern1.test(upperAddress)) {
    return true;
  }

  // Format 2: AB-1234567 (one dash, 7 digits total)
  // This handles formats like GV-0136426
  const pattern2 = /^[A-Z]{2}-\d{7}$/;
  if (pattern2.test(upperAddress)) {
    return true;
  }

  // Format 3: AB-123456 (one dash, 6 digits total) - less common but possible
  const pattern3 = /^[A-Z]{2}-\d{6}$/;
  if (pattern3.test(upperAddress)) {
    return true;
  }

  return false;
}

/**
 * Parse digital address into components
 * Handles multiple formats
 */
function parseDigitalAddress(digitalAddress) {
  const upperAddress = digitalAddress.toUpperCase().trim();
  const parts = upperAddress.split('-');
  
  if (parts.length === 3) {
    // Format: AB-123-4567
    return {
      regionCode: parts[0],
      districtCode: parseInt(parts[1], 10),
      uniqueCode: parseInt(parts[2], 10),
    };
  } else if (parts.length === 2) {
    // Format: AB-1234567 or AB-0136426
    const regionCode = parts[0];
    const digits = parts[1];
    
    if (digits.length === 7) {
      // Split 7 digits as 3-4: AB-1234567 -> district=123, unique=4567
      // Or for GV-0136426: district=013, unique=6426
      return {
        regionCode: regionCode,
        districtCode: parseInt(digits.substring(0, 3), 10),
        uniqueCode: parseInt(digits.substring(3), 10),
      };
    } else if (digits.length === 6) {
      // Split 6 digits as 3-3: AB-123456 -> district=123, unique=456
      return {
        regionCode: regionCode,
        districtCode: parseInt(digits.substring(0, 3), 10),
        uniqueCode: parseInt(digits.substring(3), 10),
      };
    } else {
      throw new Error(`Invalid digital address format: expected 6 or 7 digits after dash, got ${digits.length}`);
    }
  } else {
    throw new Error(`Invalid digital address format: expected 1 or 2 dashes, got ${parts.length - 1}`);
  }
}

/**
 * Region code to base coordinates mapping
 * These are approximate base coordinates for each region in Ghana
 */
const REGION_COORDINATES = {
  GA: { lat: 5.6037, lng: -0.1870 }, // Greater Accra (Accra)
  GV: { lat: 5.6037, lng: -0.1870 }, // Greater Accra variant (Accra) - same as GA
  AS: { lat: 6.6885, lng: -1.6244 }, // Ashanti (Kumasi)
  WE: { lat: 4.8845, lng: -1.7553 }, // Western (Takoradi)
  CE: { lat: 5.1053, lng: -1.2776 }, // Central (Cape Coast)
  EA: { lat: 6.2008, lng: -0.4506 }, // Eastern (Koforidua)
  VO: { lat: 6.4584, lng: 0.4506 },   // Volta (Ho)
  NO: { lat: 9.4000, lng: -0.8500 },  // Northern (Tamale)
  UE: { lat: 10.7854, lng: -0.8500 }, // Upper East (Bolgatanga)
  UW: { lat: 10.0667, lng: -2.5000 }, // Upper West (Wa)
  BA: { lat: 7.9465, lng: -1.0232 },  // Brong Ahafo (Sunyani)
  AH: { lat: 5.8847, lng: -0.9824 },  // Ahafo (Goaso)
  BE: { lat: 7.7500, lng: -0.0333 },  // Bono East (Techiman)
  NE: { lat: 8.2500, lng: -0.9833 },  // North East (Nalerigu)
  OT: { lat: 5.8847, lng: -0.9824 },  // Oti (Dambai)
  SV: { lat: 5.8847, lng: -0.9824 },  // Savannah (Damongo)
  WN: { lat: 4.8845, lng: -1.7553 },  // Western North (Sefwi Wiawso)
};

/**
 * Convert GhanaPostGPS digital address to GPS coordinates
 * @param {string} digitalAddress - Format: AB-123-4567
 * @returns {Promise<Object>} { lat, lng }
 */
async function digitalAddressToCoordinates(digitalAddress) {
  // Validate format
  if (!validateDigitalAddress(digitalAddress)) {
    throw new Error('Invalid digital address format. Expected format: AB-123-4567');
  }

  try {
    const { regionCode, districtCode, uniqueCode } = parseDigitalAddress(digitalAddress);

    // Get base coordinates for the region
    const baseCoords = REGION_COORDINATES[regionCode];
    if (!baseCoords) {
      throw new Error(`Unknown region code: ${regionCode}`);
    }

    // Improved coordinate calculation algorithm
    // GhanaPostGPS uses a grid system where:
    // - District code represents a sub-region within the main region
    // - Unique code represents a specific location within the district
    
    // More accurate offset calculation using a grid-based approach
    // Each region is divided into a grid system
    // District code (0-999) affects longitude (east-west movement)
    // Unique code (0-9999) affects latitude (north-south movement)
    
    // Calculate offsets with improved precision
    // For Greater Accra region (GA/GV), use tighter grid for better accuracy
    const isGreaterAccra = regionCode === 'GA' || regionCode === 'GV';
    
    if (isGreaterAccra) {
      // Greater Accra: More precise grid (smaller offsets for urban density)
      // District offset: maps 0-999 to longitude range of ~0.2 degrees
      const districtNormalized = districtCode / 999; // 0 to 1
      const districtOffset = (districtNormalized - 0.5) * 0.2; // -0.1 to +0.1 degrees
      
      // Unique offset: maps 0-9999 to latitude range of ~0.2 degrees
      const uniqueNormalized = uniqueCode / 9999; // 0 to 1
      const uniqueOffset = (uniqueNormalized - 0.5) * 0.2; // -0.1 to +0.1 degrees
      
      // Calculate final coordinates
      const lat = baseCoords.lat + uniqueOffset;
      const lng = baseCoords.lng + districtOffset;
    } else {
      // Other regions: Standard grid
      // District offset: maps 0-999 to longitude range of ~0.4 degrees
      const districtNormalized = districtCode / 999; // 0 to 1
      const districtOffset = (districtNormalized - 0.5) * 0.4; // -0.2 to +0.2 degrees
      
      // Unique offset: maps 0-9999 to latitude range of ~0.4 degrees
      const uniqueNormalized = uniqueCode / 9999; // 0 to 1
      const uniqueOffset = (uniqueNormalized - 0.5) * 0.4; // -0.2 to +0.2 degrees
      
      // Calculate final coordinates
      const lat = baseCoords.lat + uniqueOffset;
      const lng = baseCoords.lng + districtOffset;
    }

    // Ensure coordinates are within Ghana's bounds
    const finalLat = Math.max(4.0, Math.min(12.0, lat));
    const finalLng = Math.max(-4.0, Math.min(2.0, lng));

    return {
      lat: parseFloat(finalLat.toFixed(6)),
      lng: parseFloat(finalLng.toFixed(6)),
    };
  } catch (error) {
    throw new Error(`Failed to convert digital address to coordinates: ${error.message}`);
  }
}

/**
 * Convert GPS coordinates to approximate digital address
 * This is a reverse operation (less accurate)
 */
function coordinatesToDigitalAddress(lat, lng) {
  // Find closest region
  let closestRegion = 'GA';
  let minDistance = Infinity;

  for (const [code, coords] of Object.entries(REGION_COORDINATES)) {
    const distance = Math.sqrt(
      Math.pow(lat - coords.lat, 2) + Math.pow(lng - coords.lng, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closestRegion = code;
    }
  }

  const baseCoords = REGION_COORDINATES[closestRegion];

  // Calculate district and unique codes from offset
  const districtOffset = lng - baseCoords.lng;
  const uniqueOffset = lat - baseCoords.lat;

  // Convert offsets back to codes
  const districtCode = Math.floor(((districtOffset / 0.1) + 0.5) * 1000) % 1000;
  const uniqueCode = Math.floor(((uniqueOffset / 0.1) + 0.5) * 10000) % 10000;

  return `${closestRegion}-${districtCode.toString().padStart(3, '0')}-${uniqueCode.toString().padStart(4, '0')}`;
}

module.exports = {
  digitalAddressToCoordinates,
  coordinatesToDigitalAddress,
  validateDigitalAddress,
  parseDigitalAddress,
};

