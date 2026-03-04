const mongoose = require('mongoose');

const shippingChargeSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    buyerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Seller',
        required: true
    },
    dispatcherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Dispatcher'
    },
    totalShippingAmount: {
        type: Number,
        required: true
    },
    platformCut: {
        type: Number,
        required: true
    },
    dispatcherPayout: {
        type: Number,
        required: true
    },
    platformCutRate: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'settled', 'refunded'],
        default: 'pending'
    },
    calculatedAt: {
        type: Date,
        default: Date.now
    },
    settledAt: {
        type: Date
    },
    orderDeliveredAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

shippingChargeSchema.index({ orderId: 1 }, { unique: true });
shippingChargeSchema.index({ status: 1 });
shippingChargeSchema.index({ dispatcherId: 1 });
shippingChargeSchema.index({ createdAt: -1 });

shippingChargeSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

const ShippingCharge = mongoose.models.ShippingCharge || mongoose.model('ShippingCharge', shippingChargeSchema);

module.exports = ShippingCharge;
