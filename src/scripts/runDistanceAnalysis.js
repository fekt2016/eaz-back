/**
 * Run Distance Analysis Script
 * Executes the distance analyzer and outputs results
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { analyzeAllZonesDistance } = require('../services/distanceAnalyzerService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

// Connect to MongoDB
const connectDB = async () => {
  try {
    const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
    await mongoose.connect(DB);
    logger.info('✅ MongoDB connected successfully');
  } catch (error) {
    logger.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Main function
async function main() {
  logger.info('🚀 Starting Distance Analysis...\n');
  logger.info(`📍 Warehouse Location: ${WAREHOUSE_LOCATION.address}`);
  logger.info(`   Coordinates: ${WAREHOUSE_LOCATION.lat}, ${WAREHOUSE_LOCATION.lng}\n`);

  await connectDB();

  try {
    const results = await analyzeAllZonesDistance();

    logger.info('\n' + '='.repeat(80));
    logger.info('📊 DISTANCE ANALYSIS RESULTS');
    logger.info('='.repeat(80) + '\n');

    // Display results for each zone
    const zones = ['A', 'B', 'C', 'D', 'E', 'F'];
    
    zones.forEach((zone) => {
      const zoneData = results[zone];
      if (!zoneData) {
        logger.info(`\n⚠️  Zone ${zone}: No data available\n`);
        return;
      }

      logger.info(`\n${'─'.repeat(80)}`);
      logger.info(`📍 ZONE ${zone}`);
      logger.info(`${'─'.repeat(80)}`);
      logger.info(`Total Towns: ${zoneData.totalTowns}`);
      logger.info(`Successful: ${zoneData.successfulTowns}`);
      if (zoneData.failedTowns > 0) {
        logger.info(`Failed: ${zoneData.failedTowns}`);
      }
      
      if (zoneData.closest) {
        logger.info(`\n✅ Closest Town: ${zoneData.closest.town}`);
        logger.info(`   Distance: ${zoneData.closest.distanceKm} km`);
      }
      
      if (zoneData.farthest) {
        logger.info(`\n❌ Farthest Town: ${zoneData.farthest.town}`);
        logger.info(`   Distance: ${zoneData.farthest.distanceKm} km`);
      }
      
      if (zoneData.average !== null) {
        logger.info(`\n📊 Average Distance: ${zoneData.average} km`);
      }

      logger.info(`\n📋 All Towns (sorted by distance);:`);
      logger.info(`${'─'.repeat(80)}`);
      logger.info(`${'Town'.padEnd(50)} | Distance (km)`);
      logger.info(`${'─'.repeat(80)}`);
      
      zoneData.all.forEach((townData, index) => {
        if (townData.distanceKm !== null) {
          logger.info(
            `${(index + 1).toString().padStart(3)}. ${townData.town.padEnd(47)} | ${townData.distanceKm.toFixed(2).padStart(10)} km`
          );
        } else {
          logger.info(
            `${(index + 1).toString().padStart(3)}. ${townData.town.padEnd(47)} | ${'ERROR'.padStart(10)} ${townData.error || ''}`
          );
        }
      });
    });

    logger.info('\n' + '='.repeat(80));
    logger.info('✅ Analysis Complete!');
    logger.info('='.repeat(80) + '\n');

    // Close database connection
    await mongoose.connection.close();
    logger.info('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('\n❌ Error during analysis:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
main();

