/**
 * SECURITY FIX #4 (Phase 2 Enhancement): Enhanced OTP Verification Security
 * Tracks failed attempts, implements account lockout, and prevents brute-force
 */

const NodeCache = require('node-cache');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

// Cache for tracking failed OTP attempts per user/email/phone
// TTL: 15 minutes (matches OTP expiry)
const failedAttemptsCache = new NodeCache({ stdTTL: 900 });

// Maximum failed attempts before lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Get cache key for tracking attempts
 */
const getAttemptKey = (req) => {
  // Use loginId (email/phone) if available
  if (req.body && req.body.loginId) {
    return `otp:${req.body.loginId}`;
  }
  
  // Fallback to IP address
  return `otp:ip:${req.ip || req.connection.remoteAddress}`;
};

/**
 * Middleware to check if account is locked due to too many failed OTP attempts
 */
exports.checkOtpLockout = catchAsync(async (req, res, next) => {
  const key = getAttemptKey(req);
  const attempts = failedAttemptsCache.get(key) || { count: 0, lockedUntil: null };
  
  // Check if account is locked
  if (attempts.lockedUntil && new Date(attempts.lockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(attempts.lockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    
    // Log security event
    console.warn('[Security] OTP verification blocked - account locked:', {
      key: key.replace(/otp:/, ''), // Don't log full key
      minutesRemaining,
      path: req.path,
    });
    
    return next(new AppError(
      `Too many failed attempts. Account locked for ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}. Please try again later.`,
      429
    ));
  }
  
  // Attach attempt tracking to request for use in controller
  req.otpAttemptTracking = {
    key,
    attempts: attempts.count,
  };
  
  next();
});

/**
 * Middleware to track failed OTP verification attempts
 * Should be called after OTP verification fails
 */
exports.trackFailedAttempt = (req) => {
  const key = getAttemptKey(req);
  const attempts = failedAttemptsCache.get(key) || { count: 0, lockedUntil: null };
  
  // Increment failed attempts
  attempts.count += 1;
  
  // Lock account if max attempts reached
  if (attempts.count >= MAX_FAILED_ATTEMPTS) {
    attempts.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    
    // Log security event
    console.warn('[Security] OTP account locked due to too many failed attempts:', {
      key: key.replace(/otp:/, ''),
      attempts: attempts.count,
      lockedUntil: attempts.lockedUntil,
      path: req.path,
    });
  }
  
  // Update cache
  failedAttemptsCache.set(key, attempts, 900); // 15 minutes TTL
};

/**
 * Clear failed attempts after successful OTP verification
 */
exports.clearFailedAttempts = (req) => {
  const key = getAttemptKey(req);
  failedAttemptsCache.del(key);
};

/**
 * Get remaining attempts before lockout
 */
exports.getRemainingAttempts = (req) => {
  const key = getAttemptKey(req);
  const attempts = failedAttemptsCache.get(key) || { count: 0, lockedUntil: null };
  
  if (attempts.lockedUntil && new Date(attempts.lockedUntil).getTime() > Date.now()) {
    return 0; // Account is locked
  }
  
  return Math.max(0, MAX_FAILED_ATTEMPTS - attempts.count);
};

