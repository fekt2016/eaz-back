/**
 * Quick script to check and add a single town
 * Usage: node src/scripts/checkAndAddTown.js "Town Name, City, Country"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { geocodeAddress } = require('../services/googleMapsService');
const { getDistanceKm } = require('../services/distanceService');
const { classifyZone } = require('../services/zoneClassificationService');
const { WAREHOUSE_LOCATION } = require('../config/warehouseConfig');
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
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    throw error;
  }
}

async function checkAndAddTown(townName) {
  try {
    await connectDatabase();

    // Check if town exists
    const existing = await TownZoneAssignment.findOne({ town: townName.trim() });
    if (existing) {
      console.log('\n📋 Town Found in Database:');
      console.log('='.repeat(60));
      console.log(`Town: ${existing.town}`);
      console.log(`Zone: ${existing.zone}`);
      console.log(`Distance: ${existing.km} km`);
      console.log(`Coordinates: ${existing.lat}, ${existing.lng}`);
      console.log(`Google Name: ${existing.googleName || existing.geocodedAddress || 'N/A'}`);
      console.log(`Manual Override: ${existing.manualOverride ? 'Yes' : 'No'}`);
      console.log(`Updated: ${existing.updatedAt || existing.createdAt}`);
      console.log('='.repeat(60));
      return { exists: true, data: existing };
    }

    // Town doesn't exist, add it
    console.log(`\n📍 Town not found. Adding "${townName}"...\n`);

    // Step 1: Geocode
    console.log('📍 Geocoding...');
    const geocodeResult = await geocodeAddress(townName.trim());
    
    if (!geocodeResult || !geocodeResult.lat || !geocodeResult.lng) {
      console.error('❌ Failed to geocode town');
      return { exists: false, added: false, reason: 'geocode_failed' };
    }

    console.log(`✅ Geocoded: ${geocodeResult.formattedAddress}`);
    console.log(`   Coordinates: ${geocodeResult.lat}, ${geocodeResult.lng}`);

    // Step 2: Calculate distance
    console.log('\n📏 Calculating distance from warehouse...');
    const warehouseLat = WAREHOUSE_LOCATION.lat;
    const warehouseLng = WAREHOUSE_LOCATION.lng;
    const distanceResult = await getDistanceKm(
      warehouseLat,
      warehouseLng,
      geocodeResult.lat,
      geocodeResult.lng
    );
    const distanceKm = Math.round(distanceResult.distanceKm * 100) / 100;
    console.log(`✅ Distance: ${distanceKm} km`);

    // Step 3: Classify zone
    const calculatedZone = classifyZone(distanceKm);
    console.log(`✅ Assigned Zone: ${calculatedZone}`);

    // Step 4: Create assignment
    const newAssignment = new TownZoneAssignment({
      town: townName.trim(),
      km: distanceKm,
      zone: calculatedZone,
      lat: geocodeResult.lat,
      lng: geocodeResult.lng,
      geocodedAddress: geocodeResult.formattedAddress || townName.trim(),
      googleName: geocodeResult.formattedAddress || townName.trim(),
      manualOverride: false,
      updatedAt: new Date(),
    });

    await newAssignment.save();

    console.log('\n✅ Town Added Successfully:');
    console.log('='.repeat(60));
    console.log(`Town: ${newAssignment.town}`);
    console.log(`Zone: ${newAssignment.zone}`);
    console.log(`Distance: ${newAssignment.km} km`);
    console.log(`Coordinates: ${newAssignment.lat}, ${newAssignment.lng}`);
    console.log(`Google Name: ${newAssignment.googleName}`);
    console.log('='.repeat(60));

    return { exists: false, added: true, data: newAssignment };
  } catch (error) {
    console.error('❌ Error:', error.message);
    return { exists: false, added: false, error: error.message };
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Get town name from command line argument
const townName = process.argv[2] || 'Lakeside, Accra, Ghana';

if (require.main === module) {
  checkAndAddTown(townName).then(() => {
    process.exit(0);
  });
}

module.exports = { checkAndAddTown };

