/**
 * Migration Script for Coupon System V2
 * 
 * This script migrates existing coupons to the new schema:
 * - Adds default values for new fields
 * - Ensures backward compatibility
 * - Updates userUsageCount maps
 */

const mongoose = require('mongoose');
const CouponBatch = require('../src/models/coupon/couponBatchModel');
const dotenv = require('dotenv');

dotenv.config({ path: './.env' });

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD
);

async function migrateCoupons() {
  try {
    console.log('🔌 Connecting to database...');
    await mongoose.connect(DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Database connected successfully!');

    console.log('🔄 Starting coupon migration...');

    const batches = await CouponBatch.find({});

    console.log(`📦 Found ${batches.length} coupon batches to migrate`);

    let migrated = 0;
    let errors = 0;

    for (const batch of batches) {
      try {
        let needsUpdate = false;
        const updates = {};

        // Add default values for new fields if missing
        if (batch.maxDiscountAmount === undefined) {
          updates.maxDiscountAmount = null;
          needsUpdate = true;
        }

        if (!batch.applicableProducts) {
          updates.applicableProducts = [];
          needsUpdate = true;
        }

        if (!batch.applicableCategories) {
          updates.applicableCategories = [];
          needsUpdate = true;
        }

        if (batch.sellerFunded === undefined) {
          updates.sellerFunded = true; // Default: seller pays
          needsUpdate = true;
        }

        if (batch.platformFunded === undefined) {
          updates.platformFunded = false; // Default: platform doesn't pay
          needsUpdate = true;
        }

        if (batch.global === undefined) {
          updates.global = false; // Default: not global
          needsUpdate = true;
        }

        if (batch.maxUsagePerUser === undefined) {
          updates.maxUsagePerUser = 1; // Default: 1 use per user
          needsUpdate = true;
        }

        if (batch.stackingAllowed === undefined) {
          updates.stackingAllowed = false; // Default: no stacking
          needsUpdate = true;
        }

        if (!batch.createdBy) {
          // Set createdBy to seller if exists
          if (batch.seller) {
            updates.createdBy = batch.seller;
            updates.createdByModel = 'Seller';
            needsUpdate = true;
          }
        }

        // Initialize userUsageCount maps for all coupons
        if (batch.coupons && batch.coupons.length > 0) {
          let couponsUpdated = false;
          batch.coupons.forEach((coupon) => {
            if (!coupon.userUsageCount || !(coupon.userUsageCount instanceof Map)) {
              coupon.userUsageCount = new Map();
              couponsUpdated = true;
            }
          });
          if (couponsUpdated) {
            updates.coupons = batch.coupons;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await CouponBatch.findByIdAndUpdate(batch._id, updates, {
            runValidators: false, // Skip validation for migration
          });
          migrated++;
          console.log(`✅ Migrated batch: ${batch.name} (${batch._id})`);
        } else {
          console.log(`⏭️  Batch already up-to-date: ${batch.name} (${batch._id})`);
        }
      } catch (error) {
        errors++;
        console.error(`❌ Error migrating batch ${batch._id}:`, error.message);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${batches.length - migrated - errors}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log('\n🎉 Migration completed!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed.');
    process.exit(0);
  }
}

// Run migration
migrateCoupons();

