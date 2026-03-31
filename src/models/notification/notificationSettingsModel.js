const mongoose = require('mongoose');

/**
 * User notification preferences (email, push, sms toggles).
 * Separate from Notification model which stores individual notification records.
 */
const notificationSettingsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    email: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: true },
      priceDrops: { type: Boolean, default: false },
      restockAlerts: { type: Boolean, default: true },
      accountSecurity: { type: Boolean, default: true },
      newsletters: { type: Boolean, default: false },
    },
    push: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
      priceDrops: { type: Boolean, default: true },
      restockAlerts: { type: Boolean, default: true },
      accountActivity: { type: Boolean, default: true },
    },
    sms: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
      securityAlerts: { type: Boolean, default: true },
    },
    app: {
      messages: { type: Boolean, default: true },
      friendActivity: { type: Boolean, default: false },
      recommendations: { type: Boolean, default: true },
    },
    frequency: {
      promotions: { type: String, default: 'weekly', enum: ['daily', 'weekly', 'monthly'] },
      newsletters: { type: String, default: 'monthly', enum: ['weekly', 'monthly', 'never'] },
    },
    quietHours: {
      enabled: { type: Boolean, default: false },
      startTime: { type: String, default: '22:00' },
      endTime: { type: String, default: '08:00' },
    },
  },
  { timestamps: true }
);

notificationSettingsSchema.index({ user: 1 });

const NotificationSettings = mongoose.model(
  'NotificationSettings',
  notificationSettingsSchema
);

module.exports = NotificationSettings;
