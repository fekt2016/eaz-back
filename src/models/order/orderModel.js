const mongoose = require('mongoose');
// import OrderItems from './OrderItemModel.js';
// import SellerOrder from './sellerOrderModel.js';

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
    trackingNumber: {
      type: String,
      unique: true,
      sparse: true, // Allows null values but enforces uniqueness when present
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subtotal: {
      type: Number,
      default: 0,
      comment: 'Subtotal of all items (VAT-inclusive)',
    },
    shippingCost: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
      comment: 'Deprecated - use tax breakdown fields below',
    },
    totalPrice: {
      type: Number,
      default: 0,
      comment: 'Grand total including all taxes and shipping',
    },
    // Tax breakdown fields (Ghana GRA)
    totalBasePrice: {
      type: Number,
      default: 0,
      comment: 'Total base price before VAT',
    },
    totalVAT: {
      type: Number,
      default: 0,
      comment: 'Total VAT (12.5%)',
    },
    totalNHIL: {
      type: Number,
      default: 0,
      comment: 'Total NHIL (2.5%)',
    },
    totalGETFund: {
      type: Number,
      default: 0,
      comment: 'Total GETFund (2.5%)',
    },
    totalCovidLevy: {
      type: Number,
      default: 0,
      comment: 'Total COVID levy (1%)',
    },
    totalTax: {
      type: Number,
      default: 0,
      comment: 'Total of all taxes',
    },
    isVATInclusive: {
      type: Boolean,
      default: true,
      comment: 'Prices include 15% VAT',
    },
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
      enum: ['pending', 'paid', 'completed', 'failed', 'refunded', 'partial_refund'],
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
        'paystack',
        'payment_on_delivery',
        'credit_balance',
      ],
      default: 'mobile_money',
      required: true,
    },
    shippingAddress: { type: Object, required: true },
    shippingBreakdown: [
      {
        sellerId: String,
        shippingFee: Number,
        reason: String,
        hasHeavyItems: Boolean,
      },
    ],
    shippingCity: {
      type: String,
      enum: ['ACCRA', 'TEMA'],
    },
    deliveryMethod: {
      type: String,
      enum: ['pickup_center', 'dispatch', 'seller_delivery'],
    },
    pickupCenterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PickupCenter',
    },
    dispatchType: {
      type: String,
      enum: ['EAZSHOP', 'SELLER'],
    },
    // New shipping fields
    shippingType: {
      type: String,
      enum: ['same_day', 'standard', 'express'],
    },
    shippingFee: {
      type: Number,
      min: 0,
    },
    weight: {
      type: Number,
      min: 0,
    },
    deliveryEstimate: {
      type: String,
    },
    deliveryZone: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F'],
    },
    neighborhood: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Neighborhood',
    },
    deliverySpeed: {
      type: String,
      enum: ['next_day', 'same_day'],
    },
    // Shipping address change tracking
    oldShippingFee: {
      type: Number,
      min: 0,
    },
    newShippingFee: {
      type: Number,
      min: 0,
    },
    additionalAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    shippingDifferencePaid: {
      type: Boolean,
      default: false,
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    paymentReference: {
      type: String,
      // Paystack transaction reference
    },
    transactionId: {
      type: String,
      // Paystack transaction ID
    },
    paidAt: {
      type: Date,
      // Timestamp when payment was completed
    },
    status: {
      type: String,
      enum: [
        'pending',
        'paid',
        'confirmed',
        'processing',
        'partially_shipped',
        'completed',
        'cancelled',
      ],
      default: 'pending',
    },
    // Order Tracking System
    currentStatus: {
      type: String,
      enum: [
        'pending_payment',
        'payment_completed',
        'processing',
        'confirmed',
        'preparing',
        'ready_for_dispatch',
        'out_for_delivery',
        'delivered',
        'cancelled',
        'refunded',
      ],
      default: 'pending_payment',
    },
    trackingHistory: [
      {
        status: {
          type: String,
          enum: [
            'pending_payment',
            'payment_completed',
            'processing',
            'confirmed',
            'preparing',
            'ready_for_dispatch',
            'out_for_delivery',
            'delivered',
            'cancelled',
            'refunded',
          ],
        },
        message: {
          type: String,
          default: '',
        },
        location: {
          type: String,
          default: '',
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: 'updatedByModel',
        },
        updatedByModel: {
          type: String,
          enum: ['User', 'Seller', 'Admin'],
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    driverLocation: {
      lat: {
        type: Number,
      },
      lng: {
        type: Number,
      },
      lastUpdated: {
        type: Date,
      },
    },
    // Metadata for tracking order processing state
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Flag to prevent double-crediting sellers
    sellerCredited: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Flag to prevent double-counting revenue
    revenueAdded: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Seller payout status (default: pending, updated to paid when order is delivered)
    sellerPayoutStatus: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'pending',
      index: true,
    },
    // Revenue amount for this order (added to admin revenue at payment time)
    revenueAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Refund Request Fields
    refundRequested: {
      type: Boolean,
      default: false,
      index: true,
    },
    refundRequestDate: {
      type: Date,
    },
    refundReason: {
      type: String,
      enum: [
        'defective_product',
        'wrong_item',
        'not_as_described',
        'damaged_during_shipping',
        'late_delivery',
        'changed_mind',
        'duplicate_order',
        'other',
      ],
    },
    refundReasonText: {
      type: String,
      maxlength: 500,
    },
    refundAmount: {
      type: Number,
      min: 0,
    },
    refundStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'processing', 'completed'],
      default: 'pending',
      index: true,
    },
    refundRejectionReason: {
      type: String,
      maxlength: 500,
    },
    refundProcessedAt: {
      type: Date,
    },
    refundProcessedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'refundProcessedByModel',
    },
    refundProcessedByModel: {
      type: String,
      enum: ['Admin', 'Seller'],
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
module.exports = Order;;
