const Neighborhood = require('../models/shipping/neighborhoodModel');
const { reverseGeocode } = require('./googleMapsService');
const { getDistanceKm } = require('./distanceService');
const { classifyZone } = require('./zoneClassificationService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

/**
 * Neighborhood Service
 * Handles neighborhood detection, lookup, and zone assignment
 */

/**
 * Detect neighborhood from coordinates using reverse geocoding
 * @param {Number} lat - Latitude
 * @param {Number} lng - Longitude
 * @returns {Promise<Object>} Neighborhood data with zone
 */
async function detectNeighborhoodFromCoordinates(lat, lng) {
  try {
    // Step 1: Reverse geocode to get address components
    const reverseGeocodeResult = await reverseGeocode(lat, lng);
    
    if (!reverseGeocodeResult) {
      return null;
    }

    // Step 2: Extract neighborhood name from reverse geocode
    // Google Maps returns: neighborhood, sublocality, or locality
    const neighborhoodName = 
      reverseGeocodeResult.neighborhood ||
      reverseGeocodeResult.sublocality ||
      reverseGeocodeResult.locality ||
      null;

    if (!neighborhoodName) {
      return null;
    }

    // Step 3: Try to find exact match in database
    let neighborhood = await Neighborhood.findOne({
      name: { $regex: new RegExp(`^${neighborhoodName}$`, 'i') },
      isActive: true,
    });

    // Step 4: If not found, try fuzzy search
    if (!neighborhood) {
      neighborhood = await Neighborhood.findOne({
        name: { $regex: neighborhoodName, $options: 'i' },
        isActive: true,
      });
    }

    // Step 5: If still not found, calculate distance and zone from coordinates
    const distanceResult = await getDistanceKm(
      WAREHOUSE_LOCATION.lat,
      WAREHOUSE_LOCATION.lng,
      lat,
      lng
    );
    const distanceKm = Math.round(distanceResult.distanceKm * 100) / 100;
    const zone = classifyZone(distanceKm);

    if (neighborhood) {
      // Return found neighborhood with updated distance/zone
      return {
        neighborhood: {
          _id: neighborhood._id,
          name: neighborhood.name,
          city: neighborhood.city,
          municipality: neighborhood.municipality,
          lat: neighborhood.lat,
          lng: neighborhood.lng,
        },
        detectedName: neighborhoodName,
        distanceKm,
        zone,
        coordinates: { lat, lng },
        formattedAddress: reverseGeocodeResult.formattedAddress,
      };
    }

    // Return detected neighborhood info even if not in database
    return {
      neighborhood: null,
      detectedName: neighborhoodName,
      distanceKm,
      zone,
      coordinates: { lat, lng },
      formattedAddress: reverseGeocodeResult.formattedAddress,
      city: reverseGeocodeResult.city || 'Accra',
      region: reverseGeocodeResult.region || 'Greater Accra',
    };
  } catch (error) {
    console.error('Error detecting neighborhood:', error);
    return null;
  }
}

/**
 * Get neighborhood by name and city
 * @param {String} name - Neighborhood name
 * @param {String} city - City (Accra or Tema)
 * @returns {Promise<Object>} Neighborhood document
 */
async function getNeighborhoodByName(name, city) {
  return await Neighborhood.findOne({
    name: { $regex: new RegExp(`^${name}$`, 'i') },
    city,
    isActive: true,
  });
}

/**
 * Calculate zone for given coordinates
 * @param {Number} lat - Latitude
 * @param {Number} lng - Longitude
 * @returns {Promise<Object>} { distanceKm, zone }
 */
async function calculateZoneFromCoordinates(lat, lng) {
  try {
    const distanceResult = await getDistanceKm(
      WAREHOUSE_LOCATION.lat,
      WAREHOUSE_LOCATION.lng,
      lat,
      lng
    );
    const distanceKm = Math.round(distanceResult.distanceKm * 100) / 100;
    const zone = classifyZone(distanceKm);
    
    return { distanceKm, zone };
  } catch (error) {
    console.error('Error calculating zone:', error);
    return { distanceKm: null, zone: null };
  }
}

/**
 * Find nearest neighborhood to given coordinates
 * @param {Number} lat - Latitude
 * @param {Number} lng - Longitude
 * @param {Number} maxDistanceKm - Maximum distance in km (default: 5)
 * @returns {Promise<Object>} Nearest neighborhood
 */
async function findNearestNeighborhood(lat, lng, maxDistanceKm = 5) {
  // Use MongoDB geospatial query if coordinates are indexed
  // For now, calculate distance for all active neighborhoods and find nearest
  const neighborhoods = await Neighborhood.find({ isActive: true, lat: { $ne: null }, lng: { $ne: null } }).lean();
  
  let nearest = null;
  let minDistance = Infinity;

  for (const neighborhood of neighborhoods) {
    try {
      const distanceResult = await getDistanceKm(lat, lng, neighborhood.lat, neighborhood.lng);
      const distanceKm = distanceResult.distanceKm;
      
      if (distanceKm <= maxDistanceKm && distanceKm < minDistance) {
        minDistance = distanceKm;
        nearest = {
          ...neighborhood,
          distanceFromPoint: distanceKm,
        };
      }
    } catch (error) {
      // Skip neighborhoods with calculation errors
      continue;
    }
  }

  return nearest;
}

module.exports = {
  detectNeighborhoodFromCoordinates,
  getNeighborhoodByName,
  calculateZoneFromCoordinates,
  findNearestNeighborhood,
};

