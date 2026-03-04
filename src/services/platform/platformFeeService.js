const PlatformFee = require('../../models/platform/platformFeeModel');

exports.getFeeByCode = async (code) => {
    return PlatformFee.findOne({ code, isActive: true });
};

exports.getFeesByEvent = async (eventCode) => {
    return PlatformFee.find({ chargeEvent: eventCode, isActive: true });
};

exports.calculateFee = (baseAmount, fee) => {
    if (!fee || !fee.isActive) return 0;
    if (fee.calculationMethod === 'flat') return fee.value;
    if (fee.calculationMethod === 'percentage') return baseAmount * fee.value;
    return 0;
};

exports.resolveOrderFees = async () => {
    return PlatformFee.find({ isActive: true });
};
