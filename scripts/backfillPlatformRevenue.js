const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Models
const Order = require('../src/models/order/orderModel');
const ShippingCharge = require('../src/models/ShippingCharge');
const PlatformFee = require('../src/models/platform/platformFeeModel');
const PlatformRevenue = require('../src/models/platform/platformRevenueModel');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const setupPlatformFees = async () => {
    // Ensure VAT, NHIL, GETFUND, and SHIPPING_CUT exist
    const feesToCreate = [
        { code: 'VAT', name: 'Value Added Tax', value: 0.15, calculationMethod: 'percentage' },
        { code: 'NHIL', name: 'National Health Insurance Levy', value: 0.025, calculationMethod: 'percentage' },
        { code: 'GETFUND', name: 'GETFund Levy', value: 0.025, calculationMethod: 'percentage' },
        { code: 'SHIPPING_CUT', name: 'Platform Shipping Cut', value: 0.20, calculationMethod: 'percentage' }
    ];

    for (const feeData of feesToCreate) {
        await PlatformFee.findOneAndUpdate(
            { code: feeData.code },
            { $set: feeData },
            { upsert: true, new: true }
        );
    }
    console.log('Platform Fees initialized.');
};

const backfillTaxes = async (fees) => {
    // Find orders that are confirmed and above
    const orders = await Order.find({ paymentStatus: { $in: ['paid', 'completed'] } });

    let taxRevenueCreated = 0;

    for (const order of orders) {
        // Assume taxes were applied if the fields exist and are > 0
        if (order.totalVAT > 0) {
            await PlatformRevenue.findOneAndUpdate(
                { orderId: order._id, feeType: 'tax', feeCode: 'VAT' },
                {
                    $set: {
                        platformFeeId: fees.VAT._id,
                        feeName: fees.VAT.name,
                        calculationMethod: fees.VAT.calculationMethod,
                        rateApplied: fees.VAT.value,
                        baseAmount: order.totalBasePrice || 0,
                        revenueAmount: order.totalVAT,
                        paidBy: 'buyer',
                        buyerId: order.user,
                        chargeEvent: 'on_order_created',
                        sourceModel: 'Order',
                        sourceId: order._id,
                        status: ['refunded', 'cancelled'].includes(order.status) ? 'reversed' : 'confirmed',
                        chargedAt: order.createdAt
                    }
                },
                { upsert: true }
            );
            taxRevenueCreated++;
        }

        if (order.totalNHIL > 0) {
            await PlatformRevenue.findOneAndUpdate(
                { orderId: order._id, feeType: 'tax', feeCode: 'NHIL' },
                {
                    $set: {
                        platformFeeId: fees.NHIL._id,
                        feeName: fees.NHIL.name,
                        calculationMethod: fees.NHIL.calculationMethod,
                        rateApplied: fees.NHIL.value,
                        baseAmount: order.totalBasePrice || 0,
                        revenueAmount: order.totalNHIL,
                        paidBy: 'buyer',
                        buyerId: order.user,
                        chargeEvent: 'on_order_created',
                        sourceModel: 'Order',
                        sourceId: order._id,
                        status: ['refunded', 'cancelled'].includes(order.status) ? 'reversed' : 'confirmed',
                        chargedAt: order.createdAt
                    }
                },
                { upsert: true }
            );
            taxRevenueCreated++;
        }

        if (order.totalGETFund > 0) {
            await PlatformRevenue.findOneAndUpdate(
                { orderId: order._id, feeType: 'tax', feeCode: 'GETFUND' },
                {
                    $set: {
                        platformFeeId: fees.GETFUND._id,
                        feeName: fees.GETFUND.name,
                        calculationMethod: fees.GETFUND.calculationMethod,
                        rateApplied: fees.GETFUND.value,
                        baseAmount: order.totalBasePrice || 0,
                        revenueAmount: order.totalGETFund,
                        paidBy: 'buyer',
                        buyerId: order.user,
                        chargeEvent: 'on_order_created',
                        sourceModel: 'Order',
                        sourceId: order._id,
                        status: ['refunded', 'cancelled'].includes(order.status) ? 'reversed' : 'confirmed',
                        chargedAt: order.createdAt
                    }
                },
                { upsert: true }
            );
            taxRevenueCreated++;
        }
    }
    console.log(`Successfully backfilled ${taxRevenueCreated} tax revenue records.`);
};

const backfillShippingCuts = async (fees) => {
    const shippingCharges = await ShippingCharge.find({});

    let shippingRevenueCreated = 0;

    for (const charge of shippingCharges) {
        if (charge.platformCut > 0) {
            await PlatformRevenue.findOneAndUpdate(
                { orderId: charge.orderId, feeType: 'shipping_cut' },
                {
                    $set: {
                        platformFeeId: fees.SHIPPING_CUT._id,
                        feeCode: 'SHIPPING_CUT',
                        feeName: fees.SHIPPING_CUT.name,
                        calculationMethod: fees.SHIPPING_CUT.calculationMethod,
                        rateApplied: charge.platformCutRate || fees.SHIPPING_CUT.value,
                        baseAmount: charge.totalShippingAmount,
                        revenueAmount: charge.platformCut,
                        paidBy: 'seller',
                        sellerId: charge.sellerId,
                        chargeEvent: 'on_order_delivered',
                        sourceModel: 'ShippingCharge',
                        sourceId: charge._id,
                        status: charge.status === 'refunded' ? 'reversed' : 'confirmed',
                        chargedAt: charge.createdAt
                    }
                },
                { upsert: true }
            );
            shippingRevenueCreated++;
        }
    }
    console.log(`Successfully backfilled ${shippingRevenueCreated} shipping cut revenue records.`);
};

const runBackfill = async () => {
    try {
        await connectDB();
        await setupPlatformFees();

        // Load fee maps
        const feeDocs = await PlatformFee.find({});
        const fees = {};
        for (const doc of feeDocs) {
            fees[doc.code] = doc;
        }

        console.log('--- Starting Tax Revenue Backfill ---');
        await backfillTaxes(fees);

        console.log('--- Starting Shipping Cut Revenue Backfill ---');
        await backfillShippingCuts(fees);

        console.log('--- Backfill Complete ---');
        process.exit(0);
    } catch (err) {
        console.error('Backfill failed:', err);
        process.exit(1);
    }
};

runBackfill();
