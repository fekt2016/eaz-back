const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'userModel',
      required: [true, 'User is required'],
      index: true,
    },
    userModel: {
      type: String,
      enum: ['User', 'Seller', 'Admin'],
      required: true,
    },
    type: {
      type: String,
      enum: [
        'order',
        'delivery',
        'refund',
        'return',
        'support',
        'finance',
        'payout',
        'system',
        'product',
        'verification',
        'announcement',
      ],
      required: [true, 'Notification type is required'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
    role: {
      type: String,
      enum: ['buyer', 'seller', 'admin'],
      required: [true, 'Role is required'],
      index: true,
    },
    metadata: {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
      },
      ticketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupportTicket',
      },
      withdrawalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Withdrawal',
      },
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
      disputeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Dispute',
      },
      refundId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Refund',
      },
      verificationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Verification',
      },
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    actionUrl: {
      type: String,
      trim: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for performance
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ role: 1, read: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

// Virtual for checking if notification is expired
notificationSchema.virtual('isExpired').get(function () {
  if (this.expiresAt) {
    return new Date() > this.expiresAt;
  }
  return false;
});

// Pre-save middleware to set userModel based on role
notificationSchema.pre('save', function (next) {
  if (this.role === 'buyer') {
    this.userModel = 'User';
  } else if (this.role === 'seller') {
    this.userModel = 'Seller';
  } else if (this.role === 'admin') {
    this.userModel = 'Admin';
  }
  next();
});

// Static method to create notification
notificationSchema.statics.createNotification = async function (data) {
  const notification = new this(data);
  await notification.save();
  return notification;
};

// Instance method to mark as read
notificationSchema.methods.markAsRead = async function () {
  this.read = true;
  this.readAt = new Date();
  await this.save();
  return this;
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
