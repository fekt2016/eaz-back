const Neighborhood = require('../models/shipping/neighborhoodModel');
const ShippingZone = require('../models/shipping/shippingZoneModel');

/**
 * Get zone information from neighborhood
 * @param {string} neighborhoodId - MongoDB ObjectId of the neighborhood
 * @returns {Promise<Object>} { neighborhood, zone }
 * @throws {Error} If neighborhood not found or zone not found
 */
async function getZoneFromNeighborhood(neighborhoodId) {
  const neighborhood = await Neighborhood.findById(neighborhoodId);

  if (!neighborhood) {
    throw new Error('Neighborhood not found');
  }

  if (!neighborhood.assignedZone) {
    throw new Error('Neighborhood does not have an assigned zone');
  }

  const zone = await ShippingZone.findOne({
    name: neighborhood.assignedZone,
    isActive: true,
  });

  if (!zone) {
    throw new Error(`Shipping zone ${neighborhood.assignedZone} not found or inactive`);
  }

  return { neighborhood, zone };
}

/**
 * Get zone information from neighborhood name and city
 * @param {string} neighborhoodName - Name of the neighborhood
 * @param {string} city - City name (Accra or Tema)
 * @returns {Promise<Object>} { neighborhood, zone }
 */
async function getZoneFromNeighborhoodName(neighborhoodName, city) {
  const neighborhood = await Neighborhood.findOne({
    name: { $regex: new RegExp(`^${neighborhoodName}$`, 'i') },
    city: city,
    isActive: true,
  });

  if (!neighborhood) {
    throw new Error(`Neighborhood "${neighborhoodName}" in ${city} not found`);
  }

  if (!neighborhood.assignedZone) {
    throw new Error('Neighborhood does not have an assigned zone');
  }

  const zone = await ShippingZone.findOne({
    name: neighborhood.assignedZone,
    isActive: true,
  });

  if (!zone) {
    throw new Error(`Shipping zone ${neighborhood.assignedZone} not found or inactive`);
  }

  return { neighborhood, zone };
}

module.exports = {
  getZoneFromNeighborhood,
  getZoneFromNeighborhoodName,
};

