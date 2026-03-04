const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: './.env' });

// Import Models
const Product = require('../src/models/product/productModel');

async function findDuplicates() {
    try {
        // Connect to database
        let DB = process.env.MONGO_URL;
        if (DB) {
            DB = DB.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '');
        } else {
            console.error('❌ Database connection string (MONGO_URL) not found.');
            process.exit(1);
        }

        await mongoose.connect(DB);
        console.log('✅ Connected to MongoDB');

        console.log('Searching for duplicate SKUs...');

        const duplicates = await Product.aggregate([
            { $unwind: '$variants' },
            {
                $group: {
                    _id: '$variants.sku',
                    count: { $sum: 1 },
                    products: {
                        $addToSet: {
                            productId: '$_id',
                            productName: '$name',
                            variantId: '$variants._id'
                        }
                    }
                }
            },
            { $match: { count: { $gt: 1 }, _id: { $ne: null } } },
            { $sort: { count: -1 } }
        ]);

        if (duplicates.length === 0) {
            console.log('✅ No duplicate SKUs found!');
        } else {
            console.log(`⚠️ Found ${duplicates.length} duplicate SKUs:`);
            duplicates.forEach((dup, i) => {
                console.log(`\n[${i + 1}] SKU: ${dup._id} (Count: ${dup.count})`);
                dup.products.forEach(p => {
                    console.log(`   - Product: ${p.productName} (${p.productId}) | Variant: ${p.variantId}`);
                });
            });
        }

        process.exit(0);
    } catch (error) {
        console.error(`\n❌ ERROR: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

findDuplicates();
