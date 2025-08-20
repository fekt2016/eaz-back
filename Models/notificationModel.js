const mongoose = require('mongoose');

const notificationSettingsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  email: {
    orderUpdates: Boolean,
    promotions: Boolean,
    priceDrops: Boolean,
    restockAlerts: Boolean,
    accountSecurity: Boolean,
    newsletters: Boolean,
  },
  push: {
    orderUpdates: Boolean,
    promotions: Boolean,
    priceDrops: Boolean,
    restockAlerts: Boolean,
    accountActivity: Boolean,
  },
  sms: {
    orderUpdates: Boolean,
    promotions: Boolean,
    securityAlerts: Boolean,
  },
  app: {
    messages: Boolean,
    friendActivity: Boolean,
    recommendations: Boolean,
  },
  frequency: {
    promotions: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
    },
    newsletters: {
      type: String,
      enum: ['weekly', 'monthly', 'quarterly'],
    },
  },
  quietHours: {
    enabled: Boolean,
    startTime: String,
    endTime: String,
  },
});

module.exports = mongoose.model(
  'NotificationSettings',
  notificationSettingsSchema,
);
