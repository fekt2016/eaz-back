/**
 * Seed Script: Populate neighborhoods in MongoDB
 * Reads from data/neighborhoods.accra.tema.json and inserts/updates neighborhoods
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Neighborhood = require('../models/shipping/neighborhoodModel');
const logger = require('../utils/logger');
const { getDistanceKm } = require('../services/distanceService');
const { classifyZone } = require('../services/zoneClassificationService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

const DATA_FILE = path.join(__dirname, '../../data/neighborhoods.accra.tema.json');

// Connect to database
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

    await mongoose.connect(mongodb, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info('✅ Connected to MongoDB\n');
    return true;
  } catch (error) {
    logger.error('❌ Error connecting to MongoDB:', error.message);
    throw error;
  }
}

/**
 * Calculate distance from warehouse and assign zone
 */
async function calculateDistanceAndZone(neighborhood) {
  if (!neighborhood.lat || !neighborhood.lng) {
    return { distanceKm: null, zone: null };
  }

  try {
    const warehouseLat = WAREHOUSE_LOCATION.lat;
    const warehouseLng = WAREHOUSE_LOCATION.lng;
    
    const distanceResult = await getDistanceKm(
      warehouseLat,
      warehouseLng,
      neighborhood.lat,
      neighborhood.lng
    );
    
    const distanceKm = Math.round(distanceResult.distanceKm * 100) / 100;
    const zone = classifyZone(distanceKm);
    
    return { distanceKm, zone };
  } catch (error) {
    logger.error(`Error calculating distance for ${neighborhood.name}:`, error.message);
    return { distanceKm: null, zone: null };
  }
}

/**
 * Seed neighborhoods from JSON file
 */
async function seedNeighborhoods() {
  try {
    await connectDatabase();

    // Read the JSON file
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Data file not found: ${DATA_FILE}`);
    }

    const neighborhoods = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    logger.info(`📋 Found ${neighborhoods.length} neighborhoods to process\n`);

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    // Process each neighborhood
    for (let i = 0; i < neighborhoods.length; i++) {
      const neighborhoodData = neighborhoods[i];
      
      try {
        // Check if neighborhood already exists
        const existing = await Neighborhood.findOne({
          name: neighborhoodData.name,
          city: neighborhoodData.city,
        });

        // Calculate distance and zone if coordinates exist
        let distanceAndZone = { distanceKm: null, zone: null };
        if (neighborhoodData.lat && neighborhoodData.lng) {
          distanceAndZone = await calculateDistanceAndZone(neighborhoodData);
        }

        const updateData = {
          name: neighborhoodData.name,
          city: neighborhoodData.city,
          municipality: neighborhoodData.municipality,
          lat: neighborhoodData.lat || null,
          lng: neighborhoodData.lng || null,
          isActive: true,
          formattedAddress: neighborhoodData.formattedAddress || null,
          googlePlaceId: neighborhoodData.placeId || null,
          distanceFromHQ: distanceAndZone.distanceKm,
          assignedZone: distanceAndZone.zone,
        };

        if (existing) {
          // Update existing neighborhood
          Object.assign(existing, updateData);
          await existing.save();
          results.updated++;
          logger.info(`✅ Updated: ${neighborhoodData.name}, ${neighborhoodData.city} (Zone ${distanceAndZone.zone || 'N/A'}, ${distanceAndZone.distanceKm || 'N/A'} km);`);
        } else {
          // Create new neighborhood
          const newNeighborhood = new Neighborhood(updateData);
          await newNeighborhood.save();
          results.created++;
          logger.info(`✅ Created: ${neighborhoodData.name}, ${neighborhoodData.city} (Zone ${distanceAndZone.zone || 'N/A'}, ${distanceAndZone.distanceKm || 'N/A'} km);`);
        }

        // Small delay to avoid overwhelming the database
        if (i < neighborhoods.length - 1 && neighborhoodData.lat && neighborhoodData.lng) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        results.failed++;
        logger.error(`❌ Error processing ${neighborhoodData.name}:`, error.message);
      }
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 SEEDING SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`✅ Created: ${results.created} neighborhoods`);
    logger.info(`🔄 Updated: ${results.updated} neighborhoods`);
    logger.info(`⏭️  Skipped: ${results.skipped} neighborhoods`);
    logger.info(`❌ Failed: ${results.failed} neighborhoods`);

    // Zone distribution
    const zoneStats = await Neighborhood.aggregate([
      {
        $group: {
          _id: '$assignedZone',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    logger.info('\n📍 Zone Distribution:');
    zoneStats.forEach((stat) => {
      logger.info(`   Zone ${stat._id || 'N/A'}: ${stat.count} neighborhoods`);
    });

    logger.info('\n✅ Seeding completed!');
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
  seedNeighborhoods()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedNeighborhoods };

