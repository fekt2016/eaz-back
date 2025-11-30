const { DELIVERY_ZONES } = require('../config/zonesWithTowns');
const { getDistanceMeters } = require('../utils/googleDistance');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

/**
 * Distance Analyzer Service
 * Analyzes distances from warehouse to all towns in zones A-F
 * Uses Google Maps Distance Matrix API with rate limiting
 */

/**
 * Process towns in batches with concurrency control
 * @param {Array} items - Array of items to process
 * @param {Function} processor - Async function to process each item
 * @param {Number} concurrency - Maximum concurrent operations (default: 3)
 * @returns {Promise<Array>} Array of results
 */
async function processBatch(items, processor, concurrency = 3) {
  const results = [];
  const errors = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, index) => {
      try {
        const result = await processor(item);
        return { success: true, result, index: i + index };
      } catch (error) {
        return { success: false, error: error.message, item, index: i + index };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach((result) => {
      if (result.success) {
        results.push(result.result);
      } else {
        errors.push({
          town: result.item,
          error: result.error,
          index: result.index,
        });
      }
    });

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (errors.length > 0) {
    console.warn(`Distance Analyzer: ${errors.length} errors occurred:`, errors.slice(0, 5));
  }

  return { results, errors };
}

/**
 * Analyze distances for all zones
 * @returns {Promise<Object>} Analysis results for each zone
 */
async function analyzeAllZonesDistance() {
  const warehouseLat = WAREHOUSE_LOCATION.lat;
  const warehouseLng = WAREHOUSE_LOCATION.lng;

  console.log(`Starting distance analysis from warehouse (${warehouseLat}, ${warehouseLng})`);

  const analysisResults = {};

  // Process each zone
  for (const [zone, towns] of Object.entries(DELIVERY_ZONES)) {
    console.log(`Analyzing Zone ${zone}: ${towns.length} towns`);

    const zoneResults = [];

    // Process towns in batches of 3 with concurrency control
    const { results, errors } = await processBatch(
      towns,
      async (town) => {
        const distanceMeters = await getDistanceMeters(warehouseLat, warehouseLng, town);
        const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100; // Round to 2 decimal places

        return {
          town,
          zone,
          distanceMeters,
          distanceKm,
        };
      },
      3 // Concurrency limit: 3 at a time
    );

    // Add successful results
    zoneResults.push(...results);

    // Add errors as failed entries
    errors.forEach((error) => {
      zoneResults.push({
        town: error.town,
        zone,
        distanceMeters: null,
        distanceKm: null,
        error: error.error,
      });
    });

    // Sort by distance (ascending), nulls last
    zoneResults.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    // Calculate statistics
    const validDistances = zoneResults.filter((r) => r.distanceKm !== null);
    const distances = validDistances.map((r) => r.distanceKm);

    const closest = validDistances.length > 0 ? validDistances[0] : null;
    const farthest = validDistances.length > 0 ? validDistances[validDistances.length - 1] : null;
    const average =
      distances.length > 0
        ? Math.round((distances.reduce((sum, d) => sum + d, 0) / distances.length) * 100) / 100
        : null;

    analysisResults[zone] = {
      closest: closest
        ? {
            town: closest.town,
            distanceKm: closest.distanceKm,
          }
        : null,
      farthest: farthest
        ? {
            town: farthest.town,
            distanceKm: farthest.distanceKm,
          }
        : null,
      average: average,
      totalTowns: zoneResults.length,
      successfulTowns: validDistances.length,
      failedTowns: zoneResults.length - validDistances.length,
      all: zoneResults,
    };

    console.log(
      `Zone ${zone} complete: Closest=${closest?.distanceKm || 'N/A'}km, Farthest=${farthest?.distanceKm || 'N/A'}km, Average=${average || 'N/A'}km`
    );
  }

  return analysisResults;
}

module.exports = {
  analyzeAllZonesDistance,
  processBatch,
};

