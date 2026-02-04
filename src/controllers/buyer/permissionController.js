const Permission = require('../../models/user/permissionModel');
const User = require('../../models/user/userModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');
const anonymizeUser = require('../../utils/helpers/anonymizeUser');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const { isMobileApp } = require('../../middleware/mobileAppGuard');
const { checkFeature, FEATURES } = require('../../utils/featureFlags');
const logger = require('../../utils/logger');
// Get permissions - creates default permissions if not found
exports.getPermissions = catchAsync(async (req, res, next) => {
  try {
    let permissions = await Permission.findOne({ user: req.user.id });

    // If permissions don't exist, create default permissions
    if (!permissions) {
      permissions = await Permission.create({
        user: req.user.id,
        emailPreferences: {
          promotions: true,
          newsletters: false,
          accountUpdates: true,
        },
        smsPreferences: {
          promotions: false,
          orderUpdates: true,
        },
        dataSharing: {
          analytics: true,
          personalizedAds: false,
          thirdParties: false,
        },
        locationAccess: 'limited',
        socialMediaSharing: false,
        accountVisibility: 'standard',
      });
    }

    // Return consistent API response format
    res.status(200).json({
      status: 'success',
      data: permissions,
    });
  } catch (error) {
    logger.error('[getPermissions] Error:', error);
    return next(new AppError('Failed to fetch permissions', 500));
  }
});

// Update email preferences
exports.updateEmailPrefs = catchAsync(async (req, res, next) => {
  const { promotions, newsletters, accountUpdates } = req.body;

  if (
    typeof promotions !== 'boolean' ||
    typeof newsletters !== 'boolean' ||
    typeof accountUpdates !== 'boolean'
  ) {
    return next(new AppError('Invalid email preference values', 400));
  }

  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: {
          'emailPreferences.promotions': promotions,
          'emailPreferences.newsletters': newsletters,
          'emailPreferences.accountUpdates': accountUpdates,
        },
        $setOnInsert: { user: req.user.id },
      },
      {
        new: true,
        runValidators: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!permissions) {
      return next(new AppError('Unable to update email preferences', 500));
    }

    return res.status(200).json(permissions.emailPreferences);
  } catch (error) {
    logger.error('[updateEmailPrefs] Error:', error);
    return next(new AppError('Invalid email preference data', 400));
  }
});

// Update SMS preferences
exports.updateSMSPrefs = catchAsync(async (req, res, next) => {
  const { promotions, orderUpdates } = req.body;

  if (typeof promotions !== 'boolean' || typeof orderUpdates !== 'boolean') {
    return next(new AppError('Invalid SMS preference values', 400));
  }

  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: {
          'smsPreferences.promotions': promotions,
          'smsPreferences.orderUpdates': orderUpdates,
        },
        $setOnInsert: { user: req.user.id },
      },
      {
        new: true,
        runValidators: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );
    if (!permissions) {
      return next(new AppError('Unable to update SMS preferences', 500));
    }
    res.status(200).json(permissions.smsPreferences);
  } catch (error) {
    logger.error('[updateSMSPrefs] Error:', error);
    res.status(400).json({ message: 'Invalid SMS preference data' });
  }
});

// Update data sharing
exports.updateDataSharing = catchAsync(async (req, res, next) => {
  const { analytics, personalizedAds, thirdParties } = req.body;
  if (
    typeof analytics !== 'boolean' ||
    typeof personalizedAds !== 'boolean' ||
    typeof thirdParties !== 'boolean'
  ) {
    return next(new AppError('Invalid data sharing values', 400));
  }

  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: {
          'dataSharing.analytics': analytics,
          'dataSharing.personalizedAds': personalizedAds,
          'dataSharing.thirdParties': thirdParties,
        },
        $setOnInsert: { user: req.user.id },
      },
      {
        new: true,
        runValidators: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );
    if (!permissions) {
      return next(new AppError('Unable to update data sharing settings', 500));
    }
    res.status(200).json(permissions.dataSharing);
  } catch (error) {
    logger.error('[updateDataSharing] Error:', error);
    res.status(400).json({ message: 'Invalid data sharing payload' });
  }
});

// Update location access
exports.updateLocationAccess = catchAsync(async (req, res, next) => {
  // Extract level from request body
  const { level } = req.body;

  logger.info('Received level:', level); // Should now log "full"

  // Validate level
  const allowedLevels = ['full', 'limited', 'none'];
  if (!allowedLevels.includes(level)) {
    return res.status(400).json({ message: 'Invalid access level' });
  }

  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: { locationAccess: level },
        $setOnInsert: { user: req.user.id },
      },
      {
        new: true,
        runValidators: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );
    logger.info('permissions', permissions);
    if (!permissions) {
      return next(new AppError('Unable to update location access', 500));
    }
    res.status(200).json({ locationAccess: permissions.locationAccess });
  } catch (error) {
    logger.error('[updateLocationAccess] Error:', error);
    res.status(400).json({ message: 'Invalid access level' });
  }
});

// Update social media sharing
exports.updateSocialSharing = catchAsync(async (req, res, next) => {
  const { socialMediaSharing } = req.body; // Correct property name

  if (typeof socialMediaSharing !== 'boolean') {
    return next(new AppError('Invalid social media sharing value', 400));
  }
  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: { socialMediaSharing },
        $setOnInsert: { user: req.user.id },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!permissions) {
      return next(new AppError('Unable to update social sharing preference', 500));
    }

    res.status(200).json({ socialMediaSharing: permissions.socialMediaSharing });
  } catch (error) {
    logger.error('[updateSocialSharing] Error:', error);
    res.status(500).json({ message: 'Unable to update social sharing' });
  }
});

// Update account visibility
exports.updateAccountVisibility = catchAsync(async (req, res, next) => {
  if (
    req.body.level !== 'standard' &&
    req.body.level !== 'private' &&
    req.body.level !== 'hidden'
  ) {
    return next(new AppError('Invalid visibility level', 400));
  }
  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: { accountVisibility: req.body.level },
        $setOnInsert: { user: req.user.id },
      },
      {
        new: true,
        runValidators: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );
    if (!permissions) {
      return next(new AppError('Unable to update account visibility', 500));
    }
    res.status(200).json({ accountVisibility: permissions.accountVisibility });
  } catch (error) {
    logger.error('[updateAccountVisibility] Error:', error);
    res.status(400).json({ message: 'Invalid visibility level' });
  }
});

// Request data download
exports.requestDataDownload = catchAsync(async (req, res, next) => {
  // 🛡️ MOBILE GUARD: Suspend for mobile app during debugging
  if (isMobileApp(req)) {
    console.warn('⚠️  [requestDataDownload] Blocked for mobile app (Saysay) - temporarily disabled for debugging');
    return res.status(200).json({
      status: 'disabled',
      message: 'Data export temporarily disabled for mobile app during debugging',
    });
  }

  // FEATURE FLAG: Check if data export is enabled
  if (!checkFeature(FEATURES.DATA_EXPORT, 'PermissionController')) {
    return res.status(503).json({
      status: 'disabled',
      message: 'Data export feature is temporarily unavailable. Please try again later.',
    });
  }

  try {
    const userId = req.user.id;
    const exportId = new mongoose.Types.ObjectId();

    // Update user document without triggering full validation
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          dataExports: {
            status: 'pending',
            requestedAt: new Date(),
            exportId: exportId,
          },
        },
      },
      { new: true, runValidators: false }, // Disable validators for this update
    );

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // TODO: Background jobs are disabled (Bull/Redis removed)
    // Data export functionality is temporarily unavailable
    // Mark export as failed since background processing is not available
    await User.updateOne(
      { _id: userId, 'dataExports.exportId': exportId },
      { $set: { 'dataExports.$.status': 'failed' } },
    );
    console.warn('[PermissionController] Data export requested but background jobs are disabled (Bull/Redis removed)');

    res.status(200).json({
      status: 'failed',
      message:
        'Data export is currently unavailable. Please try again later.',
      exportId,
    });
  } catch (error) {
    logger.error('Data export error:', error);
    next(new AppError('Could not process data export request', 500));
  }
});

exports.requestAccountDeletion = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  if (!user) {
    return next(new AppError('User not found', 404));
  }
  if (!user.password) {
    logger.error(`User ${req.user.id} has no password set`);
    return next(new AppError('Password not set for this account', 400));
  }

  // 2. Verify password - using updated method signature
  if (!(await user.correctPassword(req.body.password, user.password))) {
    console.log('Incorrect password');
    // SECURITY: Generic error message to prevent information leakage
    return next(new AppError('Invalid credentials', 401));
  }

  // Schedule deletion
  const updatedUser = await req.user.scheduleAccountDeletion(req.body.reason);

  // Invalidate all sessions
  await TokenBlacklist.invalidateAllSessions(req.user.id);

  res.status(200).json({
    status: 'success',
    message: 'Account scheduled for deletion. You have 30 days to cancel.',
    deletionDate: updatedUser.accountDeletion?.scheduledAt || null,
  });
});

exports.cancelAccountDeletion = catchAsync(async (req, res, next) => {
  const updatedUser = await req.user.cancelAccountDeletion();
  res.status(200).json({
    status: 'success',
    message: 'Account deletion cancelled',
    data: updatedUser.accountDeletion,
  });
});

exports.processAccountDeletions = catchAsync(async () => {
  const now = new Date();

  // Find users ready for deletion
  const users = await User.find({
    'accountDeletion.status': 'pending',
    'accountDeletion.scheduledAt': {
      $lte: now,
      $ne: null, // Exclude null values
    },
  }).select('+accountDeletion');

  for (const user of users) {
    try {
      // Update status to processing
      user.accountDeletion.status = 'processing';
      await user.save();

      // Anonymize user data
      await anonymizeUser(user._id);

      // Mark as completed
      user.accountDeletion.status = 'completed';
      user.accountDeletion.completedAt = new Date();
      user.active = false;
      await user.save();

      // Send confirmation email
      // sendDeletionConfirmation(user.originalEmail);
    } catch (error) {
      logger.error(`Failed to delete account ${user._id}:`, error);

      // Update status to failed
      user.accountDeletion.status = 'failed';
      await user.save();
    }
  }
});
