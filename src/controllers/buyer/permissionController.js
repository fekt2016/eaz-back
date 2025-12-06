const Permission = require('../../models/user/permissionModel');
const User = require('../../models/user/userModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const dataExportQueue = require('../../jobs/queues/dataExportQueue');
const mongoose = require('mongoose');
const anonymizeUser = require('../../utils/helpers/anonymizeUser');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
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
    console.error('[getPermissions] Error:', error);
    return next(new AppError('Failed to fetch permissions', 500));
  }
});

// Update email preferences
exports.updateEmailPrefs = catchAsync(async (req, res, next) => {
  const { promotions, newsletters, accountUpdates } = req.body;

  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      { emailPreferences: { promotions, newsletters, accountUpdates } },
      { new: true, runValidators: true },
    );

    res.status(200).json(permissions.emailPreferences);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data' });
  }
  // res.send('ok');
});

// Update SMS preferences
exports.updateSMSPrefs = catchAsync(async (req, res, next) => {
  const preferences = req.body;
  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      { smsPreferences: preferences },
      { new: true, runValidators: true },
    );
    res.status(200).json(permissions.smsPreferences);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data' });
  }
});

// Update data sharing
exports.updateDataSharing = catchAsync(async (req, res, next) => {
  console.log(req.body);
  const data = req.body;
  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      { dataSharing: data },
      { new: true, runValidators: true },
    );
    res.json(permissions.dataSharing);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data' });
  }
});

// Update location access
exports.updateLocationAccess = catchAsync(async (req, res, next) => {
  // Extract level from request body
  const { level } = req.body;

  console.log('Received level:', level); // Should now log "full"

  // Validate level
  const allowedLevels = ['full', 'limited', 'none'];
  if (!allowedLevels.includes(level)) {
    return res.status(400).json({ message: 'Invalid access level' });
  }

  try {
    const permissions = await Permission.findOneAndUpdate(
      { user: req.user.id },
      { locationAccess: level },
      { new: true, runValidators: true },
    );
    console.log('permissions', permissions);
    res.json({ locationAccess: permissions.locationAccess });
  } catch (error) {
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
      { socialMediaSharing },
      { new: true },
    );

    res
      .status(200)
      .json({ socialMediaSharing: permissions.socialMediaSharing });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
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
      { accountVisibility: req.body.level },
      { new: true, runValidators: true },
    );
    res.json({ accountVisibility: permissions.accountVisibility });
  } catch (error) {
    res.status(400).json({ message: 'Invalid visibility level' });
  }
});

// Request data download
exports.requestDataDownload = catchAsync(async (req, res, next) => {
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

    // Add job to queue
    await dataExportQueue.add({
      userId: user._id,
      exportId: exportId,
      email: user.email,
    });

    res.status(200).json({
      message: 'Data export started. You will receive an email when ready.',
      exportId: exportId,
    });
  } catch (error) {
    console.error('Data export error:', error);
    next(new AppError('Could not process data export request', 500));
  }
});

exports.requestAccountDeletion = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  if (!user) {
    return next(new AppError('User not found', 404));
  }
  if (!user.password) {
    console.error(`User ${req.user.id} has no password set`);
    return next(new AppError('Password not set for this account', 400));
  }

  // 2. Verify password - using updated method signature
  if (!(await user.correctPassword(req.body.password, user.password))) {
    console.log('Incorrect password');
    return next(new AppError('Incorrect password', 401));
  }

  // Schedule deletion
  await req.user.scheduleAccountDeletion(req.body.reason);

  // Invalidate all sessions
  await TokenBlacklist.invalidateAllSessions(req.user.id);

  res.status(200).json({
    status: 'success',
    message: 'Account scheduled for deletion. You have 30 days to cancel.',
  });
});

exports.cancelAccountDeletion = catchAsync(async (req, res, next) => {
  await req.user.cancelAccountDeletion();
  res.status(200).json({
    status: 'success',
    message: 'Account deletion cancelled',
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
      console.error(`Failed to delete account ${user._id}:`, error);

      // Update status to failed
      user.accountDeletion.status = 'failed';
      await user.save();
    }
  }
});
