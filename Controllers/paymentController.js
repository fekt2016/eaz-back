const Payment = require('../Models/paymentModel');
const handleFactory = require('../Controllers/handleFactory');

exports.getAllPayment = handleFactory.getAll(Payment);
exports.getPayment = handleFactory.getOne(Payment);
exports.createPayment = handleFactory.createOne(Payment);
exports.deletePayment = handleFactory.deleteOne(Payment);
exports.updatePayment = handleFactory.updateOne(Payment);
