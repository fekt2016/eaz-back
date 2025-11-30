require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const ShippingZone = require('../models/shipping/shippingZoneModel');
const connectDB = require('../config/database');

/**
 * Seed Shipping Zones
 * Creates default shipping zones (A-F) with base rates and multipliers
 */

const shippingZones = [
  {
    name: 'A',
    minKm: 0,
    maxKm: 5,
    baseRate: 15,
    perKgRate: 2,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    estimatedDays: '1-2',
    isActive: true,
  },
  {
    name: 'B',
    minKm: 5,
    maxKm: 10,
    baseRate: 20,
    perKgRate: 3,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    estimatedDays: '2-3',
    isActive: true,
  },
  {
    name: 'C',
    minKm: 10,
    maxKm: 20,
    baseRate: 30,
    perKgRate: 4,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    estimatedDays: '2-3',
    isActive: true,
  },
  {
    name: 'D',
    minKm: 20,
    maxKm: 35,
    baseRate: 45,
    perKgRate: 6,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    estimatedDays: '3-4',
    isActive: true,
  },
  {
    name: 'E',
    minKm: 35,
    maxKm: 50,
    baseRate: 60,
    perKgRate: 8,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    estimatedDays: '4-5',
    isActive: true,
  },
  {
    name: 'F',
    minKm: 50,
    maxKm: 100,
    baseRate: 80,
    perKgRate: 10,
    sameDayMultiplier: 1.2,
    expressMultiplier: 1.4,
    estimatedDays: '5-7',
    isActive: true,
  },
];

async function seedShippingZones() {
  try {
    // Connect to MongoDB using the database config
    await connectDB();
    console.log('✅ Connected to MongoDB');

    // Clear existing zones (optional - comment out if you want to keep existing data)
    // await ShippingZone.deleteMany({});
    // console.log('🗑️  Cleared existing shipping zones');

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Seed each zone
    for (const zoneData of shippingZones) {
      try {
        const existing = await ShippingZone.findOne({ name: zoneData.name });

        if (existing) {
          // Update existing zone
          Object.assign(existing, zoneData);
          await existing.save();
          results.updated++;
          console.log(`🔄 Updated Zone ${zoneData.name}`);
        } else {
          // Create new zone
          await ShippingZone.create(zoneData);
          results.created++;
          console.log(`✅ Created Zone ${zoneData.name}`);
        }
      } catch (error) {
        results.errors.push(`Zone ${zoneData.name}: ${error.message}`);
        console.error(`❌ Error processing Zone ${zoneData.name}:`, error.message);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEEDING SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Created: ${results.created} zones`);
    console.log(`🔄 Updated: ${results.updated} zones`);
    console.log(`⏭️  Skipped: ${results.skipped} zones`);
    console.log(`❌ Errors: ${results.errors.length} zones`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      results.errors.forEach((err) => console.log(`   - ${err}`));
    }

    // Display all zones
    const allZones = await ShippingZone.find({}).sort({ minKm: 1 });
    console.log('\n📍 Current Shipping Zones:');
    allZones.forEach((zone) => {
      console.log(
        `   Zone ${zone.name}: ${zone.minKm}-${zone.maxKm} km | Base: GH₵${zone.baseRate} | Per Kg: GH₵${zone.perKgRate} | Same-Day: ${zone.sameDayMultiplier}x | Express: ${zone.expressMultiplier}x`
      );
    });

    console.log('\n✅ Seeding completed!');
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  seedShippingZones()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedShippingZones };

