const axios = require('axios');

/**
 * Google Geocoding Utility
 * Validates and geocodes addresses using Google Maps Geocoding API
 * Returns official Google-recognized address information
 */

/**
 * Geocode an address string
 * @param {String} address - Address string (e.g., "Nima, Accra, Ghana")
 * @returns {Promise<Object>} Geocoded address data
 */
async function geocodeAddress(address) {
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  }

  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    throw new Error('Valid address string is required');
  }

  // Ensure address includes "Ghana" for better results
  const searchAddress = address.includes('Ghana') ? address.trim() : `${address.trim()}, Ghana`;

  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  const params = {
    address: searchAddress,
    key: GOOGLE_MAPS_API_KEY,
    region: 'gh', // Bias results to Ghana
    language: 'en',
  };

  try {
    const response = await axios.get(url, { params, timeout: 15000 });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = result.geometry.location;

      return {
        input: address,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        types: result.types || [],
        lat: location.lat,
        lng: location.lng,
        isValid: true,
      };
    } else if (response.data.status === 'ZERO_RESULTS') {
      return {
        input: address,
        formattedAddress: null,
        placeId: null,
        types: [],
        lat: null,
        lng: null,
        isValid: false,
        error: 'ZERO_RESULTS',
      };
    } else {
      return {
        input: address,
        formattedAddress: null,
        placeId: null,
        types: [],
        lat: null,
        lng: null,
        isValid: false,
        error: response.data.status || 'UNKNOWN_ERROR',
      };
    }
  } catch (error) {
    if (error.response) {
      return {
        input: address,
        formattedAddress: null,
        placeId: null,
        types: [],
        lat: null,
        lng: null,
        isValid: false,
        error: `API_ERROR: ${error.response.data?.error_message || error.message}`,
      };
    }
    return {
      input: address,
      formattedAddress: null,
      placeId: null,
      types: [],
      lat: null,
      lng: null,
      isValid: false,
      error: `NETWORK_ERROR: ${error.message}`,
    };
  }
}

module.exports = {
  geocodeAddress,
};

