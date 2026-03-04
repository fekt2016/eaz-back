const mongoose = require('mongoose');

const shippingRateSchema = new mongoose.Schema({
    platformCutPercentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    isActive: {
        type: Boolean,
        default: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Enforce only one active rate
shippingRateSchema.pre('save', async function (next) {
    this.updatedAt = Date.now();

    // If this rate is being set to active, deactivate all others
    if (this.isActive) {
        await this.constructor.updateMany(
            { _id: { $ne: this._id } },
            { $set: { isActive: false } }
        );
    }
    next();
});

// Note: Named PlatformShippingRate to avoid collision with the existing ShippingRate model
// located in src/models/shipping/shippingRateModel.js that serves a different purpose
const PlatformShippingRate = mongoose.models.PlatformShippingRate || mongoose.model('PlatformShippingRate', shippingRateSchema);

module.exports = PlatformShippingRate;
