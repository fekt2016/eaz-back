const mongoose = require('mongoose');
const { Schema } = mongoose;

const PlatformRevenueSchema = new Schema({

    // ── LINKS ───────────────────────────────────────────────────
    orderId: {
        type: Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
    },

    platformFeeId: {
        type: Schema.Types.ObjectId,
        ref: 'PlatformFee',
        required: true,
        // Links back to the fee config that generated this revenue
    },

    // ── FEE SNAPSHOT ────────────────────────────────────────────
    // Store a snapshot so historical records survive fee config changes
    feeCode: { type: String, required: true },
    feeName: { type: String, required: true },
    feeType: {
        type: String, required: true,
        enum: [
            'tax', 'commission', 'shipping_cut',
            'payment_processing', 'withholding_tax',
            'listing_fee', 'withdrawal_fee', 'other'
        ]
    },
    calculationMethod: { type: String, required: true },
    rateApplied: { type: Number, required: true },
    // % or flat amount that was active at time of charge

    // ── AMOUNTS ─────────────────────────────────────────────────
    baseAmount: {
        type: Number,
        required: true,
        // The amount the fee was calculated against
        // e.g. order base price, shipping fee, seller payout
    },
    revenueAmount: {
        type: Number,
        required: true,
        // The actual GHS amount the platform earned from this fee
    },
    currency: { type: String, default: 'GHS', uppercase: true },

    // ── WHO PAID ────────────────────────────────────────────────
    paidBy: {
        type: String,
        enum: ['buyer', 'seller', 'platform'],
        required: true,
    },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', default: null },

    // ── TIMING ──────────────────────────────────────────────────
    chargeEvent: {
        type: String, required: true,
        enum: [
            'on_order_created', 'on_order_delivered',
            'on_payment_confirmed', 'on_product_save',
            'on_payout', 'on_withdrawal', 'on_refund',
            'on_listing_publish', 'on_subscription_renew'
        ]
    },
    chargedAt: { type: Date, default: Date.now },

    // ── SOURCE ──────────────────────────────────────────────────
    sourceModel: {
        type: String,
        enum: ['Order', 'ShippingCharge', 'Transaction', 'Payout'],
        required: true,
        // Tells you which model triggered this revenue record
    },
    sourceId: {
        type: Schema.Types.ObjectId,
        required: true,
        // The _id of the Order, ShippingCharge, etc. that triggered it
    },

    // ── STATUS ──────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['confirmed', 'pending', 'reversed'],
        default: 'confirmed',
        // reversed = when a refund cancels this revenue
    },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: null },

}, { timestamps: true });

// ── INDEXES for fast dashboard queries ──────────────────────
PlatformRevenueSchema.index({ feeType: 1, chargedAt: -1 });
PlatformRevenueSchema.index({ feeCode: 1, chargedAt: -1 });
PlatformRevenueSchema.index({ orderId: 1 });
PlatformRevenueSchema.index({ status: 1, chargedAt: -1 });
PlatformRevenueSchema.index({ chargedAt: -1 });

module.exports = mongoose.model('PlatformRevenue', PlatformRevenueSchema);
