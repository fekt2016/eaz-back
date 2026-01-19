const logger = require('../utils/logger');
const { DELIVERY_ZONES } = require('../config/zonesWithTowns');
const { getDistanceKm } = require('./distanceService');
const { geocodeAddress } = require('./googleMapsService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

/**
 * Improved Distance Analyzer Service
 * First geocodes each town to get accurate coordinates, then calculates distance
 * This ensures better accuracy and handles towns that might not be recognized by Distance Matrix API
 */

/**
 * Process towns in batches with concurrency control
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  if (errors.length > 0) {
    logger.warn(`Distance Analyzer: ${errors.length} errors occurred:`, errors.slice(0, 5));
  }

  return { results, errors };
}

/**
 * Analyze distances for all zones with improved geocoding
 * @returns {Promise<Object>} Analysis results for each zone
 */
async function analyzeAllZonesDistanceImproved() {
  const warehouseLat = WAREHOUSE_LOCATION.lat;
  const warehouseLng = WAREHOUSE_LOCATION.lng;

  logger.info(`Starting improved distance analysis from warehouse (${warehouseLat}, ${warehouseLng});`);
  logger.info(`Warehouse Address: ${WAREHOUSE_LOCATION.address}\n`);

  const analysisResults = {};

  // Process each zone
  for (const [zone, towns] of Object.entries(DELIVERY_ZONES)) {
    logger.info(`\n📍 Analyzing Zone ${zone}: ${towns.length} towns`);

    const zoneResults = [];

    // Process towns in batches with geocoding first
    const { results, errors } = await processBatch(
      towns,
      async (town) => {
        // Step 1: Geocode the town to get coordinates
        logger.info(`  🔍 Geocoding: ${town}`);
        let geocodeResult;
        let geocodedAddress = town;
        
        try {
          geocodeResult = await geocodeAddress(town);
          geocodedAddress = geocodeResult.formattedAddress;
          logger.info(`  ✅ Geocoded to: ${geocodedAddress}`);
        } catch (geocodeError) {
          logger.warn(`  ⚠️  Geocoding failed for ${town}: ${geocodeError.message}`);
          // Try alternative formats
          const alternatives = [
            town.replace(', Ghana', ''),
            town.split(',')[0] + ', Ghana',
            town.split(',')[0] + ', Greater Accra, Ghana',
          ];
          
          let found = false;
          for (const alt of alternatives) {
            try {
              geocodeResult = await geocodeAddress(alt);
              geocodedAddress = geocodeResult.formattedAddress;
              logger.info(`  ✅ Geocoded (alternative); to: ${geocodedAddress}`);
              found = true;
              break;
            } catch (e) {
              // Try next alternative
            }
          }
          
          if (!found) {
            throw new Error(`Geocoding failed: ${geocodeError.message}`);
          }
        }

        // Step 2: Calculate distance using coordinates
        const destLat = geocodeResult.lat;
        const destLng = geocodeResult.lng;
        
        logger.info(`  📏 Calculating distance from warehouse to (${destLat}, ${destLng});`);
        const distanceResult = await getDistanceKm(warehouseLat, warehouseLng, destLat, destLng);
        const distanceKm = Math.round(distanceResult.distanceKm * 100) / 100;
        const distanceMeters = Math.round(distanceResult.distanceKm * 1000);
        
        logger.info(`  ✅ Distance: ${distanceKm} km\n`);

        return {
          town,
          zone,
          geocodedAddress,
          lat: destLat,
          lng: destLng,
          distanceMeters,
          distanceKm,
        };
      },
      2 // Reduced concurrency to 2 to avoid rate limits
    );

    // Add successful results
    zoneResults.push(...results);

    // Add errors as failed entries
    errors.forEach((error) => {
      logger.error(`  ❌ Failed: ${error.town} - ${error.error}`);
      zoneResults.push({
        town: error.town,
        zone,
        geocodedAddress: null,
        lat: null,
        lng: null,
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
            geocodedAddress: closest.geocodedAddress,
            distanceKm: closest.distanceKm,
          }
        : null,
      farthest: farthest
        ? {
            town: farthest.town,
            geocodedAddress: farthest.geocodedAddress,
            distanceKm: farthest.distanceKm,
          }
        : null,
      average: average,
      totalTowns: zoneResults.length,
      successfulTowns: validDistances.length,
      failedTowns: zoneResults.length - validDistances.length,
      all: zoneResults,
    };

    logger.info(
      `\n✅ Zone ${zone} complete:`
    );
    logger.info(`   Closest: ${closest?.town || 'N/A'} (${closest?.distanceKm || 'N/A'} km);`);
    logger.info(`   Farthest: ${farthest?.town || 'N/A'} (${farthest?.distanceKm || 'N/A'} km);`);
    logger.info(`   Average: ${average || 'N/A'} km`);
    logger.info(`   Success: ${validDistances.length}/${zoneResults.length}`);
  }

  return analysisResults;
}

module.exports = {
  analyzeAllZonesDistanceImproved,
  processBatch,
};

