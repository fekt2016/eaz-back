/**
 * Run Distance Analysis Script
 * Executes the distance analyzer and outputs results
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { analyzeAllZonesDistance } = require('../services/distanceAnalyzerService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');

// Connect to MongoDB
const connectDB = async () => {
  try {
    const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
    await mongoose.connect(DB);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Main function
async function main() {
  console.log('🚀 Starting Distance Analysis...\n');
  console.log(`📍 Warehouse Location: ${WAREHOUSE_LOCATION.address}`);
  console.log(`   Coordinates: ${WAREHOUSE_LOCATION.lat}, ${WAREHOUSE_LOCATION.lng}\n`);

  await connectDB();

  try {
    const results = await analyzeAllZonesDistance();

    console.log('\n' + '='.repeat(80));
    console.log('📊 DISTANCE ANALYSIS RESULTS');
    console.log('='.repeat(80) + '\n');

    // Display results for each zone
    const zones = ['A', 'B', 'C', 'D', 'E', 'F'];
    
    zones.forEach((zone) => {
      const zoneData = results[zone];
      if (!zoneData) {
        console.log(`\n⚠️  Zone ${zone}: No data available\n`);
        return;
      }

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`📍 ZONE ${zone}`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`Total Towns: ${zoneData.totalTowns}`);
      console.log(`Successful: ${zoneData.successfulTowns}`);
      if (zoneData.failedTowns > 0) {
        console.log(`Failed: ${zoneData.failedTowns}`);
      }
      
      if (zoneData.closest) {
        console.log(`\n✅ Closest Town: ${zoneData.closest.town}`);
        console.log(`   Distance: ${zoneData.closest.distanceKm} km`);
      }
      
      if (zoneData.farthest) {
        console.log(`\n❌ Farthest Town: ${zoneData.farthest.town}`);
        console.log(`   Distance: ${zoneData.farthest.distanceKm} km`);
      }
      
      if (zoneData.average !== null) {
        console.log(`\n📊 Average Distance: ${zoneData.average} km`);
      }

      console.log(`\n📋 All Towns (sorted by distance):`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`${'Town'.padEnd(50)} | Distance (km)`);
      console.log(`${'─'.repeat(80)}`);
      
      zoneData.all.forEach((townData, index) => {
        if (townData.distanceKm !== null) {
          console.log(
            `${(index + 1).toString().padStart(3)}. ${townData.town.padEnd(47)} | ${townData.distanceKm.toFixed(2).padStart(10)} km`
          );
        } else {
          console.log(
            `${(index + 1).toString().padStart(3)}. ${townData.town.padEnd(47)} | ${'ERROR'.padStart(10)} ${townData.error || ''}`
          );
        }
      });
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ Analysis Complete!');
    console.log('='.repeat(80) + '\n');

    // Close database connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error during analysis:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
main();

