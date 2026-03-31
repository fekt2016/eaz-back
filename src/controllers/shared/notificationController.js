const NotificationSettings = require('../../models/notification/notificationSettingsModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const logger = require('../../utils/logger');

// Get user's notification settings
exports.getUserSettings = catchAsync(async (req, res, next) => {
  let settings = await NotificationSettings.findOne({ user: req.user.id });

  if (!settings) {
    settings = await NotificationSettings.create({
      user: req.user.id,
      ...defaultSettings,
    });
  }

  res.status(200).json({ status: 'success', data: settings });
});

// Update notification settings
exports.updateSettings = catchAsync(async (req, res, next) => {
  const allowed = ['email', 'push', 'sms', 'app', 'frequency', 'quietHours'];
  const update = {};
  allowed.forEach((key) => {
    if (req.body[key] && typeof req.body[key] === 'object') {
      update[key] = req.body[key];
    }
  });

  let updatedSettings = await NotificationSettings.findOneAndUpdate(
    { user: req.user.id },
    { $set: update },
    { new: true, runValidators: true }
  );

  if (!updatedSettings) {
    updatedSettings = await NotificationSettings.create({
      user: req.user.id,
      ...defaultSettings,
      ...update,
    });
  }

  res.status(200).json({ status: 'success', data: updatedSettings });
});

// Reset to default settings
exports.resetToDefaults = catchAsync(async (req, res, next) => {
  let settings = await NotificationSettings.findOneAndUpdate(
    { user: req.user.id },
    { $set: defaultSettings },
    { new: true, runValidators: true }
  );

  if (!settings) {
    settings = await NotificationSettings.create({
      user: req.user.id,
      ...defaultSettings,
    });
  }

  res.status(200).json({ status: 'success', data: settings });
});


const defaultSettings = {
  email: {
    orderUpdates: true,
    promotions: true,
    priceDrops: false,
    restockAlerts: true,
    accountSecurity: true,
    newsletters: false,
  },
  push: {
    orderUpdates: true,
    promotions: false,
    priceDrops: true,
    restockAlerts: true,
    accountActivity: true,
  },
  sms: {
    orderUpdates: true,
    promotions: false,
    securityAlerts: true,
  },
  app: {
    messages: true,
    friendActivity: false,
    recommendations: true,
  },
  frequency: {
    promotions: 'weekly',
    newsletters: 'monthly',
  },
  quietHours: {
    enabled: false,
    startTime: '22:00',
    endTime: '08:00',
  },
};
