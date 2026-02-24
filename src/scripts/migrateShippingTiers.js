const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const Category = require('../models/category/categoryModel');
const ShippingTier = require('../models/shipping/shippingTierModel');

async function migrateCategories() {
    try {
        // 1. Connect to DB
        const dbUrl = process.env.MONGO_URL
            ? process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '')
            : String(process.env.DATABASE).replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '');
        await mongoose.connect(dbUrl);
        console.log('DB Connection Successful for Migration');

        // 2. Clear existing tiers (optional, but good for idempotency during dev)
        await ShippingTier.deleteMany({});
        console.log('Cleared old shipping tiers');

        // 3. Create Default Tiers based on the Audit Report
        const tiers = await ShippingTier.insertMany([
            {
                name: 'Tier 1 (Light & Small)',
                multiplier: 1.0,
                fragileSurcharge: 0,
                weightThreshold: 5,
                weightSurchargePerKg: 0,
            },
            {
                name: 'Tier 2 (Standard)',
                multiplier: 1.3,
                fragileSurcharge: 0,
                weightThreshold: 5,
                weightSurchargePerKg: 2, // +2 GHS per kg > 5kg
            },
            {
                name: 'Tier 3 (Heavy/Bulky)',
                multiplier: 2.0,
                fragileSurcharge: 0,
                weightThreshold: 5,
                weightSurchargePerKg: 5, // +5 GHS per kg > 5kg
            },
            {
                name: 'Tier 4 (Fragile)',
                multiplier: 1.5,
                fragileSurcharge: 20, // Flat +20 GHS handling
                weightThreshold: 5,
                weightSurchargePerKg: 2,
            },
        ]);

        console.log(`Created ${tiers.length} default shipping tiers`);

        // Get the ID for Tier 2 (Standard)
        const tier2 = tiers.find(t => t.name.includes('Tier 2'));

        if (!tier2) {
            throw new Error('Tier 2 was not created successfully');
        }

        // 4. Update Categories
        const result = await Category.updateMany(
            { shippingTierId: null }, // find categories where it is null/not set
            {
                $set: {
                    shippingTierId: tier2._id,
                    shippingContributionRate: 0
                }
            }
        );

        // Just to ensure all categories have it if they didn't match the previous query
        const catchAllResult = await Category.updateMany(
            { shippingTierId: { $exists: false } },
            {
                $set: {
                    shippingTierId: tier2._id,
                    shippingContributionRate: 0
                }
            }
        );

        console.log(`Migration completed. Updated ${result.modifiedCount + catchAllResult.modifiedCount} categories to Tier 2.`);

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        mongoose.connection.close();
        process.exit();
    }
}

migrateCategories();
