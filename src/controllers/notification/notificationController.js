const Notification = require('../../models/notification/notificationModel');
const DeviceToken = require('../../models/notification/deviceTokenModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const { isMobileApp, isFromScreen } = require('../../middleware/mobileAppGuard');

/**
 * Get all notifications for the authenticated user
 * Filtered by role (buyer/seller/admin)
 */
exports.getNotifications = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  let role = req.user.role;
  
  logger.info(`[getNotifications] 🔍 Initial request - userId: ${userId}, role from req.user: ${role}`);
  
  // IMPORTANT: Check if user is actually an admin, seller, or buyer by checking the respective models
  // Sometimes req.user.role might not be set correctly
  if (!role || role === 'user') {
    // First check if user is an admin
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (admin) {
      role = 'admin';
      logger.info(`[getNotifications] ✅ User ${userId} is an admin, correcting role from "${req.user.role}" to "admin"`);
    } else {
      // Then check if user is a seller
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(userId).select('role').lean();
      if (seller) {
        role = 'seller';
        logger.info(`[getNotifications] ✅ User ${userId} is a seller, correcting role from "${req.user.role}" to "seller"`);
      } else {
        role = role || 'buyer';
        logger.info(`[getNotifications] ℹ️ User ${userId} is a buyer (default);`);
      }
    }
  } else if (role === 'admin') {
    // Double-check admin exists even if role is set
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (!admin) {
      logger.warn(`[getNotifications] ⚠️ User ${userId} has admin role but not found in Admin model, defaulting to buyer`);
      role = 'buyer';
    } else {
      logger.info(`[getNotifications] ✅ Admin ${userId} confirmed in Admin model`);
    }
  }

  // Determine userModel based on role
  let userModel = 'User';
  if (role === 'seller') {
    userModel = 'Seller';
  } else if (role === 'admin') {
    userModel = 'Admin';
  }

  // Query filters - try both the specific role and also check if there are any notifications
  const filter = {
    user: userId,
    userModel: userModel,
    role: role,
  };

  logger.info(`[getNotifications] 📋 Query filter for ${role}:`, {
    userId: userId?.toString(),
    userModel,
    role,
    userIdType: typeof userId,
    originalRole: req.user.role,
    filter: JSON.stringify(filter)
  });

  // Optional query parameters
  const { type, read, limit = 50, page = 1, sort = '-createdAt' } = req.query;

  if (type) {
    filter.type = type;
  }

  if (read !== undefined) {
    // Handle both string and boolean values
    if (typeof read === 'string') {
      filter.read = read === 'true' || read === '1';
    } else {
      filter.read = Boolean(read);
    }
  }

  // Parse sort parameter (e.g., '-createdAt' or 'createdAt')
  let sortObj = { createdAt: -1 }; // Default sort
  if (sort) {
    const sortField = sort.startsWith('-') ? sort.substring(1) : sort;
    const sortDirection = sort.startsWith('-') ? -1 : 1;
    sortObj = { [sortField]: sortDirection };
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get notifications with strict filter
  let notifications = await Notification.find(filter)
    .sort(sortObj)
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  logger.info(`[getNotifications] 📊 Found ${notifications.length} notifications for ${role} user ${userId} with strict filter`);
  
  // Debug: Log sample notifications if any found
  if (notifications.length > 0) {
    logger.info(`[getNotifications] 📝 Sample notifications:`, notifications.slice(0, 3).map(n => ({
      id: n._id,
      title: n.title,
      type: n.type,
      read: n.read,
      role: n.role,
      userModel: n.userModel,
      user: n.user?.toString()
    })));
  }
  
  // If no notifications found with strict filter, try a fallback query by user ID only
  // This helps identify data inconsistencies and ensures we don't miss notifications
  if (notifications.length === 0) {
    logger.info(`[getNotifications] ⚠️ No notifications found with strict filter, trying fallback query...`);
    const fallbackFilter = { user: userId };
    if (type) fallbackFilter.type = type;
    if (read !== undefined) {
      // Handle both string and boolean values
      if (typeof read === 'string') {
        fallbackFilter.read = read === 'true' || read === '1';
      } else {
        fallbackFilter.read = Boolean(read);
      }
    }
    
    const fallbackNotifications = await Notification.find(fallbackFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    if (fallbackNotifications.length > 0) {
      logger.info(`[getNotifications] ⚠️ Found ${fallbackNotifications.length} notifications with fallback query (user ID only);. Data inconsistency detected.`);
      logger.info(`[getNotifications] 🔍 Sample notification:`, {
        user: fallbackNotifications[0].user?.toString(),
        userModel: fallbackNotifications[0].userModel,
        role: fallbackNotifications[0].role,
        expectedUserModel: userModel,
        expectedRole: role
      });
      // Use fallback results
      notifications = fallbackNotifications;
    } else {
      // Debug: Check if there are any notifications with this user ID at all
      const debugNotifications = await Notification.find({ user: userId }).limit(10).lean();
      logger.info(`[getNotifications] 🔍 Debug: Found ${debugNotifications.length} notifications with user ${userId} (any role/model);:`, 
        debugNotifications.map(n => ({
          id: n._id,
          user: n.user?.toString(),
          userModel: n.userModel,
          role: n.role,
          type: n.type,
          title: n.title,
          read: n.read
        }))
      );
      
      // Also check if there are notifications with the correct role but wrong userModel
      const roleNotifications = await Notification.find({ user: userId, role: role }).limit(5).lean();
      logger.info(`[getNotifications] 🔍 Debug: Found ${roleNotifications.length} notifications with user ${userId} and role ${role} (any userModel);:`, 
        roleNotifications.map(n => ({
          id: n._id,
          user: n.user?.toString(),
          userModel: n.userModel,
          role: n.role,
          type: n.type,
          title: n.title
        }))
      );
    }
  }

  // Get total count for pagination (use the filter that found results)
  const countFilter = notifications.length > 0 && notifications[0].userModel !== userModel 
    ? { user: userId } 
    : filter;
  if (type) countFilter.type = type;
  if (read !== undefined) {
    // Handle both string and boolean values
    if (typeof read === 'string') {
      countFilter.read = read === 'true' || read === '1';
    } else {
      countFilter.read = Boolean(read);
    }
  }
  
  const total = await Notification.countDocuments(countFilter);

  res.status(200).json({
    status: 'success',
    results: notifications.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    data: {
      notifications,
    },
  });
});

/**
 * Get unread notification count for the authenticated user
 */
exports.getUnreadCount = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const role = req.user.role || 'user';
  
  // OPTIMIZATION: Use simple filter - just count unread notifications for user
  // This is much faster than checking multiple models and doing multiple queries
  // The userModel/role fields in notifications may be inconsistent, so we just count by user + read
  const filter = {
    user: userId,
    read: false,
  };

  // Single database query - much faster
  const count = await Notification.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    data: {
      unreadCount: count,
    },
  });
});

/**
 * Mark a single notification as read
 */
exports.markAsRead = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  let role = req.user.role;
  
  // IMPORTANT: Check if user is actually an admin, seller, or buyer
  if (!role || role === 'user') {
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (admin) {
      role = 'admin';
    } else {
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(userId).select('role').lean();
      if (seller) {
        role = 'seller';
      } else {
        role = role || 'buyer';
      }
    }
  } else if (role === 'admin') {
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (!admin) {
      role = 'buyer';
    }
  }

  // Determine userModel based on role
  let userModel = 'User';
  if (role === 'seller') {
    userModel = 'Seller';
  } else if (role === 'admin') {
    userModel = 'Admin';
  }

  // Try strict filter first
  let notification = await Notification.findOne({
    _id: id,
    user: userId,
    userModel: userModel,
    role: role,
  });

  // FIX: If not found with strict filter, try fallback query by user ID only
  // This handles data inconsistencies where notification might have different userModel/role
  if (!notification) {
    logger.info(`[markAsRead] ⚠️ Notification ${id} not found with strict filter, trying fallback query...`);
    notification = await Notification.findOne({
      _id: id,
      user: userId,
    });
    
    if (notification) {
      logger.info(`[markAsRead] ⚠️ Found notification with fallback query. Data inconsistency detected:`, {
        notificationId: notification._id,
        storedUserModel: notification.userModel,
        storedRole: notification.role,
        expectedUserModel: userModel,
        expectedRole: role
      });
    }
  }

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  // Mark as read
  notification.read = true;
  notification.readAt = new Date();
  await notification.save();

  logger.info(`[markAsRead] ✅ Notification ${id} marked as read for ${role} user ${userId}`);

  res.status(200).json({
    status: 'success',
    data: {
      notification,
    },
  });
});

/**
 * Mark all notifications as read for the authenticated user
 */
exports.markAllAsRead = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  let role = req.user.role;
  
  // IMPORTANT: Check if user is actually an admin, seller, or buyer
  if (!role || role === 'user') {
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (admin) {
      role = 'admin';
    } else {
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(userId).select('role').lean();
      if (seller) {
        role = 'seller';
      } else {
        role = role || 'buyer';
      }
    }
  } else if (role === 'admin') {
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (!admin) {
      role = 'buyer';
    }
  }

  // Determine userModel based on role
  let userModel = 'User';
  if (role === 'seller') {
    userModel = 'Seller';
  } else if (role === 'admin') {
    userModel = 'Admin';
  }

  const result = await Notification.updateMany(
    {
      user: userId,
      userModel: userModel,
      role: role,
      read: false,
    },
    {
      $set: {
        read: true,
        readAt: new Date(),
      },
    }
  );

  res.status(200).json({
    status: 'success',
    message: `${result.modifiedCount} notifications marked as read`,
    data: {
      updatedCount: result.modifiedCount,
    },
  });
});

/**
 * Create a new notification
 * Can be used by admin for broadcasts or system-generated notifications
 */
exports.createNotification = catchAsync(async (req, res, next) => {
  const {
    user,
    type,
    title,
    message,
    role,
    metadata,
    priority,
    actionUrl,
    expiresAt,
  } = req.body;

  // Validate required fields
  if (!type || !title || !message || !role) {
    return next(
      new AppError('Type, title, message, and role are required', 400)
    );
  }

  // Determine userModel based on role
  let userModel = 'User';
  if (role === 'seller') {
    userModel = 'Seller';
  } else if (role === 'admin') {
    userModel = 'Admin';
  }

  // If user is not provided, this might be a broadcast (admin only)
  // For now, we require user to be provided
  if (!user) {
    return next(new AppError('User is required', 400));
  }

  const notificationData = {
    user,
    userModel,
    type,
    title,
    message,
    role,
    metadata: metadata || {},
    priority: priority || 'medium',
    actionUrl,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  };

  const notification = await Notification.create(notificationData);

  res.status(201).json({
    status: 'success',
    data: {
      notification,
    },
  });
});

/**
 * Delete a notification
 */
exports.deleteNotification = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  // OPTIMIZATION: Use simple filter - just check user ownership
  // This is much faster than checking multiple models and role matching
  const notification = await Notification.findOne({
    _id: id,
    user: userId,
  });

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  // Delete the notification
  await Notification.findByIdAndDelete(notification._id);

  res.status(200).json({
    status: 'success',
    message: 'Notification deleted successfully',
  });
});

/**
 * Delete multiple notifications by IDs
 * @route   DELETE /api/v1/notifications/bulk
 * @access  Private
 */
exports.deleteMultipleNotifications = catchAsync(async (req, res, next) => {
  const { ids } = req.body;
  const userId = req.user.id;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return next(new AppError('Notification IDs array is required', 400));
  }

  // Delete notifications that belong to the user
  const result = await Notification.deleteMany({
    _id: { $in: ids },
    user: userId,
  });

  res.status(200).json({
    status: 'success',
    message: `${result.deletedCount} notification(s) deleted successfully`,
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

/**
 * Delete all notifications for the authenticated user
 * @route   DELETE /api/v1/notifications/all
 * @access  Private
 */
exports.deleteAllNotifications = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Delete all notifications that belong to the user
  const result = await Notification.deleteMany({
    user: userId,
  });

  res.status(200).json({
    status: 'success',
    message: `${result.deletedCount} notification(s) deleted successfully`,
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

/**
 * Get notification by ID
 */
exports.getNotification = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  let role = req.user.role;
  
  // IMPORTANT: Check if user is actually an admin, seller, or buyer
  if (!role || role === 'user') {
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (admin) {
      role = 'admin';
    } else {
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(userId).select('role').lean();
      if (seller) {
        role = 'seller';
      } else {
        role = role || 'buyer';
      }
    }
  } else if (role === 'admin') {
    const Admin = require('../../models/user/adminModel');
const logger = require('../../utils/logger');
    const admin = await Admin.findById(userId).select('role').lean();
    if (!admin) {
      role = 'buyer';
    }
  }

  // Determine userModel based on role
  let userModel = 'User';
  if (role === 'seller') {
    userModel = 'Seller';
  } else if (role === 'admin') {
    userModel = 'Admin';
  }

  // Try strict filter first
  let notification = await Notification.findOne({
    _id: id,
    user: userId,
    userModel: userModel,
    role: role,
  });

  // FIX: If not found with strict filter, try fallback query by user ID only
  // This handles data inconsistencies where notification might have different userModel/role
  if (!notification) {
    logger.info(`[getNotification] ⚠️ Notification ${id} not found with strict filter, trying fallback query...`);
    notification = await Notification.findOne({
      _id: id,
      user: userId,
    });
    
    if (notification) {
      logger.info(`[getNotification] ⚠️ Found notification with fallback query. Data inconsistency detected:`, {
        notificationId: notification._id,
        storedUserModel: notification.userModel,
        storedRole: notification.role,
        expectedUserModel: userModel,
        expectedRole: role
      });
    }
  }

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      notification,
    },
  });
});

/**
 * Helper function to create notification (for use in other controllers)
 * This can be imported and used throughout the backend
 */
exports.createNotificationHelper = async ({
  user,
  role,
  type,
  title,
  message,
  metadata = {},
  priority = 'medium',
  actionUrl = null,
  expiresAt = null,
}) => {
  try {
    // Determine userModel based on role
    let userModel = 'User';
    if (role === 'seller') {
      userModel = 'Seller';
    } else if (role === 'admin') {
      userModel = 'Admin';
    }

    const notification = await Notification.create({
      user,
      userModel,
      type,
      title,
      message,
      role,
      metadata,
      priority,
      actionUrl,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    return notification;
  } catch (error) {
    logger.error('[createNotificationHelper] Error creating notification:', error);
    // Don't throw - return null so calling code can continue
    return null;
  }
};

/**
 * Register device token for push notifications
 * POST /api/v1/notifications/register-device
 */
exports.registerDevice = catchAsync(async (req, res, next) => {
  const { expoPushToken, platform, deviceInfo } = req.body;
  const userId = req.user.id;

  // 📱 CRITICAL: Log screen info for crash debugging
  const clientScreen = req.clientScreen || req.headers['x-client-screen'] || 'Unknown';
  const clientApp = req.clientApp || req.headers['x-client-app'] || 'Unknown';
  
  console.log('[registerDevice] 📱 Device registration request:', {
    app: clientApp,
    screen: clientScreen,
    userId,
    platform,
    tokenPrefix: expoPushToken?.substring(0, 20) + '...',
  });

  if (!expoPushToken) {
    return next(new AppError('Expo push token is required', 400));
  }

  if (!platform || !['ios', 'android'].includes(platform)) {
    return next(new AppError('Platform must be ios or android', 400));
  }

  try {
    console.log('[registerDevice] 📱 Registering device token:', {
      userId,
      platform,
      tokenPrefix: expoPushToken.substring(0, 20) + '...',
      deviceInfo,
      screen: clientScreen, // Include screen in log
    });

    // Find or create device token (prevents duplicates)
    const deviceToken = await DeviceToken.findOrCreate(
      userId,
      expoPushToken,
      platform,
      deviceInfo || {}
    );

    console.log('[registerDevice] ✅ Device token registered successfully:', {
      deviceTokenId: deviceToken._id,
      platform: deviceToken.platform,
      isActive: deviceToken.isActive,
      lastUsedAt: deviceToken.lastUsedAt,
    });

    res.status(200).json({
      status: 'success',
      data: {
        deviceToken: {
          id: deviceToken._id,
          platform: deviceToken.platform,
          lastUsedAt: deviceToken.lastUsedAt,
          isActive: deviceToken.isActive,
        },
      },
    });
  } catch (error) {
    console.error('[registerDevice] ❌ Error registering device token:', {
      error: error.message,
      stack: error.stack,
      userId,
      platform,
      tokenPrefix: expoPushToken?.substring(0, 20) + '...',
    });
    
    // CRITICAL: Don't crash server if device registration fails
    // This is a non-critical operation - app should continue working
    // Check if error is related to file operations (ERR_INVALID_ARG_TYPE)
    if (error.message && error.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('[registerDevice] 🚨 File operation error detected - this should not happen in device registration');
      console.error('[registerDevice] 🚨 This indicates a bug - device registration should not use file operations');
      console.error('[registerDevice] 🚨 Screen that triggered this:', clientScreen);
      console.error('[registerDevice] 🚨 App:', clientApp);
      console.error('[registerDevice] 🚨 Full error:', error);
      // Return a safe error response without crashing
      return res.status(500).json({
        status: 'error',
        message: 'Device registration temporarily unavailable',
      });
    }
    
    return next(new AppError('Failed to register device token', 500));
  }
});

/**
 * Unregister device token (on logout)
 * DELETE /api/v1/notifications/register-device
 */
exports.unregisterDevice = catchAsync(async (req, res, next) => {
  const { expoPushToken } = req.body;
  const userId = req.user.id;

  if (!expoPushToken) {
    return next(new AppError('Expo push token is required', 400));
  }

  try {
    await DeviceToken.deactivateToken(userId, expoPushToken);

    res.status(200).json({
      status: 'success',
      message: 'Device token unregistered successfully',
    });
  } catch (error) {
    console.error('[unregisterDevice] Error:', error);
    return next(new AppError('Failed to unregister device token', 500));
  }
});

