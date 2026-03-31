/**
 * SECURITY FIX #9 (Phase 3 Enhancement): Enhanced HTTPS Enforcement
 * Redirects HTTP to HTTPS and enforces secure connections
 */
const logger = require('../../utils/logger');

const isLocalOrIpHost = (host = '') => {
  const normalizedHost = String(host).toLowerCase().split(':')[0];
  if (!normalizedHost) return false;

  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') {
    return true;
  }

  // Basic IPv4 host detection (e.g. 154.161.40.137)
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost);
};

/**
 * Middleware to enforce HTTPS in production
 * Respects x-forwarded-proto header for CloudFront/load balancer compatibility
 */
exports.enforceHttps = (req, res, next) => {
  // Only enforce in production
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // Check if request is already HTTPS
  // Support both direct HTTPS and proxy scenarios (CloudFront, load balancer)
  const isHttps = 
    req.secure || // Direct HTTPS connection
    req.header('x-forwarded-proto') === 'https' || // Behind proxy (CloudFront, ALB)
    req.header('x-forwarded-proto') === 'HTTPS'; // Case-insensitive check

  if (!isHttps) {
    // Get host from request
    const host = req.header('host') || req.hostname || 'saiisai.com';
    const url = req.originalUrl || req.url;

    // Allow local/IP-host HTTP traffic in production-like test environments
    // where TLS termination is not configured at the Node layer.
    if (isLocalOrIpHost(host)) {
      logger.warn('[Security] HTTPS redirect bypassed for local/IP host', {
        host,
        url,
        ip: req.ip,
      });
      return next();
    }

    // Log security event
    logger.warn('[Security] HTTP request redirected to HTTPS', {
      host,
      url,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Redirect to HTTPS (301 permanent redirect)
    return res.redirect(301, `https://${host}${url}`);
  }

  // Set HSTS header (additional security)
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );

  next();
};

/**
 * Middleware to check HTTPS for sensitive operations
 * Returns error instead of redirect for API endpoints
 */
exports.requireHttps = (req, res, next) => {
  // Only enforce in production
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const isHttps = 
    req.secure ||
    req.header('x-forwarded-proto') === 'https' ||
    req.header('x-forwarded-proto') === 'HTTPS';

  if (!isHttps) {
    return res.status(403).json({
      status: 'error',
      message: 'This operation requires a secure connection. Please use HTTPS.',
    });
  }

  next();
};

