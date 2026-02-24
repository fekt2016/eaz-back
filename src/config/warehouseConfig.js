/**
 * Warehouse Configuration
 * FIXED EazShop HQ Location - This is the permanent origin for all shipping calculations
 * 
 * IMPORTANT: This warehouse location is FIXED and NEVER changes.
 * All distance calculations use this location as the origin point.
 * Only the customer's destination address is geocoded.
 * 
 * Address: Nima, Accra, Ghana
 * Coordinates: lat: 5.5820038, lng: -0.1984173
 */

// Fixed warehouse location - EazShop HQ
// These values are set via environment variables but have defaults matching the actual HQ location
const WAREHOUSE_LOCATION = {
  lat: parseFloat(process.env.WAREHOUSE_LAT) || 5.5820038, // EazShop HQ latitude
  lng: parseFloat(process.env.WAREHOUSE_LNG) || -0.1984173, // EazShop HQ longitude
  address: process.env.WAREHOUSE_ADDRESS || 'Nima, Accra, Ghana',
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

