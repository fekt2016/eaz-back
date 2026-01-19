require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const ShippingZone = require('../models/shipping/shippingZoneModel');
const connectDB = require('../config/database');
const logger = require('../utils/logger');

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
    logger.info('✅ Connected to MongoDB');

    // Clear existing zones (optional - comment out if you want to keep existing data)
    // await ShippingZone.deleteMany({});
    // logger.info('🗑️  Cleared existing shipping zones');

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
          logger.info(`🔄 Updated Zone ${zoneData.name}`);
        } else {
          // Create new zone
          await ShippingZone.create(zoneData);
          results.created++;
          logger.info(`✅ Created Zone ${zoneData.name}`);
        }
      } catch (error) {
        results.errors.push(`Zone ${zoneData.name}: ${error.message}`);
        logger.error(`❌ Error processing Zone ${zoneData.name}:`, error.message);
      }
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 SEEDING SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`✅ Created: ${results.created} zones`);
    logger.info(`🔄 Updated: ${results.updated} zones`);
    logger.info(`⏭️  Skipped: ${results.skipped} zones`);
    logger.info(`❌ Errors: ${results.errors.length} zones`);

    if (results.errors.length > 0) {
      logger.info('\n❌ Errors encountered:');
      results.errors.forEach((err) => logger.info(`   - ${err}`));
    }

    // Display all zones
    const allZones = await ShippingZone.find({}).sort({ minKm: 1 });
    logger.info('\n📍 Current Shipping Zones:');
    allZones.forEach((zone) => {
      logger.info(
        `   Zone ${zone.name}: ${zone.minKm}-${zone.maxKm} km | Base: GH₵${zone.baseRate} | Per Kg: GH₵${zone.perKgRate} | Same-Day: ${zone.sameDayMultiplier}x | Express: ${zone.expressMultiplier}x`
      );
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

// Run if called directly
if (require.main === module) {
  seedShippingZones()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedShippingZones };

