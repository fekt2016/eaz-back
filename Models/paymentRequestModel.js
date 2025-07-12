import mongoose from 'mongoose';

const paymentRequestSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    requestDate: {
      type: Date,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'PayPal', 'Stripe', 'Other'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'rejected'],
      default: 'pending',
    },
    transactionId: String,
    paymentDate: Date,
    notes: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for formatted request date
paymentRequestSchema.virtual('formattedDate').get(function () {
  return this.requestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
});

// Virtual for formatted amount
paymentRequestSchema.virtual('formattedAmount').get(function () {
  return `$${this.amount.toFixed(2)}`;
});

const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

export default PaymentRequest;
