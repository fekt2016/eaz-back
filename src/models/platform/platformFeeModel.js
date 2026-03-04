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
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('PlatformFee', PlatformFeeSchema);
