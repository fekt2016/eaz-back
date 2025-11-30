const axios = require('axios');

/**
 * Google Maps Distance Service
 * Calculates distance between two coordinates using Google Maps Distance Matrix API
 * 
 * IMPORTANT: Origin is always the fixed warehouse location (WAREHOUSE_LOCATION).
 * Only the destination (customer address) coordinates are passed here.
 */

/**
 * Get distance in kilometers between two coordinates
 * 
 * FIXED ORIGIN: This function is called with warehouse coordinates as origin.
 * The origin should always be WAREHOUSE_LOCATION from config.
 * 
 * @param {Number} originLat - Origin latitude (should always be warehouse lat)
 * @param {Number} originLng - Origin longitude (should always be warehouse lng)
 * @param {Number} destLat - Destination latitude (customer address)
 * @param {Number} destLng - Destination longitude (customer address)
 * @returns {Promise<Object>} { distanceKm, durationText, distanceText }
 */
async function getDistanceKm(originLat, originLng, destLat, destLng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  }

  // Validate coordinates
  if (
    typeof originLat !== 'number' ||
    typeof originLng !== 'number' ||
    typeof destLat !== 'number' ||
    typeof destLng !== 'number' ||
    isNaN(originLat) ||
    isNaN(originLng) ||
    isNaN(destLat) ||
    isNaN(destLng)
  ) {
    throw new Error('Invalid coordinates provided');
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
  const params = {
    origins: `${originLat},${originLng}`,
    destinations: `${destLat},${destLng}`,
    key: apiKey,
    units: 'metric', // Use metric units (kilometers)
  };

  try {
    const response = await axios.get(url, { params });

    if (response.data.status !== 'OK') {
      throw new Error(`Google Maps API error: ${response.data.status}`);
    }

    const element = response.data.rows[0]?.elements[0];

    if (!element || element.status !== 'OK') {
      throw new Error(`Distance calculation failed: ${element?.status || 'UNKNOWN_ERROR'}`);
    }

    // Extract distance in kilometers
    const distanceMeters = element.distance.value; // Distance in meters
    const distanceKm = distanceMeters / 1000; // Convert to kilometers

    // Extract duration text
    const durationText = element.duration.text; // e.g., "1 hour 23 mins"
    const distanceText = element.distance.text; // e.g., "32.5 km"

    return {
      distanceKm: Math.round(distanceKm * 100) / 100, // Round to 2 decimal places
      durationText,
      distanceText,
      distanceMeters,
    };
  } catch (error) {
    if (error.response) {
      // API error response
      throw new Error(`Google Maps API error: ${error.response.data?.error_message || error.message}`);
    }
    throw error;
  }
}

module.exports = {
  getDistanceKm,
};

