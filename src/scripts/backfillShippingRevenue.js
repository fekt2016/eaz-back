'use strict';

/**
 * Backfill Script: Create missing ShippingCharge and PlatformRevenue records
 * for all delivered orders that do not yet have them.
 *
 * Run with: node src/scripts/backfillShippingRevenue.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');

async function main() {
    const mongoUrl = process.env.MONGO_URL || '';
    const dbPassword = process.env.DATABASE_PASSWORD || '';
    const connectionString = mongoUrl.replace('<PASSWORD>', dbPassword);

    console.log('[Backfill] Connecting to MongoDB...');
    await mongoose.connect(connectionString);
    console.log('[Backfill] Connected.');

    // Register all required models
    require('../models/order/orderModel');
    require('../models/order/sellerOrderModel');
    require('../models/order/OrderItemModel');
    require('../models/ShippingCharge');
    require('../models/platform/platformRevenueModel');
    require('../models/platform/platformFeeModel');
    require('../models/user/userModel');
    require('../models/user/sellerModel');

    const Order = mongoose.model('Order');
    const ShippingCharge = mongoose.model('ShippingCharge');
    const shippingChargeService = require('../services/shippingChargeService');

    // Find all delivered orders
    const deliveredOrders = await Order.find({
        $or: [
            { currentStatus: 'delivered' },
            { currentStatus: 'delievered' },
            { orderStatus: 'delievered' },
            { status: 'completed' },
        ],
    }).select('_id orderNumber shippingFee shippingCost shippingChargeRecorded').lean();

    console.log(`[Backfill] Found ${deliveredOrders.length} delivered order(s).`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of deliveredOrders) {
        // Check if a ShippingCharge record already exists for this order
        const existing = await ShippingCharge.findOne({ orderId: order._id });

        if (existing) {
            console.log(`[Backfill] ⏭  Order ${order.orderNumber} already has ShippingCharge — skipping.`);
            skipped++;
            continue;
        }

        const shippingFee = order.shippingFee ?? order.shippingCost ?? 0;
        if (shippingFee <= 0) {
            console.log(`[Backfill] ⏭  Order ${order.orderNumber} has no shipping fee (${shippingFee}) — skipping.`);
            skipped++;
            continue;
        }

        try {
            await shippingChargeService.createShippingChargeRecord(order._id.toString(), null);

            // Mark order as having shipping charge recorded
            await Order.updateOne({ _id: order._id }, { $set: { shippingChargeRecorded: true } });

            console.log(`[Backfill] ✅ Order ${order.orderNumber}: ShippingCharge created.`);
            processed++;
        } catch (err) {
            console.error(`[Backfill] ❌ Order ${order.orderNumber}: Failed — ${err.message}`);
            failed++;
        }
    }

    console.log(`\n[Backfill] Done.`);
    console.log(`  Processed : ${processed}`);
    console.log(`  Skipped   : ${skipped}`);
    console.log(`  Failed    : ${failed}`);

    await mongoose.disconnect();
    console.log('[Backfill] Disconnected.');
}

main().catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
});
