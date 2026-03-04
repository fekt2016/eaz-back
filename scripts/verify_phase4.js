/**
 * verify_phase4.js — Phase 4: Cross-App Conflict Fixes Verification
 *
 * P4-FIX 1: Verify seller edit of an approved product auto-resets moderationStatus to 'pending'.
 * P4-FIX 2: Verify concurrent order status update with stale statusVersion returns 409 Conflict.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/product/productModel');
const Order = require('../src/models/order/orderModel');
const Seller = require('../src/models/user/sellerModel');

// --- Controllers ---
const sellerProductController = require('../src/controllers/seller/productController');
const orderTrackingController = require('../src/controllers/shared/orderTrackingController');

const MONGO_URL = process.env.MONGO_URL?.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '') || '';

const mockRes = () => {
    const res = { statusCode: 200, data: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.data = data; return res; };
    return res;
};

async function runVerification() {
    console.log('🚀 Starting Phase 4 Conflict Fix Verification...\n');

    if (!MONGO_URL) {
        console.error('❌ MONGO_URL is not set. Aborting.');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URL);
    console.log('✅ Connected to Database\n');

    let testSeller, testProduct, testOrder;
    let passed = 0;
    let failed = 0;

    try {
        // --- SETUP: Create test seller ---
        testSeller = await Seller.create({
            name: 'P4 Test Seller', shopName: 'P4 Test Shop',
            email: `p4test_${Date.now()}@example.com`,
            password: 'America1234567890',
            passwordConfirm: 'America1234567890',
            role: 'seller',
            phone: '233241234567',
            shopLocation: { country: 'Ghana' },
        });

        // --- SETUP: Create an approved product ---
        testProduct = await Product.create({
            name: 'P4 Test Product', seller: testSeller._id,
            price: 100, status: 'active',
            moderationStatus: 'approved', isVisible: true,
            imageCover: 'https://example.com/p4img.jpg',
            parentCategory: new mongoose.Types.ObjectId(),
            subCategory: new mongoose.Types.ObjectId(),
            description: 'P4 test description',
            variants: [{
                sku: `P4-SKU-${Date.now()}`,
                price: 100, stock: 10,
                attributes: [{ key: 'Color', value: 'Red' }],
            }],
        });
        console.log(`📝 Created test product: ${testProduct._id} (moderationStatus: ${testProduct.moderationStatus})`);

        // --- TEST P4-FIX 1: Seller editing approved product triggers re-review ---
        console.log('\n--- Testing P4-FIX 1: Auto-Resubmit on Seller Edit ---');

        const req = {
            params: { id: testProduct._id.toString() },
            body: { name: 'P4 Test Product (Updated)' },
            user: { id: testSeller._id.toString(), role: 'seller' },
        };
        const res = mockRes();
        const next = (err) => { res.error = err; };

        await new Promise((resolve) => {
            const originalJson = res.json;
            res.json = function (data) { this.data = data; resolve(); return this; };
            sellerProductController.updateProduct(req, res, (err) => { res.error = err; resolve(); });
        });

        const updatedProduct = await Product.findById(testProduct._id).select('moderationStatus isVisible name');
        console.log(`  moderationStatus after seller edit: ${updatedProduct.moderationStatus}`);
        console.log(`  isVisible after seller edit: ${updatedProduct.isVisible}`);

        if (updatedProduct.moderationStatus === 'pending' && updatedProduct.isVisible === false) {
            console.log('  ✅ PASS: Seller edit correctly reset approved product to pending review and hidden it.');
            passed++;
        } else {
            console.error(`  ❌ FAIL: Expected moderationStatus='pending' & isVisible=false. Got moderationStatus='${updatedProduct.moderationStatus}', isVisible=${updatedProduct.isVisible}`);
            failed++;
        }

        // --- TEST P4-FIX 2: Optimistic Locking ---
        console.log('\n--- Testing P4-FIX 2: Optimistic Locking for Order Status ---');

        testOrder = await Order.create({
            user: new mongoose.Types.ObjectId(),
            orderItems: [],
            sellerOrder: [],
            orderNumber: `ORD-P4-${Date.now()}`,
            paymentMethod: 'paystack',
            paymentStatus: 'paid',
            shippingAddress: { street: '1 Test St', city: 'Accra', country: 'Ghana' },
            currentStatus: 'confirmed',
            statusVersion: 0,
            totalPrice: 100,
        });
        console.log(`  Created test order: ${testOrder._id}, statusVersion: ${testOrder.statusVersion}`);

        const adminUser = { id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

        // Simulate first, valid update (send correct version=0)
        const req1 = {
            params: { orderId: testOrder._id.toString() },
            body: { status: 'processing', statusVersion: 0 },
            user: adminUser,
        };
        const res1 = mockRes();
        await new Promise((resolve) => {
            const origJson = res1.json;
            res1.json = function (data) { this.data = data; resolve(); return this; };
            orderTrackingController.updateOrderStatus(req1, res1, (err) => { res1.error = err; resolve(); });
        });

        if (res1.statusCode === 200 && res1.data?.data?.order?.statusVersion === 1) {
            console.log(`  ✅ First update succeeded: statusVersion is now ${res1.data.data.order.statusVersion}`);
            passed++;
        } else {
            console.error(`  ❌ First update failed unexpectedly. Error: ${res1.error?.message}`);
            failed++;
        }

        // Simulate stale second update (still sends version=0, which is now stale)
        const req2 = {
            params: { orderId: testOrder._id.toString() },
            body: { status: 'preparing', statusVersion: 0 }, // stale version!
            user: adminUser,
        };
        const res2 = mockRes();
        let conflictError = null;
        await new Promise((resolve) => {
            const origJson = res2.json;
            res2.json = function (data) { this.data = data; resolve(); return this; };
            orderTrackingController.updateOrderStatus(req2, res2, (err) => { conflictError = err; resolve(); });
        });

        if (conflictError && conflictError.statusCode === 409) {
            console.log(`  ✅ Stale update correctly rejected: ${conflictError.message.substring(0, 80)}...`);
            passed++;
        } else {
            console.error(`  ❌ Expected 409 Conflict for stale update, but got: statusCode=${conflictError?.statusCode || res2.statusCode}, error=${conflictError?.message}`);
            failed++;
        }

    } finally {
        // --- CLEANUP ---
        console.log('\n🧹 Cleaning up test data...');
        if (testProduct) await Product.findByIdAndDelete(testProduct._id);
        if (testOrder) await Order.findByIdAndDelete(testOrder._id);
        if (testSeller) await Seller.findByIdAndDelete(testSeller._id);
        console.log('✅ Cleanup complete');
        await mongoose.disconnect();
    }

    console.log(`\n✨ Phase 4 Verification Complete: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.error('❌ Phase 4 Verification FAILED');
        process.exit(1);
    } else {
        console.log('✅ All Phase 4 Fixes Verified Successfully!');
        process.exit(0);
    }
}

runVerification().catch((err) => {
    console.error('💥 Unhandled error in verification:', err);
    process.exit(1);
});
