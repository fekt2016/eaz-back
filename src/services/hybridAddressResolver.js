const { digitalAddressToCoordinates } = require('./digitalAddressService');
const { reverseGeocode } = require('./googleMapsService');

/**
 * Hybrid Address Resolver
 * Combines Ghana Digital Address and Google Maps Reverse Geocoding
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

  // Zone A: Accra core areas
  if (
    cityUpper === 'ACCRA' &&
    (cityUpper.includes('OSU') ||
      cityUpper.includes('EAST LEGON') ||
      cityUpper.includes('LABONE') ||
      cityUpper.includes('CANTONMENTS') ||
      cityUpper.includes('AIRPORT') ||
      cityUpper.includes('NIMA') ||
      cityUpper.includes('ADABRAKA'))
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
    cityUpper === 'AMASAMAN'
  ) {
    return 'B';
  }

  // Zone C: All other regions
  return 'C';
}

/**
 * Resolve full address from Ghana Digital Address
 * Combines digital address conversion with Google Maps reverse geocoding
 * @param {string} digitalAddress - GhanaPostGPS format: AB-123-4567
 * @returns {Promise<Object>} Complete address object
 */
async function resolveFullAddress(digitalAddress) {
  try {
    // Step 1: Convert digital address to coordinates
    const coordinates = await digitalAddressToCoordinates(digitalAddress);
    
    console.log(`[Hybrid Resolver] Digital Address: ${digitalAddress} -> Coordinates: ${coordinates.lat}, ${coordinates.lng}`);

    // Step 2: Reverse geocode coordinates using Google Maps
    const googleData = await reverseGeocode(coordinates.lat, coordinates.lng);
    
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

    // Step 4: Combine and return complete address
    const result = {
      digitalAddress,
      coordinates: {
        lat: coordinates.lat,
        lng: coordinates.lng,
      },
      streetAddress: googleData.street || null,
      town: googleData.town || null,
      city: googleData.city || null,
      region: googleData.region || null,
      country: googleData.country || null,
      formattedAddress: googleData.formattedAddress || null,
      zone,
      placeId: googleData.placeId || null,
    };
    
    console.log(`[Hybrid Resolver] Final Result:`, result);
    
    return result;
  } catch (error) {
    console.error(`[Hybrid Resolver] Error resolving address:`, error);
    throw new Error(`Failed to resolve full address: ${error.message}`);
  }
}

/**
 * Resolve address from GPS coordinates only
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Complete address object
 */
async function resolveAddressFromCoordinates(lat, lng) {
  try {
    // Reverse geocode using Google Maps
    const googleData = await reverseGeocode(lat, lng);

    if (!googleData) {
      throw new Error('Failed to reverse geocode coordinates');
    }

    // Determine shipping zone
    const zone = determineShippingZone(googleData.city, googleData.region);

    // Try to generate approximate digital address from coordinates
    const { coordinatesToDigitalAddress } = require('./digitalAddressService');
    let digitalAddress = null;
    try {
      digitalAddress = coordinatesToDigitalAddress(lat, lng);
    } catch (error) {
      // If conversion fails, continue without digital address
      console.warn('Could not generate digital address from coordinates:', error.message);
    }

    return {
      digitalAddress,
      coordinates: {
        lat,
        lng,
      },
      streetAddress: googleData.street || null,
      town: googleData.town || null,
      city: googleData.city || null,
      region: googleData.region || null,
      country: googleData.country || null,
      formattedAddress: googleData.formattedAddress || null,
      zone,
      placeId: googleData.placeId || null,
    };
  } catch (error) {
    throw new Error(`Failed to resolve address from coordinates: ${error.message}`);
  }
}

module.exports = {
  resolveFullAddress,
  resolveAddressFromCoordinates,
  determineShippingZone,
};

