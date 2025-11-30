const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  paymentMethodId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'paymentMethod',
  },
  paymentStatus: { type: String, enum: ['pending', 'success', 'failed'] },
  amount: Number,
  transactionId: String,
  paymentDate: Date,
});
const Payment = mongoose.model('payment', paymentSchema);

module.exports = Payment;;
