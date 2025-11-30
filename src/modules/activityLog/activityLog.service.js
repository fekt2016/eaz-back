const ActivityLog = require('../../models/activityLog/activityLogModel');
const catchAsync = require('../../utils/helpers/catchAsync');

/**
 * Extract IP address from request
 * @param {Object} req - Express request object
 * @returns {String} - IP address
 */
const getIpAddress = (req) => {
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    (req.connection?.socket ? req.connection.socket.remoteAddress : null) ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
};

/**
 * Extract platform from request headers
 * @param {Object} req - Express request object
 * @returns {String} - Platform name
 */
const getPlatform = (req) => {
  const platformHeader = req.headers['x-platform'] || req.headers['platform'];
  
  if (platformHeader) {
    const platform = platformHeader.toLowerCase();
    if (['eazmain', 'eazseller', 'eazadmin'].includes(platform)) {
      return platform;
    }
  }
  
  // Fallback: try to detect from user agent or referer
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('admin') || req.originalUrl?.includes('/admin')) {
    return 'eazadmin';
  }
  if (userAgent.includes('seller') || req.originalUrl?.includes('/seller')) {
    return 'eazseller';
  }
  
  return 'eazmain'; // Default to main app
};

/**
 * Determine user model type from role
 * @param {String} role - User role
 * @returns {String} - Model name
 */
const getUserModel = (role) => {
  const roleModelMap = {
    buyer: 'User',
    seller: 'Seller',
    admin: 'Admin',
  };
  return roleModelMap[role] || 'User';
};

/**
 * Log an activity
 * @param {Object} params - Activity log parameters
 * @param {String} params.userId - User ID
 * @param {String} params.role - User role (buyer, seller, admin)
 * @param {String} params.action - Action performed
 * @param {String} params.description - Description of the action
 * @param {Object} params.req - Express request object (optional)
 * @param {Object} params.metadata - Additional metadata (optional)
 * @returns {Promise<Object>} - Created activity log
 */
const logActivity = async ({ userId, role, action, description, req = null, metadata = {}, activityType = 'OTHER', riskLevel = 'low', previousIp = null, location = null }) => {
  try {
    const ipAddress = req ? getIpAddress(req) : null;
    const userAgent = req?.headers['user-agent'] || null;
    const platform = req ? getPlatform(req) : 'eazmain';
    const userModel = getUserModel(role);

    const activityLog = await ActivityLog.create({
      userId,
      userModel,
      role,
      action,
      description,
      activityType: activityType || 'OTHER',
      ipAddress,
      previousIp: previousIp || null,
      userAgent,
      location: location || null,
      riskLevel: riskLevel || 'low',
      platform,
      metadata,
      timestamp: new Date(),
    });

    console.log(`[ActivityLog] Logged: ${action} (${activityType}) by ${role} (${userId}) - Risk: ${riskLevel}`);
    
    return activityLog;
  } catch (error) {
    // Don't throw error - logging should never break the main flow
    console.error('[ActivityLog] Error logging activity:', error);
    return null;
  }
};

/**
 * Log activity synchronously (fire and forget)
 * @param {Object} params - Activity log parameters
 */
const logActivityAsync = (params) => {
  // Fire and forget - don't wait for completion
  logActivity(params).catch((error) => {
    console.error('[ActivityLog] Async logging error:', error);
  });
};

module.exports = {
  logActivity,
  logActivityAsync,
  getIpAddress,
  getPlatform,
  getUserModel,
};

