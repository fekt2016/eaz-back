const mongoose = require('mongoose');

const creditbalanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    // required: true,
    // unique: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  availableBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  holdAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    default: 'GHS',
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  transactions: [
    {
      date: { type: Date, default: Date.now },
      amount: Number,
      type: {
        type: String,
        enum: ['topup', 'purchase', 'refund', 'bonus', 'withdrawal'],
      },
      description: String,
      reference: String,
    },
  ],
});

creditbalanceSchema.pre('save', function (next) {
  // Calculate available balance: balance - holdAmount
  // This ensures availableBalance reflects the actual spendable amount
  this.availableBalance = Math.max(0, (this.balance || 0) - (this.holdAmount || 0));
  next();
});

const Creditbalance = mongoose.model('Creditbalance', creditbalanceSchema);
module.exports = Creditbalance;;
