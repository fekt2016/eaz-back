const mongoose = require('mongoose');

const shippingTierSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            comment: 'e.g., Tier 1 (Light), Tier 4 (Fragile)',
        },
        multiplier: {
            type: Number,
            required: true,
            default: 1.0,
            min: 0,
            comment: 'Base rate multiplier for this tier',
        },
        fragileSurcharge: {
            type: Number,
            default: 0,
            min: 0,
            comment: 'Flat surcharge for fragile items in this tier',
        },
        weightThreshold: {
            type: Number,
            default: 5,
            min: 0,
            comment: 'Weight threshold in kg before per-kg surcharge applies',
        },
        weightSurchargePerKg: {
            type: Number,
            default: 0,
            min: 0,
            comment: 'Added fee per kg over the weightThreshold',
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ShippingTier', shippingTierSchema);
