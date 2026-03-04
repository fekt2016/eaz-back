const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });
async function run() {
    try {
        const mongoUrl = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
        await mongoose.connect(mongoUrl);
        const Product = require('./src/models/product/productModel');

        // Find all active & approved products that are currently hidden
        const result = await Product.updateMany(
            {
                status: { $in: ['active', 'out_of_stock'] },
                moderationStatus: 'approved',
                isDeleted: { $ne: true },
                isDeletedByAdmin: { $ne: true },
                isDeletedBySeller: { $ne: true },
                isVisible: false
            },
            { $set: { isVisible: true } }
        );

        console.log(`Migration Complete: Updated ${result.modifiedCount} products to be visible.`);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
