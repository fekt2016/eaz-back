const mongoose = require('mongoose');
const refundSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  amount: Number,
  reason: String,
  refundStatus: { type: String, enum: ['pending', 'success', 'failed'] },
  refundDate: Date,
});

const Refund = new mongoose.model('Refund', refundSchema);

module.exports = Refund;
