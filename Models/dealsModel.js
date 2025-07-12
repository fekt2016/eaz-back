const mongoose = require('mongoose');

const dealsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: {
    type: String,
  },
  productId: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
  ],
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  },
  discounValue: {
    type: Number,
    Required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Deals = new mongoose.model('Deals', dealsSchema);

module.exports = Deals;
