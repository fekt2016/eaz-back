const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  name: { type: String },
  type: { type: String, enum: ['mobile_money', 'payOnDel', 'bank_transfer'] },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
});

const PaymentMethod = new mongoose.model('Payment', paymentMethodSchema);

module.exports = PaymentMethod;
