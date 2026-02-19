/**
 * fixCategoryAttributes.js
 *
 * One-time migration script to populate subcategory attributes.
 * Run with:  node src/scripts/fixCategoryAttributes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category/categoryModel');

// ── Attribute definitions by subcategory ─────────────────────────────
const ATTRIBUTE_DEFINITIONS = {
    // ── Health & Beauty ──
    Fragrances: [
        {
            name: 'Size',
            type: 'enum',
            values: ['30ml', '50ml', '75ml', '100ml', '150ml', '200ml'],
            isRequired: true,
            isFilterable: true,
            isVariant: true,
        },
        {
            name: 'Concentration',
            type: 'enum',
            values: ['EDC', 'EDT', 'EDP', 'Parfum', 'Elixir'],
            isRequired: false,
            isFilterable: true,
            isVariant: true,
        },
        {
            name: 'Packaging',
            type: 'enum',
            values: ['With Box', 'Tester', 'Gift Set'],
            isRequired: false,
            isFilterable: true,
            isVariant: false,
        },
    ],

    // ── Fashion ──
    "Men's Clothing": [
        { name: 'Size', type: 'enum', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'], isRequired: true, isFilterable: true, isVariant: true },
        { name: 'Color', type: 'color', values: ['Black', 'White', 'Navy', 'Grey', 'Red', 'Blue', 'Green', 'Brown', 'Beige'], isRequired: false, isFilterable: true, isVariant: true },
    ],
    "Women's Clothing": [
        { name: 'Size', type: 'enum', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], isRequired: true, isFilterable: true, isVariant: true },
        { name: 'Color', type: 'color', values: ['Black', 'White', 'Navy', 'Grey', 'Red', 'Blue', 'Pink', 'Green', 'Beige'], isRequired: false, isFilterable: true, isVariant: true },
    ],
    "Children's Clothing": [
        { name: 'Size', type: 'enum', values: ['0-3M', '3-6M', '6-12M', '1-2Y', '2-3Y', '3-4Y', '5-6Y', '7-8Y', '9-10Y', '11-12Y'], isRequired: true, isFilterable: true, isVariant: true },
        { name: 'Color', type: 'color', values: ['Black', 'White', 'Navy', 'Grey', 'Red', 'Blue', 'Pink', 'Yellow', 'Green'], isRequired: false, isFilterable: true, isVariant: true },
    ],
    Shoes: [
        { name: 'Size', type: 'enum', values: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'], isRequired: true, isFilterable: true, isVariant: true },
        { name: 'Color', type: 'color', values: ['Black', 'White', 'Brown', 'Navy', 'Grey', 'Red'], isRequired: false, isFilterable: true, isVariant: true },
    ],

    // ── Electronics ──
    Smartphones: [
        { name: 'Storage', type: 'enum', values: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'], isRequired: true, isFilterable: true, isVariant: true },
        { name: 'Color', type: 'color', values: ['Black', 'White', 'Gold', 'Silver', 'Blue', 'Green', 'Purple', 'Red'], isRequired: false, isFilterable: true, isVariant: true },
    ],
    Laptops: [
        { name: 'RAM', type: 'enum', values: ['4GB', '8GB', '16GB', '32GB', '64GB'], isRequired: false, isFilterable: true, isVariant: true },
        { name: 'Storage', type: 'enum', values: ['128GB SSD', '256GB SSD', '512GB SSD', '1TB SSD', '1TB HDD'], isRequired: false, isFilterable: true, isVariant: true },
    ],
    Tablets: [
        { name: 'Storage', type: 'enum', values: ['32GB', '64GB', '128GB', '256GB', '512GB'], isRequired: false, isFilterable: true, isVariant: true },
        { name: 'Color', type: 'color', values: ['Black', 'White', 'Silver', 'Gold', 'Blue'], isRequired: false, isFilterable: true, isVariant: true },
    ],
};

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
    const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
    await mongoose.connect(DB);
    console.log('✅ Connected to database');

    const subcategories = await Category.find({ parentCategory: { $ne: null } });
    console.log(`Found ${subcategories.length} subcategories\n`);

    let updated = 0;
    let skipped = 0;

    for (const sub of subcategories) {
        const attrs = ATTRIBUTE_DEFINITIONS[sub.name];
        if (!attrs) {
            skipped++;
            continue;
        }

        sub.attributes = attrs;
        await sub.save({ validateBeforeSave: false });
        console.log(`  ✅ ${sub.name} → ${attrs.length} attributes`);
        updated++;
    }

    console.log(`\n🎉 Done: ${updated} updated, ${skipped} skipped (no definitions)`);
    await mongoose.connection.close();
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
