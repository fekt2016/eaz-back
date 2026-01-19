/**
 * Fetch Coordinates for All Neighborhoods
 * 
 * This script:
 * 1. Fetches lat/lng for all neighborhoods using Google Maps Geocoding API
 * 2. Calculates distance from EazShop HQ (Nima)
 * 3. Assigns zones based on distance
 * 4. Updates the database
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Neighborhood = require('../models/shipping/neighborhoodModel');
const logger = require('../utils/logger');
const { geocodeAddress } = require('../services/googleMapsService');
const { haversineDistance } = require('../utils/haversine');
const { classifyZone } = require('../services/zoneClassificationService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

// Configuration
const DELAY_BETWEEN_REQUESTS = 300; // 200-400ms delay to avoid rate limits
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// EazShop HQ coordinates
const HQ_LAT = WAREHOUSE_LOCATION.lat;
const HQ_LNG = WAREHOUSE_LOCATION.lng;

/**
 * Connect to MongoDB
 */
async function connectDatabase() {
  try {
    let mongodb;
    if (process.env.MONGO_URL) {
      mongodb = process.env.MONGO_URL.replace(
        '<PASSWORD>',
        process.env.DATABASE_PASSWORD || ''
      );
    } else if (process.env.MONGODB_URI) {
      mongodb = process.env.MONGODB_URI;
    } else if (process.env.DATABASE) {
      mongodb = process.env.DATABASE;
    } else {
      throw new Error('No MongoDB connection string found in environment variables');
    }

    await mongoose.connect(mongodb);
    logger.info('✅ Connected to MongoDB\n');
    return true;
  } catch (error) {
    logger.error('❌ Error connecting to MongoDB:', error.message);
    throw error;
  }
}

/**
 * Geocode a neighborhood with retry logic
 * @param {Object} neighborhood - Neighborhood document
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<Object|null>} Geocoding result or null
 */
async function geocodeNeighborhood(neighborhood, retries = MAX_RETRIES) {
  const address = `${neighborhood.name}, ${neighborhood.city}, Ghana`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(`   ⏳ Retry attempt ${attempt}/${retries}...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt));
      }

      const result = await geocodeAddress(address);
      
      // geocodeAddress returns { lat, lng } not { latitude, longitude }
      if (result && (result.lat || result.latitude) && (result.lng || result.longitude)) {
        return {
          lat: result.lat || result.latitude,
          lng: result.lng || result.longitude,
          formattedAddress: result.formattedAddress,
          placeId: result.placeId,
        };
      }

      // Try with municipality if first attempt failed
      if (attempt === 1 && neighborhood.municipality) {
        const addressWithMunicipality = `${neighborhood.name}, ${neighborhood.municipality}, ${neighborhood.city}, Ghana`;
        logger.info(`   🔄 Trying with municipality: ${addressWithMunicipality}`);
        const result2 = await geocodeAddress(addressWithMunicipality);
        
        // geocodeAddress returns { lat, lng } not { latitude, longitude }
        if (result2 && (result2.lat || result2.latitude) && (result2.lng || result2.longitude)) {
          return {
            lat: result2.lat || result2.latitude,
            lng: result2.lng || result2.longitude,
            formattedAddress: result2.formattedAddress,
            placeId: result2.placeId,
          };
        }
      }
    } catch (error) {
      logger.error(`   ❌ Error geocoding (attempt ${attempt}/${retries});:`, error.message);
      
      if (attempt === retries) {
        return null;
      }
    }
  }
  
  return null;
}

/**
 * Calculate distance and assign zone
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Object} Distance and zone
 */
function calculateDistanceAndZone(lat, lng) {
  try {
    const distanceKm = haversineDistance(HQ_LAT, HQ_LNG, lat, lng);
    const zone = classifyZone(distanceKm);
    return { distanceKm, zone };
  } catch (error) {
    logger.error('   ❌ Error calculating distance:', error.message);
    return { distanceKm: null, zone: null };
  }
}

/**
 * Process all neighborhoods
 */
async function fetchCoordinatesForAllNeighborhoods() {
  try {
    await connectDatabase();

    // Find all neighborhoods where lat or lng is null
    const neighborhoods = await Neighborhood.find({
      $or: [
        { lat: null },
        { lng: null },
        { lat: { $exists: false } },
        { lng: { $exists: false } },
      ],
    });

    logger.info(`📋 Found ${neighborhoods.length} neighborhoods without coordinates\n`);

    if (neighborhoods.length === 0) {
      logger.info('✅ All neighborhoods already have coordinates!');
      logger.info('   To recalculate all neighborhoods, update the query in the script.');
      await mongoose.disconnect();
      return;
    }

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      updated: [],
      errors: [],
    };

    // Process each neighborhood
    for (let i = 0; i < neighborhoods.length; i++) {
      const neighborhood = neighborhoods[i];
      logger.info(`\n[${i + 1}/${neighborhoods.length}] Processing: ${neighborhood.name}, ${neighborhood.city}`);

      // Geocode the neighborhood
      const geocodeResult = await geocodeNeighborhood(neighborhood);

      if (!geocodeResult) {
        results.failed++;
        results.errors.push({
          name: neighborhood.name,
          city: neighborhood.city,
          error: 'Failed to geocode after retries',
        });
        logger.info(`   ❌ Failed to geocode: ${neighborhood.name}`);
        continue;
      }

      // Calculate distance and zone
      const { distanceKm, zone } = calculateDistanceAndZone(geocodeResult.lat, geocodeResult.lng);

      // Update the neighborhood
      neighborhood.lat = geocodeResult.lat;
      neighborhood.lng = geocodeResult.lng;
      neighborhood.formattedAddress = geocodeResult.formattedAddress;
      neighborhood.googlePlaceId = geocodeResult.placeId;
      neighborhood.distanceFromHQ = distanceKm;
      neighborhood.assignedZone = zone;

      await neighborhood.save();

      results.success++;
      results.updated.push({
        name: neighborhood.name,
        city: neighborhood.city,
        lat: geocodeResult.lat,
        lng: geocodeResult.lng,
        distanceKm,
        zone,
      });

      logger.info(`   ✅ Success: ${geocodeResult.lat}, ${geocodeResult.lng}`);
      logger.info(`   📍 Distance: ${distanceKm} km, Zone: ${zone}`);

      // Delay between requests to avoid rate limits
      if (i < neighborhoods.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 FETCHING SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`✅ Successfully processed: ${results.success} neighborhoods`);
    logger.info(`❌ Failed: ${results.failed} neighborhoods`);
    logger.info(`⏭️  Skipped: ${results.skipped} neighborhoods`);

    if (results.errors.length > 0) {
      logger.info('\n❌ Failed neighborhoods:');
      results.errors.forEach((err) => {
        logger.info(`   - ${err.name}, ${err.city}: ${err.error}`);
      });
    }

    // Zone distribution
    const zoneStats = await Neighborhood.aggregate([
      {
        $match: {
          assignedZone: { $in: ['A', 'B', 'C', 'D', 'E', 'F'] },
        },
      },
      {
        $group: {
          _id: '$assignedZone',
          count: { $sum: 1 },
          avgDistance: { $avg: '$distanceFromHQ' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    logger.info('\n📍 Zone Distribution:');
    zoneStats.forEach((stat) => {
      logger.info(`   Zone ${stat._id}: ${stat.count} neighborhoods (avg distance: ${stat.avgDistance?.toFixed(2) || 'N/A'} km)`);
    });

    logger.info('\n✅ Script completed successfully!');
  } catch (error) {
    logger.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    logger.info('\n🔌 Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  fetchCoordinatesForAllNeighborhoods()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  fetchCoordinatesForAllNeighborhoods,
  geocodeNeighborhood,
  calculateDistanceAndZone,
};

