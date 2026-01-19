const NotificationSettings = require('../../models/notification/notificationModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const logger = require('../../utils/logger');

// Get user's notification settings
exports.getUserSettings = catchAsync(async (req, res, next) => {
  const settings = await NotificationSettings.findOne({ user: req.user.id });

  if (!settings) {
    const newSettings = await NotificationSettings.create({
      user: req.user.id,
      ...defaultSettings,
    });
    return res.json(newSettings);
  }

  res.status(200).json({ status: 'success', data: settings });
});

// Update notification settings
exports.updateSettings = catchAsync(async (req, res, next) => {
  logger.info('req.body', req.body);
  const updatedSettings = await NotificationSettings.findOneAndUpdate(
    { user: req.user.id },
    req.body,
    { new: true, runValidators: true },
  );
  logger.info('updatedSettings', updatedSettings);

  res.status(200).json(updatedSettings);
});

// Reset to default settings
exports.resetToDefaults = catchAsync(async (req, res, next) => {
  const settings = await NotificationSettings.findOneAndUpdate(
    { user: req.user.id },
    { ...defaultSettings },
    { new: true },
  );

  res.status(200).json(settings);
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
