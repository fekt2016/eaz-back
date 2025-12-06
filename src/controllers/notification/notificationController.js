const Notification = require('../../models/notification/notificationModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/**
 * Get all notifications for the authenticated user
 * Filtered by role (buyer/seller/admin)
 */
exports.getNotifications = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  let role = req.user.role;
  
  console.log(`[getNotifications] 🔍 Initial request - userId: ${userId}, role from req.user: ${role}`);
  
  // IMPORTANT: Check if user is actually an admin, seller, or buyer by checking the respective models
  // Sometimes req.user.role might not be set correctly
  if (!role || role === 'user') {
    // First check if user is an admin
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (admin) {
      role = 'admin';
      console.log(`[getNotifications] ✅ User ${userId} is an admin, correcting role from "${req.user.role}" to "admin"`);
    } else {
      // Then check if user is a seller
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(userId).select('role').lean();
      if (seller) {
        role = 'seller';
        console.log(`[getNotifications] ✅ User ${userId} is a seller, correcting role from "${req.user.role}" to "seller"`);
      } else {
        role = role || 'buyer';
        console.log(`[getNotifications] ℹ️ User ${userId} is a buyer (default)`);
      }
    }
  } else if (role === 'admin') {
    // Double-check admin exists even if role is set
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (!admin) {
      console.warn(`[getNotifications] ⚠️ User ${userId} has admin role but not found in Admin model, defaulting to buyer`);
      role = 'buyer';
    } else {
      console.log(`[getNotifications] ✅ Admin ${userId} confirmed in Admin model`);
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

  console.log(`[getNotifications] 📋 Query filter for ${role}:`, {
    userId: userId?.toString(),
    userModel,
    role,
    userIdType: typeof userId,
    originalRole: req.user.role,
    filter: JSON.stringify(filter)
  });

  // Optional query parameters
  const { type, read, limit = 50, page = 1 } = req.query;

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

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get notifications with strict filter
  let notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  console.log(`[getNotifications] 📊 Found ${notifications.length} notifications for ${role} user ${userId} with strict filter`);
  
  // Debug: Log sample notifications if any found
  if (notifications.length > 0) {
    console.log(`[getNotifications] 📝 Sample notifications:`, notifications.slice(0, 3).map(n => ({
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
    console.log(`[getNotifications] ⚠️ No notifications found with strict filter, trying fallback query...`);
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
      console.log(`[getNotifications] ⚠️ Found ${fallbackNotifications.length} notifications with fallback query (user ID only). Data inconsistency detected.`);
      console.log(`[getNotifications] 🔍 Sample notification:`, {
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
      console.log(`[getNotifications] 🔍 Debug: Found ${debugNotifications.length} notifications with user ${userId} (any role/model):`, 
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
      console.log(`[getNotifications] 🔍 Debug: Found ${roleNotifications.length} notifications with user ${userId} and role ${role} (any userModel):`, 
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
  let role = req.user.role;
  
  console.log(`[getUnreadCount] 🔍 Initial request - userId: ${userId}, role from req.user: ${role}`);
  
  // IMPORTANT: Check if user is actually an admin, seller, or buyer by checking the respective models
  // Sometimes req.user.role might not be set correctly
  if (!role || role === 'user') {
    // First check if user is an admin
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (admin) {
      role = 'admin';
      console.log(`[getUnreadCount] ✅ User ${userId} is an admin, correcting role from "${req.user.role}" to "admin"`);
    } else {
      // Then check if user is a seller
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(userId).select('role').lean();
      if (seller) {
        role = 'seller';
        console.log(`[getUnreadCount] ✅ User ${userId} is a seller, correcting role from "${req.user.role}" to "seller"`);
      } else {
        role = role || 'buyer';
        console.log(`[getUnreadCount] ℹ️ User ${userId} is a buyer (default)`);
      }
    }
  } else if (role === 'admin') {
    // Double-check admin exists even if role is set
    const Admin = require('../../models/user/adminModel');
    const admin = await Admin.findById(userId).select('role').lean();
    if (!admin) {
      console.warn(`[getUnreadCount] ⚠️ User ${userId} has admin role but not found in Admin model, defaulting to buyer`);
      role = 'buyer';
    } else {
      console.log(`[getUnreadCount] ✅ Admin ${userId} confirmed in Admin model`);
    }
  }

  // Determine userModel based on role
  let userModel = 'User';
  if (role === 'seller') {
    userModel = 'Seller';
  } else if (role === 'admin') {
    userModel = 'Admin';
  }

  // FIX: Use flexible filter - count all unread notifications for user
  // Don't require exact userModel/role match to handle data inconsistencies
  // First try strict filter, then fallback to user-only if needed
  const strictFilter = {
    user: userId,
    userModel: userModel,
    role: role,
    read: false,
  };

  console.log(`[getUnreadCount] 📋 Query filter for ${role}:`, {
    userId: userId?.toString(),
    userModel,
    role,
    originalRole: req.user.role,
    strictFilter: JSON.stringify(strictFilter)
  });

  // Try strict filter first
  let count = await Notification.countDocuments(strictFilter);

  console.log(`[getUnreadCount] 📊 Found ${count} unread notifications with strict filter for ${role} user ${userId}`);
  
  // FIX: If count is 0, check with flexible filter (user + read only)
  // This handles cases where notifications have mismatched userModel/role
  if (count === 0) {
    const flexibleFilter = {
      user: userId,
      read: false,
    };
    
    const flexibleCount = await Notification.countDocuments(flexibleFilter);
    console.log(`[getUnreadCount] 🔍 Flexible filter (user + read only) found ${flexibleCount} unread notifications`);
    
    if (flexibleCount > 0) {
      // Found notifications with flexible filter - check for data inconsistencies
      const sampleNotifications = await Notification.find(flexibleFilter).limit(3).lean();
      console.log(`[getUnreadCount] ⚠️ Data inconsistency detected - using flexible count. Sample notifications:`, sampleNotifications.map(n => ({
        id: n._id,
        user: n.user?.toString(),
        userModel: n.userModel,
        role: n.role,
        read: n.read,
        type: n.type,
        title: n.title
      })));
      
      // Use flexible count if it found notifications
      count = flexibleCount;
    } else {
      // No unread notifications at all
      const totalCount = await Notification.countDocuments({ user: userId });
      console.log(`[getUnreadCount] 🔍 Found ${totalCount} total notifications for user ${userId} (any role/model/read status)`);
      
      if (totalCount > 0) {
        const sampleNotifications = await Notification.find({ user: userId }).limit(3).lean();
        console.log(`[getUnreadCount] 🔍 Debug: Sample notifications:`, sampleNotifications.map(n => ({
          id: n._id,
          user: n.user?.toString(),
          userModel: n.userModel,
          role: n.role,
          read: n.read,
          type: n.type,
          title: n.title
        })));
      }
    }
  }

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
    console.log(`[markAsRead] ⚠️ Notification ${id} not found with strict filter, trying fallback query...`);
    notification = await Notification.findOne({
      _id: id,
      user: userId,
    });
    
    if (notification) {
      console.log(`[markAsRead] ⚠️ Found notification with fallback query. Data inconsistency detected:`, {
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

  console.log(`[markAsRead] ✅ Notification ${id} marked as read for ${role} user ${userId}`);

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
    console.log(`[deleteNotification] ⚠️ Notification ${id} not found with strict filter, trying fallback query...`);
    notification = await Notification.findOne({
      _id: id,
      user: userId,
    });
    
    if (notification) {
      console.log(`[deleteNotification] ⚠️ Found notification with fallback query. Data inconsistency detected:`, {
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

  // Delete the notification
  await Notification.findByIdAndDelete(notification._id);

  res.status(200).json({
    status: 'success',
    message: 'Notification deleted successfully',
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
    console.log(`[getNotification] ⚠️ Notification ${id} not found with strict filter, trying fallback query...`);
    notification = await Notification.findOne({
      _id: id,
      user: userId,
    });
    
    if (notification) {
      console.log(`[getNotification] ⚠️ Found notification with fallback query. Data inconsistency detected:`, {
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
    console.error('[createNotificationHelper] Error creating notification:', error);
    // Don't throw - return null so calling code can continue
    return null;
  }
};

