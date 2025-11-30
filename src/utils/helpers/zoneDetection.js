/**
 * Zone Detection Utility
 * Determines shipping zone based on region and city
 */

/**
 * Detect shipping zone from region and city
 * @param {String} region - Region name (e.g., "Greater Accra", "Ashanti")
 * @param {String} city - City name (e.g., "Accra", "Tema", "Kumasi")
 * @returns {String} Zone ID ('A', 'B', or 'C')
 */
function detectZone(region, city) {
  if (!region) return 'C'; // Default to Zone C if no region

  const normalizedRegion = region.toLowerCase().trim();
  const normalizedCity = city ? city.toLowerCase().trim() : '';

  // Zone A: Greater Accra region AND (Accra or Tema city)
  if (
    normalizedRegion.includes('greater accra') ||
    normalizedRegion === 'greater accra' ||
    normalizedRegion === 'accra'
  ) {
    if (normalizedCity === 'accra' || normalizedCity === 'tema') {
      return 'A';
    }
    // Zone B: Greater Accra region but not Accra/Tema core
    return 'B';
  }

  // Zone C: All other regions
  return 'C';
}

module.exports = {
  detectZone,
};

