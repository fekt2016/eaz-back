/**
 * Warehouse Configuration
 * FIXED EazShop HQ Location - This is the permanent origin for all shipping calculations
 * 
 * IMPORTANT: This warehouse location is FIXED and NEVER changes.
 * All distance calculations use this location as the origin point.
 * Only the customer's destination address is geocoded.
 * 
 * Address: HRH2+R22, Al-Waleed bin Talal Highway, Accra, Ghana
 * Coordinates: lat: 5.582930, lng: -0.171870
 */

// Fixed warehouse location - EazShop HQ
// These values are set via environment variables but have defaults matching the actual HQ location
const WAREHOUSE_LOCATION = {
  lat: parseFloat(process.env.WAREHOUSE_LAT) || 5.582930, // EazShop HQ latitude
  lng: parseFloat(process.env.WAREHOUSE_LNG) || -0.171870, // EazShop HQ longitude
  address: process.env.WAREHOUSE_ADDRESS || 'HRH2+R22, Al-Waleed bin Talal Highway, Accra, Ghana',
};

/**
 * Get warehouse location (async function for compatibility)
 * Returns the fixed warehouse location
 */
async function getWarehouseLocation() {
  return WAREHOUSE_LOCATION;
}

module.exports = {
  WAREHOUSE_LOCATION,
  getWarehouseLocation,
};

