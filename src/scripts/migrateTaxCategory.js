/**
 * Migration Script: Add taxCategory to existing sellers
 * 
 * This script safely adds the taxCategory field to all existing sellers
 * Default value: 'individual' (3% withholding tax)
 * 
 * Run with: node backend/src/scripts/migrateTaxCategory.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Seller = require('../models/user/sellerModel');
const logger = require('../utils/logger');

const migrateTaxCategory = async () => {
  try {
    // Connect to MongoDB
    const DB = process.env.DATABASE.replace(
      '<PASSWORD>',
      process.env.DATABASE_PASSWORD
    );

    await mongoose.connect(DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    logger.info('✅ Connected to MongoDB');

    // Find all sellers without taxCategory or with null/undefined taxCategory
    const sellers = await Seller.find({
      $or: [
        { taxCategory: { $exists: false } },
        { taxCategory: null },
        { taxCategory: undefined },
      ],
    });

    logger.info(`📊 Found ${sellers.length} sellers to update`);

    if (sellers.length === 0) {
      logger.info('✅ No sellers need updating. Migration complete.');
      await mongoose.connection.close();
      return;
    }

    // Update all sellers to have taxCategory: 'individual' by default
    const result = await Seller.updateMany(
      {
        $or: [
          { taxCategory: { $exists: false } },
          { taxCategory: null },
          { taxCategory: undefined },
        ],
      },
      {
        $set: {
          taxCategory: 'individual',
        },
      }
    );

    logger.info(`✅ Updated ${result.modifiedCount} sellers with taxCategory: 'individual'`);
    logger.info('✅ Migration complete!');

    // Verify the update
    const remaining = await Seller.countDocuments({
      $or: [
        { taxCategory: { $exists: false } },
        { taxCategory: null },
        { taxCategory: undefined },
      ],
    });

    if (remaining === 0) {
      logger.info('✅ Verification: All sellers now have taxCategory field');
    } else {
      logger.warn(`⚠️  Warning: ${remaining} sellers still missing taxCategory`);
    }

    await mongoose.connection.close();
    logger.info('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run migration
migrateTaxCategory();

