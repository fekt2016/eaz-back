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
  // Normalize inputs
  const normalizedName = neighborhoodName.trim().toLowerCase();
  const normalizedCity = city.trim();
  
  // Escape special regex characters in the neighborhood name
  const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Try multiple search strategies (most specific to least specific)
  let neighborhood = null;
  
  // 1. Exact match (case-insensitive)
  neighborhood = await Neighborhood.findOne({
    name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
    city: normalizedCity,
    isActive: true,
  });
  
  // 2. If not found, try partial match (neighborhood name contains the search term)
  if (!neighborhood) {
    neighborhood = await Neighborhood.findOne({
      name: { $regex: new RegExp(escapedName, 'i') },
      city: normalizedCity,
      isActive: true,
    });
  }
  
  // 3. If still not found, try fuzzy matching (search term contains neighborhood name or vice versa)
  if (!neighborhood) {
    // Split the search term into keywords and try matching any of them
    const keywords = normalizedName.split(/\s+/).filter(k => k.length > 2); // Filter out short words
    
    if (keywords.length > 0) {
      // Build regex pattern that matches if any keyword is found in neighborhood name
      const keywordPattern = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      
      neighborhood = await Neighborhood.findOne({
        name: { $regex: new RegExp(keywordPattern, 'i') },
        city: normalizedCity,
        isActive: true,
      });
    }
  }
  
  // 4. If still not found, try without city constraint (fallback)
  if (!neighborhood) {
    neighborhood = await Neighborhood.findOne({
      name: { $regex: new RegExp(escapedName, 'i') },
      isActive: true,
    });
  }

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

