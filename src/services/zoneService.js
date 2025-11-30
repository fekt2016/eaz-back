/**
 * Zone Service
 * Determines shipping zone based on distance in kilometers
 */

/**
 * Detect shipping zone from distance
 * @param {Number} distanceKm - Distance in kilometers
 * @returns {String} Zone ID ('A', 'B', 'C', 'D', 'E', or 'F')
 */
function detectZone(distanceKm) {
  if (typeof distanceKm !== 'number' || isNaN(distanceKm) || distanceKm < 0) {
    return 'D'; // Default to Zone D for invalid distances
  }

  if (distanceKm <= 5) {
    return 'A'; // 0-5 km
  } else if (distanceKm <= 10) {
    return 'B'; // 5-10 km
  } else if (distanceKm <= 20) {
    return 'C'; // 10-20 km
  } else if (distanceKm <= 35) {
    return 'D'; // 20-35 km
  } else if (distanceKm <= 50) {
    return 'E'; // 35-50 km
  } else {
    return 'F'; // 50+ km
  }
}

/**
 * Get zone name for display
 * @param {String} zone - Zone ID
 * @returns {String} Zone name
 */
function getZoneName(zone) {
  const zoneNames = {
    A: 'Zone A (0-5 km)',
    B: 'Zone B (5-10 km)',
    C: 'Zone C (10-20 km)',
    D: 'Zone D (20-35 km)',
    E: 'Zone E (35-50 km)',
    F: 'Zone F (50+ km)',
  };
  return zoneNames[zone] || 'Unknown Zone';
}

/**
 * Check if current time is nighttime (19:00 - 06:00)
 * @param {Date} date - Date to check (defaults to now)
 * @returns {Boolean} True if nighttime
 */
function isNightTime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 19 || hour < 6;
}

/**
 * Check if current date is weekend (Saturday or Sunday)
 * @param {Date} date - Date to check (defaults to now)
 * @returns {Boolean} True if weekend
 */
function isWeekend(date = new Date()) {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

module.exports = {
  detectZone,
  getZoneName,
  isNightTime,
  isWeekend,
};

