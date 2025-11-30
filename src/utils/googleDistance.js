const axios = require('axios');

/**
 * Google Distance Utility
 * Gets driving distance in meters from Google Maps Distance Matrix API
 * 
 * @param {Number} originLat - Origin latitude
 * @param {Number} originLng - Origin longitude
 * @param {String} destinationAddress - Destination address string (e.g., "Nima, Accra, Ghana")
 * @returns {Promise<Number>} Distance in meters
 */
async function getDistanceMeters(originLat, originLng, destinationAddress) {
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  }

  if (!originLat || !originLng || !destinationAddress) {
    throw new Error('Origin coordinates and destination address are required');
  }

  const url = 'https://maps.googleapis.com/maps/api/distancematrix/json';
  const params = {
    origins: `${originLat},${originLng}`,
    destinations: encodeURIComponent(destinationAddress),
    key: GOOGLE_MAPS_API_KEY,
    units: 'metric', // Use metric units
    mode: 'driving', // Driving distance
  };

  try {
    const response = await axios.get(url, { params, timeout: 15000 });

    if (response.data.status !== 'OK') {
      throw new Error(`Google Maps API error: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`);
    }

    const element = response.data.rows[0]?.elements[0];

    if (!element) {
      throw new Error(`No route found for ${destinationAddress}`);
    }

    if (element.status !== 'OK') {
      throw new Error(`Distance calculation failed for ${destinationAddress}: ${element.status}`);
    }

    return element.distance.value; // Distance in meters
  } catch (error) {
    if (error.response) {
      throw new Error(`Google Maps API error: ${error.response.data?.error_message || error.message}`);
    }
    throw new Error(`Failed to get distance for ${destinationAddress}: ${error.message}`);
  }
}

module.exports = {
  getDistanceMeters,
};

