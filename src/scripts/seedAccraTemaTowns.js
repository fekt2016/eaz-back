/**
 * Seed Script: Add Accra and Tema Towns to Database
 * This script adds all towns from Accra and Tema to the TownZoneAssignment collection
 * It uses the same logic as the addTown endpoint to geocode and calculate zones
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { DELIVERY_ZONES } = require('../config/zonesWithTowns');
const { geocodeAddress } = require('../services/googleMapsService');
const { getDistanceKm } = require('../services/distanceService');
const { classifyZone } = require('../services/zoneClassificationService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');
const TownZoneAssignment = require('../models/shipping/townZoneAssignmentModel');

// Connect to database using the same method as database.js
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
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    throw error;
  }
}

// Extract all unique towns from Accra and Tema
function getAllAccraTemaTowns() {
  const allTowns = new Set();
  
  // Get all towns from all zones
  Object.values(DELIVERY_ZONES).forEach((zoneTowns) => {
    zoneTowns.forEach((town) => {
      // Filter for Accra and Tema towns only
      if (town.includes('Accra') || town.includes('Tema')) {
        allTowns.add(town);
      }
    });
  });
  
  return Array.from(allTowns).sort();
}

// Add a single town to the database
async function addTownToDatabase(town) {
  try {
    // Check if town already exists
    const existing = await TownZoneAssignment.findOne({ town: town.trim() });
    if (existing) {
      console.log(`⏭️  Skipping "${town}" - already exists`);
      return { success: false, reason: 'exists', town };
    }

    // Step 1: Geocode the town
    console.log(`📍 Geocoding "${town}"...`);
    const geocodeResult = await geocodeAddress(town.trim());
    
    if (!geocodeResult || !geocodeResult.lat || !geocodeResult.lng) {
      console.error(`❌ Failed to geocode "${town}"`);
      return { success: false, reason: 'geocode_failed', town };
    }

    // Step 2: Calculate distance from warehouse
    const warehouseLat = WAREHOUSE_LOCATION.lat;
    const warehouseLng = WAREHOUSE_LOCATION.lng;
    const distanceResult = await getDistanceKm(
      warehouseLat,
      warehouseLng,
      geocodeResult.lat,
      geocodeResult.lng
    );
    const distanceKm = Math.round(distanceResult.distanceKm * 100) / 100;

    // Step 3: Classify zone
    const calculatedZone = classifyZone(distanceKm);

    // Step 4: Create new assignment
    const newAssignment = new TownZoneAssignment({
      town: town.trim(),
      km: distanceKm,
      zone: calculatedZone,
      lat: geocodeResult.lat,
      lng: geocodeResult.lng,
      geocodedAddress: geocodeResult.formattedAddress || town.trim(),
      googleName: geocodeResult.formattedAddress || town.trim(),
      manualOverride: false,
      updatedAt: new Date(),
    });

    await newAssignment.save();
    console.log(`✅ Added "${town}" → Zone ${calculatedZone} (${distanceKm} km)`);
    return { success: true, town, zone: calculatedZone, distanceKm };
  } catch (error) {
    console.error(`❌ Error adding "${town}":`, error.message);
    return { success: false, reason: 'error', town, error: error.message };
  }
}

// Main function
async function seedAccraTemaTowns() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await connectDatabase();

    // Get all Accra and Tema towns
    const towns = getAllAccraTemaTowns();
    console.log(`\n📋 Found ${towns.length} unique Accra/Tema towns to process\n`);

    // Process towns in batches to avoid rate limiting
    const batchSize = 5;
    const results = {
      success: [],
      skipped: [],
      failed: [],
    };

    for (let i = 0; i < towns.length; i += batchSize) {
      const batch = towns.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} towns)...\n`);

      // Process batch sequentially to avoid overwhelming the API
      for (const town of batch) {
        const result = await addTownToDatabase(town);
        
        if (result.success) {
          results.success.push(result);
        } else if (result.reason === 'exists') {
          results.skipped.push(result);
        } else {
          results.failed.push(result);
        }

        // Small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Longer delay between batches
      if (i + batchSize < towns.length) {
        console.log('\n⏳ Waiting 2 seconds before next batch...\n');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEEDING SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully added: ${results.success.length} towns`);
    console.log(`⏭️  Skipped (already exist): ${results.skipped.length} towns`);
    console.log(`❌ Failed: ${results.failed.length} towns`);
    
    if (results.success.length > 0) {
      console.log('\n✅ Successfully added towns:');
      results.success.forEach((r) => {
        console.log(`   - ${r.town} → Zone ${r.zone} (${r.distanceKm} km)`);
      });
    }

    if (results.failed.length > 0) {
      console.log('\n❌ Failed towns:');
      results.failed.forEach((r) => {
        console.log(`   - ${r.town}: ${r.reason}${r.error ? ` - ${r.error}` : ''}`);
      });
    }

    console.log('\n✅ Seeding completed!');
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
if (require.main === module) {
  seedAccraTemaTowns();
}

module.exports = { seedAccraTemaTowns, getAllAccraTemaTowns };

