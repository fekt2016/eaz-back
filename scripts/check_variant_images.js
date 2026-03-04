const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const DB_URI = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

async function checkVariantImages() {
    try {
        await mongoose.connect(DB_URI);
        const Product = require('../src/models/product/productModel');

        const products = await Product.find({ 'variants.0': { $exists: true } }).limit(5);

        for (const p of products) {
            console.log(`Product: ${p.name}`);
            console.log(`Variants:`);
            p.variants.forEach((v, index) => {
                console.log(`  [${index}] SKU: ${v.sku}, Images: ${v.images ? v.images.length : 0}`);
                if (v.images && v.images.length > 0) {
                    console.log(`    ${v.images.join(', ')}`);
                }
            });
            console.log('---');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        mongoose.disconnect();
    }
}

checkVariantImages();
