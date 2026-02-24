const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Category = require('../src/models/category/categoryModel');
const Product = require('../src/models/product/productModel');

const shippingRates = {
    'Fashion': { dropship: 5, express: 4 },
    'Grocery': { dropship: 5, express: 4 },
    'Laptops': { dropship: 15, express: 10 },
    'Home': { dropship: 15, express: 10 },
    'Small Appliances': { dropship: 15, express: 10 },
    'Mobile Phones': { dropship: 8, express: 5 },
    'Tablets': { dropship: 8, express: 6 },
    'Televisions': { dropship: 15, express: 10 },
    'Large Appliances': { dropship: 45, express: 35 },
    'Kids & Baby': { dropship: 8, express: 6 },
    'Mixing & Blending': { dropship: 15, express: 8 },
    'Audio & Hifi': { dropship: 15, express: 10 },
    'Automotive': { dropship: 8, express: 6 },
    'Automotive Fluids & Maintenance': { dropship: 15, express: 10 },
    'Automotive Lighting': { dropship: 15, express: 10 },
    'Automotive Power & Battery': { dropship: 30, express: 30 },
    'Bulk Sporting Goods': { dropship: 30, express: 30 },
    'Computing Accessories': { dropship: 8, express: 6 },
    'Desktop, Monitors & Printers': { dropship: 15, express: 10 },
    'Kettles': { dropship: 15, express: 8 },
    'Irons': { dropship: 15, express: 8 },
    'Health & Beauty': { dropship: 5, express: 4 },
    'Hair Tools': { dropship: 8, express: 6 },
    'Grocery Bulk': { dropship: 30, express: 30 },
    'Gaming & Consoles': { dropship: 15, express: 10 },
    'Feature Phones': { dropship: 8, express: 5 },
    'Electronic Accessories': { dropship: 8, express: 6 },
    'Cameras': { dropship: 8, express: 6 },
    'RV Parts & Accessories': { dropship: 15, express: 10 }
};

async function migrateShippingContributions() {
    try {
        const DB = process.env.MONGO_URL.replace(
            '<PASSWORD>',
            process.env.DATABASE_PASSWORD
        );

        await mongoose.connect(DB, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');

        // 1. UPDATE CATEGORIES
        console.log('\n🔄 Migrating Categories...');
        const categories = await Category.find({});
        let updatedCount = 0;

        for (const cat of categories) {
            // Clear old rate field to prevent schema conflicts if any
            cat.shippingContributionRate = undefined;

            const rateConfig = shippingRates[cat.name];
            if (rateConfig) {
                cat.shippingContribution = {
                    dropship: rateConfig.dropship,
                    express: rateConfig.express
                };
            } else {
                cat.shippingContribution = { dropship: 0, express: 0 };
            }

            // Bypass validation just to force schema override efficiently
            await Category.updateOne({ _id: cat._id }, {
                $set: { shippingContribution: cat.shippingContribution },
                $unset: { shippingContributionRate: "" } // Explicitly remove old percentage field
            });
            console.log(`Updated Category: ${cat.name} -> Dropship: GHS ${cat.shippingContribution.dropship}, Express: GHS ${cat.shippingContribution.express}`);
            updatedCount++;
        }
        console.log(`✅ Successfully migrated ${updatedCount} Categories.`);

        // 2. UPDATE PRODUCTS
        console.log('\n🔄 Migrating Products (setting fulfillmentType to dropship)...');

        const result = await Product.updateMany(
            { fulfillmentType: { $exists: false } },
            { $set: { fulfillmentType: 'dropship' } }
        );

        console.log(`✅ Defaulted ${result.modifiedCount} products to dropship fulfillment.`);

        console.log('\n🎉 MIgration Completed Successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration Failed:', error);
        process.exit(1);
    }
}

migrateShippingContributions();
