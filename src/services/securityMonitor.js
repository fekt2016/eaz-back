const ActivityLog = require('../models/activityLog/activityLogModel');
const catchAsync = require('../utils/helpers/catchAsync');
const sendEmail = require('../utils/email/emailService');
const logger = require('../utils/logger');

/**
 * Security Monitor Service
 * Detects suspicious activities and manages security alerts
 */

/**
 * Detect if IP address has changed
 * @param {Object} user - User object
 * @param {String} currentIp - Current IP address
 * @param {String} role - User role
 * @returns {Promise<Object>} - Detection result
 */
const detectIPChange = async (user, currentIp, role) => {
  try {
    // Get last login activity for this user
    const lastLogin = await ActivityLog.findOne({
      userId: user._id || user.id,
      role,
      activityType: 'LOGIN',
    })
      .sort('-timestamp')
      .lean();

    if (!lastLogin || !lastLogin.ipAddress) {
      return { changed: false, previousIp: null };
    }

    const previousIp = lastLogin.ipAddress;
    const changed = previousIp !== currentIp && currentIp !== 'unknown';

    return {
      changed,
      previousIp: changed ? previousIp : null,
      currentIp: changed ? currentIp : null,
    };
  } catch (error) {
    logger.error('[SecurityMonitor] Error detecting IP change:', error);
    return { changed: false, previousIp: null };
  }
};

/**
 * Detect if device/user agent has changed
 * @param {Object} user - User object
 * @param {String} currentUserAgent - Current user agent
 * @param {String} role - User role
 * @returns {Promise<Object>} - Detection result
 */
const detectDeviceChange = async (user, currentUserAgent, role) => {
  try {
    // Get last login activity for this user
    const lastLogin = await ActivityLog.findOne({
      userId: user._id || user.id,
      role,
      activityType: 'LOGIN',
    })
      .sort('-timestamp')
      .lean();

    if (!lastLogin || !lastLogin.userAgent) {
      return { changed: false, previousDevice: null };
    }

    const previousDevice = lastLogin.userAgent;
    const changed = previousDevice !== currentUserAgent && currentUserAgent;

    return {
      changed,
      previousDevice: changed ? previousDevice : null,
      currentDevice: changed ? currentUserAgent : null,
    };
  } catch (error) {
    logger.error('[SecurityMonitor] Error detecting device change:', error);
    return { changed: false, previousDevice: null };
  }
};

/**
 * Detect multiple IPs used in last 24 hours
 * @param {Object} user - User object
 * @param {String} role - User role
 * @returns {Promise<Object>} - Detection result
 */
const detectMultipleIps = async (user, role) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentLogins = await ActivityLog.find({
      userId: user._id || user.id,
      role,
      activityType: 'LOGIN',
      timestamp: { $gte: twentyFourHoursAgo },
      ipAddress: { $exists: true, $ne: null, $ne: 'unknown' },
    })
      .select('ipAddress')
      .lean();

    const uniqueIps = [...new Set(recentLogins.map(log => log.ipAddress))];
    const count = uniqueIps.length;

    return {
      multipleIps: count > 3,
      ipCount: count,
      uniqueIps,
    };
  } catch (error) {
    logger.error('[SecurityMonitor] Error detecting multiple IPs:', error);
    return { multipleIps: false, ipCount: 0, uniqueIps: [] };
  }
};

/**
 * Detect geolocation mismatch (simplified - would need IP geolocation service)
 * @param {Object} user - User object
 * @param {String} currentIp - Current IP address
 * @param {String} role - User role
 * @returns {Promise<Object>} - Detection result
 */
const detectGeoMismatch = async (user, currentIp, role) => {
  try {
    // Get last login activity for this user
    const lastLogin = await ActivityLog.findOne({
      userId: user._id || user.id,
      role,
      activityType: 'LOGIN',
      location: { $exists: true, $ne: null },
    })
      .sort('-timestamp')
      .lean();

    // For now, we'll just check if location exists
    // In production, you'd use an IP geolocation service (e.g., ipapi.co, ip-api.com)
    // and compare country/region codes
    
    if (!lastLogin || !lastLogin.location) {
      return { mismatch: false, previousLocation: null };
    }

    // TODO: Implement actual geolocation lookup
    // For now, return false (no mismatch detected)
    return {
      mismatch: false,
      previousLocation: lastLogin.location,
      currentLocation: null, // Would be set by IP lookup service
    };
  } catch (error) {
    logger.error('[SecurityMonitor] Error detecting geo mismatch:', error);
    return { mismatch: false, previousLocation: null };
  }
};

/**
 * Compute risk level based on security events
 * @param {Object} events - Security events
 * @param {Boolean} events.ipChanged - IP changed
 * @param {Boolean} events.deviceChanged - Device changed
 * @param {Boolean} events.multipleIps - Multiple IPs in 24h
 * @param {Boolean} events.geoMismatch - Geolocation mismatch
 * @returns {String} - Risk level
 */
const computeRiskLevel = (events) => {
  const { ipChanged, deviceChanged, multipleIps, geoMismatch } = events;

  // Critical: Both IP and device changed + geo mismatch OR multiple IPs
  if ((ipChanged && deviceChanged && geoMismatch) || multipleIps) {
    return 'critical';
  }

  // High: Both IP and device changed
  if (ipChanged && deviceChanged) {
    return 'high';
  }

  // Medium: Either IP or device changed
  if (ipChanged || deviceChanged) {
    return 'medium';
  }

  // Low: No changes detected
  return 'low';
};

/**
 * Trigger security alert (email + log)
 * @param {Object} user - User object
 * @param {Object} log - Activity log entry
 * @param {String} role - User role
 * @returns {Promise<void>}
 */
const triggerSecurityAlert = async (user, log, role) => {
  try {
    const riskLevel = log.riskLevel || 'medium';
    const ipAddress = log.ipAddress || 'Unknown';
    const userAgent = log.userAgent || 'Unknown';
    const timestamp = log.timestamp || new Date();

    // Send email alert
    const emailSubject = `Security Alert: Suspicious Login Detected on Your ${role === 'admin' ? 'Admin' : role === 'seller' ? 'Seller' : 'User'} Account`;
    
    const emailMessage = `
      <h2>Security Alert</h2>
      <p>We detected a suspicious login attempt on your account.</p>
      <ul>
        <li><strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</li>
        <li><strong>IP Address:</strong> ${ipAddress}</li>
        <li><strong>Device:</strong> ${userAgent}</li>
        <li><strong>Risk Level:</strong> ${riskLevel.toUpperCase()}</li>
      </ul>
      <p>If this was not you, please change your password immediately and contact support.</p>
      <p>If this was you, you can safely ignore this email.</p>
    `;

    // Send email (if user has email)
    if (user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: emailSubject,
          message: emailMessage,
        });
        logger.info(`[SecurityMonitor] Security alert email sent to ${user.email}`);
      } catch (emailError) {
        logger.error('[SecurityMonitor] Error sending security alert email:', emailError);
      }
    }

    // Also notify admins for critical events
    if (riskLevel === 'critical') {
      // Log admin notification (would be handled by admin notification system)
      logger.info(`[SecurityMonitor] CRITICAL: Suspicious activity for ${role} ${user._id || user.id}`);
    }
  } catch (error) {
    logger.error('[SecurityMonitor] Error triggering security alert:', error);
  }
};

/**
 * Force logout if critical risk detected
 * @param {Object} user - User object
 * @param {String} role - User role
 * @returns {Promise<Object>} - Result with shouldLogout flag
 */
const forceLogoutIfCritical = async (user, role) => {
  try {
    // Check for critical risk in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const criticalActivity = await ActivityLog.findOne({
      userId: user._id || user.id,
      role,
      riskLevel: 'critical',
      timestamp: { $gte: fiveMinutesAgo },
    });

    if (criticalActivity) {
      return {
        shouldLogout: true,
        reason: 'Suspicious activity detected. Session terminated for security.',
        activityId: criticalActivity._id,
      };
    }

    return { shouldLogout: false };
  } catch (error) {
    logger.error('[SecurityMonitor] Error checking for force logout:', error);
    return { shouldLogout: false };
  }
};

/**
 * Get IP location using IP geolocation service
 * @param {String} ip - IP address
 * @returns {Promise<String>} - Location string (e.g., "Accra, Greater Accra, Ghana")
 */
const getIpLocation = async (ip) => {
  try {
    // Skip if IP is invalid or local
    if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return 'Local Network';
    }

    // Use ip-api.com (free tier: 45 requests/minute)
    // Alternative: ipapi.co, ipgeolocation.io, etc.
    const axios = require('axios');
const logger = require('../utils/logger');
    const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,lat,lon`, {
      timeout: 5000, // 5 second timeout
    });

    if (response.data && response.data.status === 'success') {
      const { city, regionName, country } = response.data;
      const locationParts = [];
      
      if (city) locationParts.push(city);
      if (regionName) locationParts.push(regionName);
      if (country) locationParts.push(country);
      
      return locationParts.length > 0 ? locationParts.join(', ') : 'Unknown Location';
    }

    return 'Unknown Location';
  } catch (error) {
    logger.error('[getIpLocation] Error fetching location:', error.message);
    // Fallback: return IP-based identifier
    return 'Location Unavailable';
  }
};

module.exports = {
  detectIPChange,
  detectDeviceChange,
  detectMultipleIps,
  detectGeoMismatch,
  computeRiskLevel,
  triggerSecurityAlert,
  forceLogoutIfCritical,
  getIpLocation,
};

