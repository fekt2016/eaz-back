const { generateGhanaPostAddress } = require('../utils/gpsToGhanaPost');
const { reverseGeocode } = require('./googleMapsService');

/**
 * Hybrid Location Resolver
 * Combines GPS → GhanaPostGPS Digital Address + Google Maps Reverse Geocoding
 * to produce a complete, accurate location result
 */

/**
 * Determine shipping zone based on city and region
 * @param {string} city - City name
 * @param {string} region - Region name
 * @returns {string} Zone A, B, or C
 */
function determineShippingZone(city, region) {
  if (!city && !region) {
    return 'C'; // Default to Zone C
  }

  const cityUpper = (city || '').toUpperCase();
  const regionUpper = (region || '').toUpperCase();

  // Zone A: Accra core areas and Tema core
  if (
    (cityUpper === 'ACCRA' &&
      (cityUpper.includes('OSU') ||
        cityUpper.includes('EAST LEGON') ||
        cityUpper.includes('LABONE') ||
        cityUpper.includes('CANTONMENTS') ||
        cityUpper.includes('AIRPORT') ||
        cityUpper.includes('NIMA') ||
        cityUpper.includes('ADABRAKA'))) ||
    (cityUpper === 'TEMA' &&
      (cityUpper.includes('COMMUNITY 1') ||
        cityUpper.includes('COMMUNITY 2') ||
        cityUpper.includes('COMMUNITY 3') ||
        cityUpper.includes('COMMUNITY 4')))
  ) {
    return 'A';
  }

  // Zone B: Greater Accra outskirts and nearby cities
  if (
    regionUpper.includes('GREATER ACCRA') ||
    cityUpper === 'TEMA' ||
    cityUpper === 'KASOA' ||
    cityUpper === 'MADINA' ||
    cityUpper === 'ADENTA' ||
    cityUpper === 'DODOWA' ||
    cityUpper === 'AMASAMAN' ||
    cityUpper === 'SPINTEX' ||
    cityUpper === 'ACHIMOTA'
  ) {
    return 'B';
  }

  // Zone C: All other regions
  return 'C';
}

/**
 * Resolve full location from GPS coordinates
 * Combines GhanaPostGPS digital address generation with Google Maps reverse geocoding
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Complete location object
 */
async function resolveFullLocation(lat, lng) {
  try {
    // Step 1: Generate GhanaPostGPS digital address from coordinates
    const digitalAddress = generateGhanaPostAddress(lat, lng);
    
    console.log(`[Hybrid Resolver] Generated Digital Address: ${digitalAddress} from coordinates: ${lat}, ${lng}`);

    // Step 2: Reverse geocode coordinates using Google Maps
    const googleData = await reverseGeocode(lat, lng);
    
    console.log(`[Hybrid Resolver] Google Maps Response:`, {
      street: googleData?.street,
      town: googleData?.town,
      city: googleData?.city,
      region: googleData?.region,
      formattedAddress: googleData?.formattedAddress,
    });

    if (!googleData) {
      throw new Error('Failed to reverse geocode coordinates');
    }

    // Step 3: Determine shipping zone
    const zone = determineShippingZone(googleData.city, googleData.region);

    // Step 4: Combine and return complete location
    const result = {
      digitalAddress,
      streetAddress: googleData.street || null,
      town: googleData.town || null,
      city: googleData.city || null,
      region: googleData.region || null,
      country: googleData.country || null,
      formattedAddress: googleData.formattedAddress || null,
      coordinates: {
        lat,
        lng,
      },
      zone,
      placeId: googleData.placeId || null,
    };
    
    console.log(`[Hybrid Resolver] Final Result:`, result);
    
    return result;
  } catch (error) {
    console.error(`[Hybrid Resolver] Error resolving location:`, error);
    throw new Error(`Failed to resolve full location: ${error.message}`);
  }
}

module.exports = {
  resolveFullLocation,
  determineShippingZone,
};

