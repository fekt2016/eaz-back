const mongoose = require('mongoose');
// const OrderItems = require('./OrderItemModel');
// const SellerOrder = require('./sellerOrderModel');

const orderSchema = new mongoose.Schema(
  {
    orderItems: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OrderItems',
        required: true,
      },
    ],

    sellerOrder: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellerOrder',
        required: true,
      },
    ],
    orderNumber: {
      type: String,
      unique: true,
      required: true,
      default: () => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `ORD-${timestamp}-${random}`;
      },
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subtotal: Number,
    tax: Number,
    shippingCost: Number,
    subtotal: Number,
    tax: Number,
    totalPrice: Number,
    orderStatus: {
      type: String,
      enum: ['pending', 'shipped', 'delievered', 'cancelled'],
      default: 'pending',
    },
    FulfillmentStatus: {
      type: String,
      enum: ['pending', 'shipped', 'delievered', 'cancelled'],
      default: 'pending',
    },
    totalQty: {
      type: Number,
      default: 0,
    },
    totalSold: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded', 'partial_refund'],
      default: 'pending',
    },
    createdAt: {
      type: Date,
      default: Date.now(),
    },
    paymentMethod: {
      type: String,
      enum: [
        'card',
        'paypal',
        'bank_transfer',
        'mobile_money',
        'payment_on_delivery',
      ],
      default: 'mobile_money',
      required: true,
    },
    shippingAddress: { type: Object, required: true },
    platformFee: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'confirmed',
        'processing',
        'partially_shipped',
        'completed',
        'cancelled',
      ],
      default: 'pending',
    },
  },
  {
    timestamps: true,
    strictPopulate: false,
  },
);

orderSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

orderSchema.set('toJSON', { virtuals: true });

orderSchema.methods.updateOrderStatus = function () {
  const sellerOrders = this.sellerOrders;

  if (sellerOrders.every((o) => o.status === 'delivered')) {
    this.status = 'completed';
  } else if (sellerOrders.some((o) => o.status === 'shipped')) {
    this.status = 'partially_shipped';
  } else if (sellerOrders.some((o) => o.status === 'cancelled')) {
    const cancelledCount = sellerOrders.filter(
      (o) => o.status === 'cancelled',
    ).length;
    if (cancelledCount === sellerOrders.length) {
      this.status = 'cancelled';
    }
  }

  return this.save();
};

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
