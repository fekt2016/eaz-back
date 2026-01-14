const crypto = require('crypto');

/**
 * OTP Types
 * @enum {string}
 */
const OTP_TYPES = {
  SIGNUP: 'signup',
  LOGIN: 'login',
  PASSWORD_RESET: 'passwordReset',
};

/**
 * Generate OTP with type support
 * @param {Object} user - User/Seller/Admin model instance
 * @param {string} otpType - Type of OTP: 'signup' | 'login' | 'passwordReset'
 * @returns {string} Plain OTP (for sending only, never stored)
 */
const generateOtp = (user, otpType = OTP_TYPES.SIGNUP) => {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Hash OTP before storing (SHA-256)
  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  
  // Store hashed OTP (NEVER store plaintext)
  user.otp = hashedOtp;
  user.otpExpires = Date.now() + (process.env.OTP_EXPIRES_IN || 10) * 60 * 1000; // 10 minutes default
  user.otpAttempts = 0; // Reset attempts on new OTP
  user.otpLockedUntil = null; // Clear lockout
  user.otpType = otpType; // Store OTP type
  
  // SECURITY: Never log OTP in production
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[OTP Helper] Generated ${otpType} OTP (hashed) for user:`, user._id);
  }
  
  // Return plain OTP for sending (not hashed)
  return otp;
};

/**
 * Verify OTP with type checking and rate limiting
 * @param {Object} user - User/Seller/Admin model instance
 * @param {string} candidateOtp - OTP to verify
 * @param {string} expectedType - Expected OTP type (optional, for extra security)
 * @returns {{valid: boolean, locked?: boolean, reason?: string, minutesRemaining?: number}}
 */
const verifyOtp = (user, candidateOtp, expectedType = null) => {
  // Check if account is locked
  if (user.otpLockedUntil && new Date(user.otpLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(user.otpLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP Helper] Account locked:', { minutesRemaining });
    }
    return { valid: false, locked: true, minutesRemaining };
  }
  
  // Check if OTP exists
  if (!user.otp || !user.otpExpires) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP Helper] No OTP stored for user');
    }
    return { valid: false, reason: 'no_otp' };
  }
  
  // Check if OTP has expired
  const now = Date.now();
  const expiresAt = new Date(user.otpExpires).getTime();
  
  if (expiresAt <= now) {
    const minutesExpired = Math.floor((now - expiresAt) / (1000 * 60));
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP Helper] OTP expired:', { minutesExpired });
    }
    return { valid: false, reason: 'expired', minutesExpired };
  }
  
  // Optional: Verify OTP type matches (extra security layer)
  if (expectedType && user.otpType !== expectedType) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP Helper] OTP type mismatch:', { expected: expectedType, actual: user.otpType });
    }
    return { valid: false, reason: 'type_mismatch' };
  }
  
  // Normalize candidate OTP (remove non-digits)
  const providedOtp = String(candidateOtp || '').trim().replace(/\D/g, '');
  
  if (providedOtp.length === 0 || providedOtp.length !== 6) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP Helper] Invalid OTP format:', { length: providedOtp.length });
    }
    return { valid: false, reason: 'invalid_format' };
  }
  
  // Hash candidate OTP and compare with stored hash
  const hashedCandidate = crypto.createHash('sha256').update(providedOtp).digest('hex');
  const otpMatch = user.otp === hashedCandidate;
  
  if (!otpMatch) {
    // Increment failed attempts
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    
    // Lock account after 5 failed attempts (15 minutes)
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MINUTES = 15;
    
    if (user.otpAttempts >= MAX_ATTEMPTS) {
      user.otpLockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[OTP Helper] Account locked due to too many failed attempts');
      }
      return { 
        valid: false, 
        reason: 'mismatch', 
        locked: true, 
        minutesRemaining: LOCKOUT_MINUTES 
      };
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP Helper] OTP mismatch, attempts:', user.otpAttempts);
    }
    return { valid: false, reason: 'mismatch', attempts: user.otpAttempts };
  }
  
  // OTP is valid - reset attempts and lockout
  user.otpAttempts = 0;
  user.otpLockedUntil = null;
  
  if (process.env.NODE_ENV !== 'production') {
    console.log('[OTP Helper] OTP verified successfully');
  }
  return { valid: true };
};

/**
 * Clear OTP fields after successful verification
 * @param {Object} user - User/Seller/Admin model instance
 */
const clearOtp = (user) => {
  user.otp = undefined;
  user.otpExpires = undefined;
  user.otpAttempts = 0;
  user.otpLockedUntil = null;
  user.otpType = undefined;
};

module.exports = {
  OTP_TYPES,
  generateOtp,
  verifyOtp,
  clearOtp,
};

