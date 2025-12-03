const { v4: uuidv4 } = require('uuid');
const UAParser = require('ua-parser-js');

/**
 * Generate a unique device ID
 */
exports.generateDeviceId = () => {
  return uuidv4();
};

/**
 * Detect device type from user agent
 */
exports.detectDeviceType = (userAgent) => {
  if (!userAgent) return 'unknown';

  const parser = new UAParser(userAgent);
  const device = parser.getDevice();

  if (device.type === 'mobile') {
    return 'mobile';
  } else if (device.type === 'tablet') {
    return 'tablet';
  } else if (device.type === 'desktop' || !device.type) {
    // If no device type detected, check OS
    const os = parser.getOS();
    if (os.name && (os.name.includes('Windows') || os.name.includes('Mac') || os.name.includes('Linux'))) {
      return 'desktop';
    }
    return 'desktop'; // Default to desktop
  }

  return 'unknown';
};

/**
 * Extract IP address from request
 */
exports.getIpAddress = (req) => {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown'
  );
};

/**
 * Get user agent from request
 */
exports.getUserAgent = (req) => {
  return req.headers['user-agent'] || 'unknown';
};

/**
 * Parse user agent for display
 */
exports.parseUserAgent = (userAgent) => {
  if (!userAgent || userAgent === 'unknown') {
    return {
      browser: 'Unknown',
      os: 'Unknown',
      device: 'Unknown',
    };
  }

  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  return {
    browser: browser.name ? `${browser.name} ${browser.version || ''}`.trim() : 'Unknown',
    os: os.name ? `${os.name} ${os.version || ''}`.trim() : 'Unknown',
    device: device.model || device.vendor || 'Unknown',
  };
};

/**
 * Determine platform from request headers or path
 */
exports.getPlatform = (req) => {
  // Check custom header first
  if (req.headers['x-platform']) {
    const platform = req.headers['x-platform'].toLowerCase();
    if (['eazmain', 'eazseller', 'eazadmin'].includes(platform)) {
      return platform;
    }
  }

  // Check path
  const path = req.originalUrl || req.path || '';
  if (path.includes('/admin/') || path.includes('/api/v1/admin/')) {
    return 'eazadmin';
  } else if (path.includes('/seller/') || path.includes('/api/v1/seller/')) {
    return 'eazseller';
  } else {
    return 'eazmain';
  }
};

/**
 * Check if device info is suspicious (new IP, new user-agent, new device)
 */
exports.isSuspiciousDevice = async (userId, ipAddress, userAgent, deviceId, DeviceSession) => {
  try {
    // Get recent sessions for this user
    const recentSessions = await DeviceSession.find({
      userId,
      isActive: true,
      loginTime: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
    }).limit(10);

    if (recentSessions.length === 0) {
      // First login, not suspicious
      return false;
    }

    // Check if IP is new
    const hasKnownIp = recentSessions.some((session) => session.ipAddress === ipAddress);

    // Check if user agent is new
    const hasKnownUserAgent = recentSessions.some((session) => session.userAgent === userAgent);

    // Check if device is new
    const hasKnownDevice = recentSessions.some((session) => session.deviceId === deviceId);

    // If all are new, it's suspicious
    return !hasKnownIp && !hasKnownUserAgent && !hasKnownDevice;
  } catch (error) {
    // If collection doesn't exist or query fails, assume not suspicious
    console.error('[isSuspiciousDevice] Error checking suspicious device:', error.message);
    return false;
  }
};

