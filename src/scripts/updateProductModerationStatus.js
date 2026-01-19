/**
 * Script to update all products' moderationStatus to 'approved'
 * 
 * Usage: node src/scripts/updateProductModerationStatus.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/product/productModel');
const logger = require('../utils/logger');

// Load environment variables
dotenv.config({ path: './.env' });

// Database connection
const DB = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD
);

/**
 * Update all products' moderationStatus to 'approved'
 */
async function updateProductModerationStatus() {
  try {
    logger.info('🔌 Connecting to database...');
    await mongoose.connect(DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info('✅ Database connected successfully\n');

    // Count products before update
    const totalProducts = await Product.countDocuments();
    logger.info(`📊 Total products in database: ${totalProducts}`);

    // Count products by moderation status
    const statusCounts = await Product.aggregate([
      {
        $group: {
          _id: '$moderationStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    logger.info('\n📋 Current moderation status distribution:');
    statusCounts.forEach((status) => {
      const statusLabel = status._id || 'undefined';
      logger.info(`   ${statusLabel}: ${status.count}`);
    });

    // Update all products to 'approved'
    logger.info('\n🔄 Updating all products to moderationStatus: "approved"...');
    const updateResult = await Product.updateMany(
      {}, // Update all products
      {
        $set: {
          moderationStatus: 'approved',
        },
      }
    );

    logger.info(`\n✅ Update completed successfully!`);
    logger.info(`   Products matched: ${updateResult.matchedCount}`);
    logger.info(`   Products modified: ${updateResult.modifiedCount}`);

    // Verify the update
    const approvedCount = await Product.countDocuments({
      moderationStatus: 'approved',
    });
    const undefinedCount = await Product.countDocuments({
      $or: [
        { moderationStatus: { $exists: false } },
        { moderationStatus: null },
      ],
    });
    const pendingCount = await Product.countDocuments({
      moderationStatus: 'pending',
    });
    const rejectedCount = await Product.countDocuments({
      moderationStatus: 'rejected',
    });

    logger.info('\n📊 Final moderation status distribution:');
    logger.info(`   approved: ${approvedCount}`);
    if (undefinedCount > 0) {
      logger.info(`   undefined: ${undefinedCount}`);
    }
    if (pendingCount > 0) {
      logger.info(`   pending: ${pendingCount}`);
    }
    if (rejectedCount > 0) {
      logger.info(`   rejected: ${rejectedCount}`);
    }

    // Close connection
    await mongoose.connection.close();
    logger.info('\n✅ Database connection closed');
    logger.info('✅ Script completed successfully!\n');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error updating products:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  updateProductModerationStatus();
}

module.exports = updateProductModerationStatus;

