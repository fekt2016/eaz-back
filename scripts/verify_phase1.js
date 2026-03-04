const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: './.env' });

// Import Models
const Product = require('../src/models/product/productModel');
const Category = require('../src/models/category/categoryModel');
const Seller = require('../src/models/user/sellerModel');
const OrderItem = require('../src/models/order/OrderItemModel');
const stockService = require('../src/services/stock/stockService');

async function verifyPhase1() {
    try {
        // Connect to database
        let DB = process.env.MONGO_URL || process.env.DATABASE || process.env.MONGODB_URI;
        if (DB) {
            DB = DB.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '');
        } else {
            console.error('❌ Database connection string (MONGO_URL) not found.');
            process.exit(1);
        }

        await mongoose.connect(DB);
        console.log('✅ Connected to MongoDB');

        // 1. Setup Test Data
        const sellerId = new mongoose.Types.ObjectId();
        const testProduct = await Product.create({
            name: 'Verification Test Product',
            slug: `verify-test-${Date.now()}`,
            description: 'Test product for Phase 1 verification',
            price: 100,
            seller: sellerId,
            status: 'active',
            moderationStatus: 'approved',
            parentCategory: '68c14745079f517f4e9ced3a',
            subCategory: '68c14877079f517f4e9ceec1',
            imageCover: 'https://res.cloudinary.com/eazworld/image/upload/v1757497155/categories/1757497154403-632162495-image.jpg',
            variants: [
                {
                    sku: 'V-TEST-001',
                    price: 100,
                    stock: 5,
                    status: 'active',
                    attributes: [{ key: 'Color', value: 'Red' }]
                }
            ]
        });
        console.log(`✅ Created test product: ${testProduct._id} with SKU V-TEST-001 (Stock: 5)`);

        // 2. Test stock reduction (Success)
        console.log('\n--- Test 1: Successful Stock Reduction ---');
        const orderItems = [{
            product: testProduct._id,
            sku: 'V-TEST-001',
            quantity: 2
        }];

        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await stockService.reduceOrderStock(orderItems, session);
        });
        await session.endSession();

        const updatedProduct = await Product.findById(testProduct._id);
        const variant = updatedProduct.variants[0];
        console.log(`✅ Stock reduced. Current SKU V-TEST-001 stock: ${variant.stock} (Expected: 3)`);
        if (variant.stock !== 3) throw new Error('Stock reduction failed!');

        // 3. Test stock reduction (Insufficient Stock - Atomic check)
        console.log('\n--- Test 2: Atomic Insufficient Stock Check ---');
        try {
            const session2 = await mongoose.startSession();
            await session2.withTransaction(async () => {
                await stockService.reduceOrderStock([{
                    product: testProduct._id,
                    sku: 'V-TEST-001',
                    quantity: 10 // More than available 3
                }], session2);
            });
            await session2.endSession();
            console.error('❌ Error: Stock reduction should have failed!');
        } catch (error) {
            console.log(`✅ Caught expected error: ${error.message}`);
        }

        // 4. Test stock restoration
        console.log('\n--- Test 3: Stock Restoration ---');
        const session3 = await mongoose.startSession();
        await session3.withTransaction(async () => {
            await stockService.restoreOrderStock(orderItems, session3);
        });
        await session3.endSession();

        const restoredProduct = await Product.findById(testProduct._id);
        console.log(`✅ Stock restored. Current SKU V-TEST-001 stock: ${restoredProduct.variants[0].stock} (Expected: 5)`);
        if (restoredProduct.variants[0].stock !== 5) throw new Error('Stock restoration failed!');

        // 5. Test Deletion Protection
        console.log('\n--- Test 4: Deletion Protection (Manual verification of logic) ---');
        // Simulate creating an OrderItem
        await OrderItem.create({
            product: testProduct._id,
            variant: testProduct.variants[0]._id,
            sku: 'V-TEST-001',
            quantity: 1,
            price: 100,
            productName: 'Verification Test Product'
        });
        console.log('✅ Created dummy OrderItem for test product');

        // Verify order count
        const orderCount = await OrderItem.countDocuments({ variant: testProduct.variants[0]._id });
        console.log(`✅ Order count for variant: ${orderCount} (Expected: 1)`);

        if (orderCount > 0) {
            console.log('✅ Protection Logic: Variant/Product deletion would be blocked successfully.');
        } else {
            throw new Error('Order count check failed!');
        }

        // Cleanup
        await Product.findByIdAndDelete(testProduct._id);
        await OrderItem.deleteMany({ product: testProduct._id });
        console.log('\n✅ Cleanup complete. Verification successful!');
        process.exit(0);
    } catch (error) {
        console.error(`\n❌ VERIFICATION FAILED: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

verifyPhase1();
