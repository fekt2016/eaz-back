/**
 * Zone Classification Service
 * Automatically classifies towns into zones based on driving distance from warehouse
 */

/**
 * Classify zone based on distance in kilometers
 * @param {Number} distanceKm - Distance in kilometers
 * @returns {String} Zone ID ('A', 'B', 'C', 'D', 'E', or 'F')
 */
function classifyZone(distanceKm) {
  if (typeof distanceKm !== 'number' || isNaN(distanceKm) || distanceKm < 0) {
    return 'F'; // Default to Zone F for invalid distances
  }

  if (distanceKm <= 5) {
    return 'A';
  } else if (distanceKm <= 10) {
    return 'B';
  } else if (distanceKm <= 15) {
    return 'C';
  } else if (distanceKm <= 20) {
    return 'D';
  } else if (distanceKm <= 30) {
    return 'E';
  } else {
    return 'F';
  }
}

/**
 * Get zone name for display
 * @param {String} zone - Zone ID
 * @returns {String} Zone name with distance range
 */
function getZoneName(zone) {
  const zoneNames = {
    A: 'Zone A (0-5 km)',
    B: 'Zone B (5-10 km)',
    C: 'Zone C (10-15 km)',
    D: 'Zone D (15-20 km)',
    E: 'Zone E (20-30 km)',
    F: 'Zone F (30+ km)',
  };
  return zoneNames[zone] || 'Unknown Zone';
}

module.exports = {
  classifyZone,
  getZoneName,
};

