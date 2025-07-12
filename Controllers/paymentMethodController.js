const PaymentMethod = require('../Models/paymentMethod');

const handleFactory = require('../Controllers/handleFactory');

exports.getAllPaymentMthd = handleFactory.getAll(PaymentMethod);
exports.getPaymentMethod = handleFactory.getOne(PaymentMethod);
exports.createPaymentMethod = handleFactory.createOne(PaymentMethod);
exports.deletePaymentMethod = handleFactory.deleteOne(PaymentMethod);
exports.updatePaymentMethod = handleFactory.updateOne(PaymentMethod);
