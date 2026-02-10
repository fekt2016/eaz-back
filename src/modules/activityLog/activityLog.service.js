const ActivityLog = require('../../models/activityLog/activityLogModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const logger = require('../../utils/logger');
const { getIpAddress } = require('../../utils/helpers/deviceUtils');

/**
 * Extract platform from request headers
 * @param {Object} req - Express request object
 * @returns {String} - Platform name (always returns a valid platform)
 */
const getPlatform = (req) => {
  if (!req || !req.headers) {
    return 'eazmain'; // Default if req is invalid
  }
  
  const platformHeader = req.headers['x-platform'] || req.headers['platform'];
  
  if (platformHeader) {
    const platform = platformHeader.toLowerCase();
    if (['eazmain', 'eazseller', 'eazadmin'].includes(platform)) {
      return platform;
    }
  }
  
  // Fallback: try to detect from URL path
  const url = req.originalUrl || req.url || '';
  if (url.includes('/admin') || url.includes('/api/v1/admin')) {
    return 'eazadmin';
  }
  if (url.includes('/seller') || url.includes('/api/v1/seller') || url.includes('/dashboard')) {
    return 'eazseller';
  }
  
  // Fallback: try to detect from user agent
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('admin')) {
    return 'eazadmin';
  }
  if (userAgent.includes('seller')) {
    return 'eazseller';
  }
  
  // Default to eazmain - always return a valid platform
  return 'eazmain';
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
const logActivity = async ({ userId, role, action, description, req = null, metadata = {}, activityType = 'OTHER', riskLevel = 'low', previousIp = null, location = null, platform: providedPlatform = null }) => {
  try {
    // Validate required fields
    if (!userId) {
      logger.error('[ActivityLog] Missing required field: userId');
      return null;
    }
    if (!role) {
      logger.error('[ActivityLog] Missing required field: role');
      return null;
    }
    if (!action) {
      logger.error('[ActivityLog] Missing required field: action');
      return null;
    }
    if (!description) {
      logger.error('[ActivityLog] Missing required field: description');
      return null;
    }

    const ipAddress = req ? getIpAddress(req) : null;
    const userAgent = req?.headers['user-agent'] || null;
    
    // Get platform - use provided platform, or extract from req, or default to 'eazmain'
    let platform = providedPlatform;
    if (!platform && req) {
      platform = getPlatform(req);
    }
    if (!platform || !['eazmain', 'eazseller', 'eazadmin'].includes(platform)) {
      platform = 'eazmain'; // Default fallback
    }
    
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

    logger.info(`[ActivityLog] Logged: ${action} (${activityType}); by ${role} (${userId}) - Risk: ${riskLevel} - Platform: ${platform}`);
    
    return activityLog;
  } catch (error) {
    // Don't throw error - logging should never break the main flow
    logger.error('[ActivityLog] Error logging activity:', error);
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
    logger.error('[ActivityLog] Async logging error:', error);
  });
};

module.exports = {
  logActivity,
  logActivityAsync,
  getIpAddress,
  getPlatform,
  getUserModel,
};

