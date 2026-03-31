const mongoose = require('mongoose');
const { Schema } = mongoose;

const PlatformFeeSchema = new Schema({
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    value: { type: Number, required: true },
    calculationMethod: {
        type: String,
        enum: ['percentage', 'flat'],
        default: 'percentage'
    },
    feeType: {
        type: String,
        enum: ['tax', 'commission', 'shipping_cut', 'payment_processing', 'withdrawal_fee', 'other'],
        required: true
    },
    chargeEvent: {
        type: String,
        enum: [
            'on_order_created', 'on_order_delivered',
            'on_payment_confirmed', 'on_product_save',
            'on_payout', 'on_withdrawal', 'on_refund'
        ],
        required: true
    },
    appliedTo: {
        type: String,
        enum: ['buyer', 'seller', 'platform'],
        required: true
    },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('PlatformFee', PlatformFeeSchema);
