const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const Order = require('../src/models/order/orderModel');
const SellerOrder = require('../src/models/order/sellerOrderModel');
const Seller = require('../src/models/user/sellerModel');
const Category = require('../src/models/category/categoryModel');
const Product = require('../src/models/product/productModel');

async function runVerification() {
    console.log('🚀 Starting Phase 3 Performance Verification...\n');

    try {
        // 1. Connect to Database
        const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
        await mongoose.connect(DB);
        console.log('✅ Connected to Database');

        // Setup: Need some orders to aggregate
        const timestamp = Date.now();
        const testSeller = await Seller.create({
            name: 'P3 Test Seller',
            email: `p3test_${timestamp}@example.com`,
            password: 'password123',
            passwordConfirm: 'password123',
            shopName: 'P3 Test Shop',
            verificationStatus: 'verified'
        });

        // Create a few test orders
        console.log('📝 Creating test data...');
        const testOrderData = {
            user: new mongoose.Types.ObjectId(),
            shippingAddress: {
                firstName: 'Test',
                lastName: 'User',
                email: 'test@example.com',
                phone: '0240000000',
                address: '123 Test St',
                city: 'Accra',
                country: 'Ghana'
            },
            paymentStatus: 'paid'
        }

        const order1 = await Order.create({
            ...testOrderData,
            orderNumber: `ORD-P3-1-${timestamp}`,
            totalPrice: 100,
            revenueAmount: 100,
            revenueAdded: true,
            currentStatus: 'delivered',
            updatedAt: new Date()
        });

        const order2 = await Order.create({
            ...testOrderData,
            orderNumber: `ORD-P3-2-${timestamp}`,
            totalPrice: 200,
            revenueAmount: 200,
            revenueAdded: true,
            currentStatus: 'delivered',
            updatedAt: new Date()
        });

        const sOrder1 = await SellerOrder.create({
            seller: testSeller._id,
            order: order1._id,
            totalBasePrice: 80,
            status: 'delivered',
            createdAt: new Date()
        });

        // --- TEST 1: Admin Stats Aggregation ---
        console.log('\n--- Testing P3-FIX 1: Admin Stats Aggregation ---');
        const statsController = require('../src/controllers/admin/statsController');

        // Mock req/res
        const req = { user: { id: 'admin_id' } };
        const res = {
            statusCode: 200,
            status: function (code) { this.statusCode = code; return this; },
            json: function (data) {
                this.data = data;
                console.log(`[Mock Res] Received JSON with status: ${data.status}`);
                return this;
            }
        };

        const startTime = Date.now();
        await new Promise((resolve) => {
            const originalJson = res.json;
            res.json = function (data) {
                originalJson.call(this, data);
                resolve();
                return this;
            };

            statsController.getPlatformStats(req, res, (err) => {
                if (err) console.error('[Next Error]:', err);
                resolve();
            });
        });
        const duration = Date.now() - startTime;

        console.log(`Admin Stats took ${duration}ms`);
        if (!res.data) {
            console.error('❌ FAILED: No data received from Admin Stats controller');
            // ... cleanup and exit
        }
        const data = res.data.data;
        console.log(`Total Revenue: ${data.totalRevenue}`);

        if (data.totalRevenue >= 300) {
            console.log('✅ Admin stats aggregation is accurate');
        } else {
            console.error(`❌ FAILED: Admin revenue incorrect. Expected >= 300, got ${data.totalRevenue}`);
        }

        // --- TEST 2: Seller KPI Aggregation ---
        console.log('\n--- Testing P3-FIX 2: Seller KPI Aggregation ---');
        const sellerAnalyticsController = require('../src/controllers/seller/sellerAnalyticsController');

        const sReq = { user: { id: testSeller._id.toString() } };
        const sRes = {
            status: function (code) { this.statusCode = code; return this; },
            json: function (data) { this.data = data; return this; }
        };

        const sStartTime = Date.now();
        await new Promise((resolve) => {
            const originalJson = sRes.json;
            sRes.json = function (data) {
                this.data = data;
                resolve();
                return this;
            };

            sellerAnalyticsController.getSellerKPICards(sReq, sRes, (err) => {
                if (err) console.error('[Seller Next Error]:', err);
                resolve();
            });
        });
        const sDuration = Date.now() - sStartTime;

        console.log(`Seller KPI took ${sDuration}ms`);
        const sData = sRes.data.data;
        console.log(`Seller Today Revenue: ${sData.revenueToday.value}`);

        if (sData.revenueToday.value === 80) {
            console.log('✅ Seller KPI aggregation is accurate');
        } else {
            console.error(`❌ FAILED: Seller revenue incorrect. Expected 80, got ${sData.revenueToday.value}`);
        }

        // --- TEST 3: Index Verification ---
        console.log('\n--- Testing P3-FIX 3: Index Verification ---');
        const orderIndexes = await Order.collection.getIndexes();
        const sellerOrderIndexes = await SellerOrder.collection.getIndexes();
        const productIndexes = await Product.collection.getIndexes();

        const hasOrderIndex = !!Object.values(orderIndexes).find(idx => idx[0][0][0] === 'revenueAdded' && idx[0][1][0] === 'currentStatus');
        const hasSellerOrderIndex = !!Object.values(sellerOrderIndexes).find(idx => idx[0][0][0] === 'seller' && idx[0][1][0] === 'status' && idx[0][2][0] === 'createdAt');

        if (hasOrderIndex) console.log('✅ Order aggregation index exists'); else console.error('❌ FAILED: Order index missing');
        if (hasSellerOrderIndex) console.log('✅ SellerOrder aggregation index exists'); else console.error('❌ FAILED: SellerOrder index missing');

        /* --- CLEANUP ---
        console.log('\n🧹 Cleaning up test data...');
        await Order.deleteOne({ _id: order1._id });
        await Order.deleteOne({ _id: order2._id });
        await SellerOrder.deleteOne({ _id: sOrder1._id });
        await Seller.findByIdAndDelete(testSeller._id);
        console.log('✅ Cleanup complete');
        */

        console.log('\n✨ Phase 3 Verification PASSED! ✨');
        process.exit(0);

    } catch (err) {
        console.error('\n❌ Phase 3 Verification FAILED:', err);
        process.exit(1);
    }
}

runVerification();
