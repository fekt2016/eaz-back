/**
 * Script to get all towns from the database
 * Displays all towns with their zone assignments, distances, and coordinates
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const TownZoneAssignment = require('../models/shipping/townZoneAssignmentModel');

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
    console.log('✅ Connected to MongoDB\n');
    return true;
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    throw error;
  }
}

async function getAllTowns() {
  try {
    await connectDatabase();

    // Get all towns, sorted by zone then by distance
    const towns = await TownZoneAssignment.find({})
      .sort({ zone: 1, km: 1 })
      .lean();

    if (towns.length === 0) {
      console.log('📭 No towns found in the database.');
      return;
    }

    console.log('='.repeat(100));
    console.log(`📊 TOTAL TOWNS IN DATABASE: ${towns.length}`);
    console.log('='.repeat(100));
    console.log('');

    // Group by zone
    const townsByZone = {
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
      F: [],
    };

    towns.forEach((town) => {
      if (townsByZone[town.zone]) {
        townsByZone[town.zone].push(town);
      }
    });

    // Display by zone
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((zone) => {
      const zoneTowns = townsByZone[zone];
      if (zoneTowns.length > 0) {
        console.log('─'.repeat(100));
        console.log(`📍 ZONE ${zone} (${zoneTowns.length} towns)`);
        console.log('─'.repeat(100));
        
        zoneTowns.forEach((town, index) => {
          const override = town.manualOverride ? ' [MANUAL OVERRIDE]' : '';
          console.log(
            `${(index + 1).toString().padStart(3)}. ${town.town.padEnd(40)} | ` +
            `Distance: ${town.km?.toFixed(2).padStart(6)} km | ` +
            `Coords: ${town.lat?.toFixed(4)}, ${town.lng?.toFixed(4)}${override}`
          );
        });
        console.log('');
      }
    });

    // Summary statistics
    console.log('='.repeat(100));
    console.log('📈 SUMMARY STATISTICS');
    console.log('='.repeat(100));
    
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((zone) => {
      const zoneTowns = townsByZone[zone];
      if (zoneTowns.length > 0) {
        const distances = zoneTowns.map((t) => t.km).filter((d) => d != null);
        const avgDistance = distances.length > 0
          ? (distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(2)
          : 'N/A';
        const minDistance = distances.length > 0 ? Math.min(...distances).toFixed(2) : 'N/A';
        const maxDistance = distances.length > 0 ? Math.max(...distances).toFixed(2) : 'N/A';
        
        console.log(
          `Zone ${zone}: ${zoneTowns.length} towns | ` +
          `Avg: ${avgDistance} km | ` +
          `Range: ${minDistance} - ${maxDistance} km`
        );
      }
    });

    const manualOverrides = towns.filter((t) => t.manualOverride).length;
    console.log(`\nManual Overrides: ${manualOverrides}`);

    // Export to JSON file option
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(__dirname, '../../ALL_TOWNS_EXPORT.json');
    
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          total: towns.length,
          zones: townsByZone,
          allTowns: towns,
          summary: {
            byZone: ['A', 'B', 'C', 'D', 'E', 'F'].map((zone) => ({
              zone,
              count: townsByZone[zone].length,
            })),
            manualOverrides,
            exportedAt: new Date().toISOString(),
          },
        },
        null,
        2
      )
    );
    
    console.log(`\n💾 Exported to: ${outputPath}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

if (require.main === module) {
  getAllTowns().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { getAllTowns };

