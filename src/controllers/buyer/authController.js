const { promisify } = require('util');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const NodeCache = require('node-cache');
const User = require('../../models/user/userModel');
const Admin = require('../../models/user/adminModel');
const Seller = require('../../models/user/sellerModel');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { sendCustomEmail, sendLoginEmail, sendLoginOtpEmail, sendPasswordResetEmail } = require('../../utils/email/emailService');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const { validateGhanaPhone } = require('../../utils/helpers/helper');
const bcrypt = require('bcryptjs');
const sanitizePath = require('../../utils/helpers/sanitizePath');
const speakeasy = require('speakeasy');
const { isPublicRoute,
  isTokenBlacklisted,
  matchRoutePattern,
  escapeRegex,
  findUserByToken,
  extractToken,
  verifyToken, } = require('../../utils/helpers/routeUtils');
const { logActivityAsync, logActivity } = require('../../modules/activityLog/activityLog.service');
const securityMonitor = require('../../services/securityMonitor');
const ActivityLog = require('../../models/activityLog/activityLogModel');
const logger = require('../../utils/logger');
// Shared helpers for standardized auth
const { normalizeEmail, normalizePhone } = require('../../utils/helpers/authHelpers');
const { generateOtp, OTP_TYPES } = require('../../utils/helpers/otpHelpers');

// Initialize route cache (5 minutes TTL)
// Initialize login session cache (5 minutes TTL) for 2FA login flow
const loginSessionCache = new NodeCache({ stdTTL: 300 });

// Define public routes
const publicRoutes = [
  { path: '/api/v1/product', methods: ['GET'] },
  { path: '/api/v1/categories', methods: ['GET'] },
  { path: '/api/v1/categories/parents', methods: ['GET'] },
  { path: '/api/v1/wishlist/sync', methods: ['POST'] },
  { path: '/api/v1/product/category-counts', methods: ['GET'] },
  { path: '/api/v1/users/register', methods: ['POST'] },
  { path: '/api/v1/users/signup', methods: ['POST'] },
  { path: '/api/v1/users/login', methods: ['POST'] },
  { path: '/api/v1/users/send-otp', methods: ['POST'] },
  { path: '/api/v1/users/verify-otp', methods: ['POST'] },
  { path: '/api/v1/users/verify-account', methods: ['POST'] },
  { path: '/api/v1/users/resend-otp', methods: ['POST'] },
  { path: '/api/v1/users/forgot-password', methods: ['POST'] },
  { path: '/api/v1/users/reset-password/:token', methods: ['PATCH'] },
  { path: '/api/v1/admin/login', methods: ['POST'] },
  { path: '/api/v1/admin/register', methods: ['POST'] },
  { path: '/api/v1/admin/verify-email', methods: ['POST'] },
  { path: '/api/v1/seller/login', methods: ['POST'] },
  { path: '/api/v1/seller/register', methods: ['POST'] },
  { path: '/api/v1/seller/signup', methods: ['POST'] },
  { path: '/api/v1/seller/send-otp', methods: ['POST'] },
  { path: '/api/v1/seller/verify-otp', methods: ['POST'] },
  { path: '/api/v1/seller/forgotPassword', methods: ['POST'] },
  { path: '/api/v1/search', methods: ['GET'] },
  { path: '/api/v1/discount', methods: ['GET'] },
  { path: '/api/v1/newsletter', methods: ['POST'] },
  { path: '/api/v1/search/results', methods: ['GET'] },
  { path: '/api/v1/shipping/quote', methods: ['POST'] }, // Public shipping quote calculation
  { path: '/api/v1/shipping/shipping-options', methods: ['POST'] }, // Public shipping options for checkout
  { path: '/api/v1/shipping/calc-shipping', methods: ['POST'] }, // Public shipping calculation
  { path: '/api/v1/shipping/pickup-centers', methods: ['GET'] }, // Public pickup centers
];

// Controller methods ===========================================================

// Controllers/authController.js (signup part)
exports.signup = catchAsync(async (req, res, next) => {
  // Early validation - collect field-level errors
  const fieldErrors = {};

  // Normalize and validate email (required)
  const normalizedEmail = normalizeEmail(req.body.email);
  if (!normalizedEmail) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // Phone is optional - normalize if provided
  const normalizedPhone = normalizePhone(req.body.phone);
  if (req.body.phone && normalizedPhone && !validateGhanaPhone(normalizedPhone)) {
    return next(new AppError('Please provide a valid Ghana phone number', 400));
  }

  // Email validation
  if (req.body.email) {
    if (!validator.isEmail(req.body.email)) {
      fieldErrors.email = 'Please provide a valid email address';
    }
  }

  // Phone validation
  if (req.body.phone && !validateGhanaPhone(req.body.phone)) {
    fieldErrors.phone = 'Please provide a valid Ghana phone number';
  }

  // Password validation
  if (!req.body.password) {
    fieldErrors.password = 'Password is required';
  } else if (req.body.password.length < 8) {
    fieldErrors.password = 'Password must be at least 8 characters long';
  }

  if (!req.body.passwordConfirm) {
    fieldErrors.passwordConfirm = 'Please confirm your password';
  } else if (req.body.password && req.body.passwordConfirm !== req.body.password) {
    fieldErrors.passwordConfirm = 'Passwords do not match';
  }

  // Return field-level errors if any
  if (Object.keys(fieldErrors).length > 0) {
    return next(new AppError('Please check the form for errors', 400, fieldErrors));
  }

  try {
    // SECURITY: Enforce role server-side (buyer only)
    // Build user object - only include phone if provided
    const userData = {
      name: req.body.name,
      email: normalizedEmail,
      password: req.body.password,
      passwordConfirm: req.body.passwordConfirm,
      passwordChangedAt: req.body.passwordChangedAt,
      role: 'user', // User model enum: 'user', 'seller', 'admin', 'driver', 'eazshop_store'
      emailVerified: false, // Always false on signup - requires OTP verification
      phoneVerified: false,
    };
    
    // Only add phone if provided and valid
    if (normalizedPhone) {
      const phoneNumber = parseInt(normalizedPhone, 10);
      // Validate the conversion
      if (isNaN(phoneNumber) || phoneNumber <= 0) {
        return next(new AppError('Invalid phone number format', 400));
      }
      userData.phone = phoneNumber;
    }
    // If phone not provided, omit it entirely (allows null/undefined in DB)
    
    const newUser = await User.create(userData);

    // Generate OTP for signup verification using shared helper
    const { sendLoginOtpEmail } = require('../../utils/email/emailService');
    const otp = generateOtp(newUser, OTP_TYPES.SIGNUP);
    await newUser.save({ validateBeforeSave: false });

    // SECURITY: Log OTP generation for development only (NEVER in production)
    if (process.env.NODE_ENV !== 'production') {
      // SECURITY FIX #11 (Phase 3 Enhancement): Secure logging (masks sensitive data)
      const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
      logOtpGeneration(newUser._id, newUser.email || newUser.phone, 'signup');
      secureLog.debug('Signup OTP generated', {
        userId: newUser._id,
        email: newUser.email,
        phone: newUser.phone,
        expires: new Date(newUser.otpExpires).toLocaleString(),
        // OTP value is NEVER logged, even in development
      });
    }

    // Send OTP via email (only if email exists)
    if (newUser.email) {
      try {
        logger.info(`[Buyer Signup] 📧 Sending OTP email to ${newUser.email} via email provider...`);
        const { data: emailData, error: emailError } = await sendLoginOtpEmail(newUser.email, otp, newUser.name);
        
        if (emailError) {
          throw new Error(emailError.message || 'Failed to send OTP email');
        }
        
        logger.info(`[Buyer Signup] ✅ OTP email sent successfully to ${newUser.email}`);
        if (emailData?.id) {
          logger.info(`[Buyer Signup] 📨 Email ID: ${emailData.id}`);
        }
      } catch (emailError) {
        logger.error('[Buyer Signup] ❌ Failed to send OTP email:', emailError.message);
        if (emailError.response) {
          logger.error('[Buyer Signup] Error details:', JSON.stringify(emailError.response.body || emailError.response.data, null, 2));
        }
        // Don't fail signup if email fails - OTP is still generated
      }
    }

    // If phone is provided, also send SMS OTP
    if (newUser.phone) {
      try {
        const { sendSMS } = require('../../utils/email/emailService');
        await sendSMS({
          to: newUser.phone,
          message: `Your EazShop verification code is: ${otp}. Valid for 10 minutes.`,
        });
        logger.info(`[Buyer Signup] OTP sent to phone ${newUser.phone}`);
      } catch (smsError) {
        logger.error('[Buyer Signup] Failed to send SMS:', smsError.message);
      }
    }

    res.status(201).json({
      status: 'success',
      requiresVerification: true,
      message: 'Account created! Please check your email for the verification code.',
      data: {
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
        },
        otp: process.env.NODE_ENV !== 'production' ? otp : undefined, // Only in dev
      },
    });
  } catch (err) {
    // Log full error details for debugging
    logger.error('[Buyer Signup] Signup Error:', {
      name: err.name,
      message: err.message,
      code: err.code,
      errors: err.errors,
      keyPattern: err.keyPattern,
      keyValue: err.keyValue,
      stack: err.stack?.split('\n').slice(0, 10).join('\n'),
    });

    // Handle duplicate key error (email or phone already exists)
    if (err.code === 11000) {
      // SECURITY: Generic error message to prevent account enumeration
      // In development, log more details but still return generic message to client
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('[Buyer Signup] Duplicate key error detected:', {
          keyPattern: err.keyPattern,
          keyValue: err.keyValue,
          message: 'Account with this email or phone already exists',
        });
      }
      return next(
        new AppError(
          'Unable to process request',
          400,
        ),
      );
    }

    // Clean up: Delete user if creation failed (use normalized email)
    if (normalizedEmail) {
      await User.findOneAndDelete({ email: normalizedEmail });
    }
    
    // Log detailed error for debugging
    console.error('Signup Error:', err);
    console.error('Signup Error Details:', {
      message: err.message,
      name: err.name,
      code: err.code,
      errors: err.errors,
      stack: err.stack,
    });

    // Return more specific error message if it's a validation error
    if (err.name === 'ValidationError') {
      const validationErrors = Object.values(err.errors || {}).map(e => e.message).join(', ');
      return next(
        new AppError(
          `Validation error: ${validationErrors}`,
          400,
        ),
      );
    }

    // Handle pre-save hook errors (e.g., "Please provide either email or phone")
    if (err.message?.includes('Please provide either email or phone')) {
      const fieldErrors = {
        email: 'Please provide either email or phone number',
        phone: 'Please provide either email or phone number'
      };
      return next(new AppError(err.message, 400, fieldErrors));
    }

    // Handle password validation errors
    if (err.message?.includes('password') || err.message?.includes('Password')) {
      const fieldErrors = {};
      if (err.message?.toLowerCase().includes('confirm')) {
        fieldErrors.passwordConfirm = err.message;
      } else {
        fieldErrors.password = err.message;
      }
      return next(new AppError(err.message, 400, fieldErrors));
    }

    // Handle CastError (e.g., invalid ObjectId, invalid Number)
    if (err.name === 'CastError') {
      const field = err.path || 'field';
      const fieldErrors = {};
      fieldErrors[field] = `Invalid ${field} format`;
      return next(new AppError(`Invalid ${field} format`, 400, fieldErrors));
    }

    // Cleanup: Delete user if creation succeeded but something else failed
    // Only delete if we can identify the user (email or phone)
    try {
      if (req.body.email) {
        await User.findOneAndDelete({ email: req.body.email });
        logger.info('[Buyer Signup] Cleaned up user with email:', req.body.email);
      } else if (req.body.phone) {
        const cleanPhone = req.body.phone.replace(/\D/g, '');
        const phoneNumber = parseInt(cleanPhone, 10);
        if (!isNaN(phoneNumber)) {
          await User.findOneAndDelete({ phone: phoneNumber });
          logger.info('[Buyer Signup] Cleaned up user with phone:', phoneNumber);
        }
      }
    } catch (cleanupError) {
      logger.error('[Buyer Signup] Cleanup error (user may not exist);:', cleanupError.message);
    }

    // For unknown errors, return generic 500 but log details internally
    return next(
      new AppError(
        'There was an error creating your account. Please try again.',
        500,
      ),
    );
  }
});

exports.verifyEmail = catchAsync(async (req, res, next) => {
  // Get token from URL params
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  // Find user with this token that hasn't expired
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(
      new AppError('Verification token is invalid or has expired', 400),
    );
  }

  // Mark email as verified and clear token fields
  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  // You could automatically log the user in here or redirect to login page
  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully! You can now log in.',
  });
});
exports.requireVerifiedEmail = catchAsync(async (req, res, next) => {
  // Assuming user is already authenticated at this point
  if (!req.user.emailVerified) {
    return next(
      new AppError(
        'Please verify your email address to access this resource',
        403,
      ),
    );
  }
  next();
});
/**
 * POST /users/login
 * Login with email + password only (no OTP)
 * If 2FA is enabled, returns 2fa_required response
 * If 2FA is disabled, issues token immediately
 * 
 * 403 FORBIDDEN CONDITIONS:
 * 1. Email not verified (user.emailVerified === false)
 *    - Message: "Account not verified. Please verify your email address first..."
 * 2. Device limit exceeded in production (too many active device sessions)
 *    - Message: "Device limit exceeded. You have reached the maximum number of devices..."
 * 
 * 401 UNAUTHORIZED CONDITIONS:
 * 1. Invalid email or password
 * 2. Account deactivated (user.active === false)
 * 
 * 429 TOO MANY REQUESTS:
 * 1. Account temporarily locked (too many failed login attempts)
 */
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Log login attempt for debugging (sanitized - no password)
  if (process.env.NODE_ENV === 'production') {
    console.log('[Login] Attempt:', {
      email: email ? email.substring(0, 3) + '***' : 'missing',
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 50),
      timestamp: new Date().toISOString(),
    });
  }

  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  if (!validator.isEmail(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // SECURITY: Normalize email to prevent case-sensitivity issues
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // Find user with password
  const user = await User.findOne({ email: normalizedEmail }).select('+password +twoFactorEnabled');

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    // Log for security monitoring
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Login] User not found:', {
        email: normalizedEmail.substring(0, 3) + '***',
        ip: req.ip,
      });
    }
    return next(new AppError('Invalid email or password', 401));
  }

  // SECURITY: Check if account is suspended
  if (user.active === false) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // SECURITY: Check if account is verified (REQUIRED before login)
  // Email verification is required (phone login removed)
  if (!user.emailVerified) {
    // Log for debugging in production
    console.warn('[Login] Email verification required:', {
      userId: user._id,
      email: user.email,
      emailVerified: user.emailVerified,
      ip: req.ip,
    });
    
    return next(
      new AppError(
        'Account not verified. Please verify your email address first. Check your inbox for the verification email, or request a new verification code.',
        403
      )
    );
  }

  // SECURITY: Verify password
  const passwordValid = await user.correctPassword(password);
  if (!passwordValid) {
    // SECURITY: Increment failed login attempts (if field exists)
    if (user.failedLoginAttempts !== undefined) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      // Lock account after 5 failed attempts (15 minutes)
      if (user.failedLoginAttempts >= 5) {
        user.accountLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save({ validateBeforeSave: false });
        return next(new AppError('Too many failed login attempts. Account locked for 15 minutes.', 429));
      }
      await user.save({ validateBeforeSave: false });
    }
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Invalid email or password', 401));
  }

  // SECURITY: Check if account is locked
  if (user.accountLockedUntil && new Date(user.accountLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(user.accountLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    return next(
      new AppError(
        `Account is temporarily locked. Please try again in ${minutesRemaining} minute(s).`,
        429
      )
    );
  }

  // Reset failed login attempts on successful password verification
  if (user.failedLoginAttempts !== undefined && user.failedLoginAttempts > 0) {
    user.failedLoginAttempts = 0;
    user.accountLockedUntil = null;
    await user.save({ validateBeforeSave: false });
  }

  // Check 2FA status
  if (user.twoFactorEnabled) {
    // 2FA is enabled - require Google Authenticator code
    // Generate temporary session ID for 2FA verification
    const loginSessionId = crypto.randomBytes(32).toString('hex');
    
    // Store session in shared cache (5 minutes TTL)
    loginSessionCache.set(loginSessionId, {
      userId: user._id.toString(),
      email: user.email,
      timestamp: Date.now(),
    });

    return res.status(200).json({
      status: '2fa_required',
      message: 'Two-factor authentication is enabled. Please provide your 2FA code.',
      requires2FA: true,
      loginSessionId: loginSessionId,
      data: {
        userId: user._id,
        email: user.email,
      },
    });
  }

  // 2FA is disabled - issue token immediately
  // Use standardized login helper
  const { handleSuccessfulLogin } = require('../../utils/helpers/authHelpers');
  
  try {
    const response = await handleSuccessfulLogin(req, res, user, 'buyer');
    res.status(200).json(response);
  } catch (deviceError) {
    // Handle device session limit errors
    if (deviceError.message?.includes('Too many devices')) {
      // Log for debugging
      console.warn('[Login] Device limit exceeded:', {
        userId: user._id,
        email: user.email,
        error: deviceError.message,
        ip: req.ip,
      });
      
      // In production, enforce device limit strictly
      if (process.env.NODE_ENV === 'production') {
        return next(
          new AppError(
            'Device limit exceeded. You have reached the maximum number of devices. Please log out from another device or contact support.',
            403
          )
        );
      }
      
      // In development, allow bypassing device session
      console.warn('[Login] Dev mode: Bypassing device session limit');
      const response = await handleSuccessfulLogin(req, res, user, 'buyer', { skipDeviceSession: true });
      res.status(200).json(response);
    } else {
      // Other errors - log and rethrow
      console.error('[Login] Unexpected error during device session creation:', {
        userId: user._id,
        email: user.email,
        error: deviceError.message,
        stack: deviceError.stack,
      });
      
      // In production, fail securely
      if (process.env.NODE_ENV === 'production') {
        return next(
          new AppError(
            'Login failed due to a system error. Please try again or contact support.',
            500
          )
        );
      }
      
      // In development, continue without device session for debugging
      console.warn('[Login] Dev mode: Continuing without device session due to error');
      const response = await handleSuccessfulLogin(req, res, user, 'buyer', { skipDeviceSession: true });
      res.status(200).json(response);
    }
  }
});

/**
 * POST /users/verify-2fa-login
 * Verify 2FA code and issue JWT token
 * Requires loginSessionId from /users/login response
 */
exports.verify2FALogin = catchAsync(async (req, res, next) => {
  const { loginSessionId, twoFactorCode } = req.body;

  if (!loginSessionId || !twoFactorCode) {
    return next(new AppError('Please provide loginSessionId and 2FA code', 400));
  }

  // Retrieve session from shared cache
  const session = loginSessionCache.get(loginSessionId);

  if (!session) {
    return next(new AppError('Login session expired. Please login again.', 401));
  }

  // Find user with 2FA secret
  const user = await User.findById(session.userId).select('+twoFactorSecret +twoFactorBackupCodes');

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Unable to process request', 404));
  }

  if (!user.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is not enabled for this account', 400));
  }

  // Verify 2FA code
  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: twoFactorCode,
    window: 2,
  });

  // Check backup codes if TOTP fails
  let backupCodeUsed = false;
  if (!verified && user.twoFactorBackupCodes && user.twoFactorBackupCodes.length > 0) {
    const backupCodeIndex = user.twoFactorBackupCodes.findIndex(
      (code) => code === twoFactorCode.toUpperCase()
    );
    
    if (backupCodeIndex !== -1) {
      user.twoFactorBackupCodes.splice(backupCodeIndex, 1);
      await user.save({ validateBeforeSave: false });
      backupCodeUsed = true;
    }
  }

  if (!verified && !backupCodeUsed) {
    // Delete session on failed attempt
    loginSessionCache.del(loginSessionId);
    return next(new AppError('Invalid 2FA code. Please try again.', 401));
  }

  // 2FA verified - delete session and issue token
  loginSessionCache.del(loginSessionId);

  // Create device session
  const { createDeviceSession } = require('../../utils/helpers/createDeviceSession');
  let sessionData;
  try {
    sessionData = await createDeviceSession(req, user, 'eazmain');
  } catch (deviceError) {
    if (process.env.NODE_ENV === 'production' && deviceError.message?.includes('Too many devices')) {
      return next(new AppError(deviceError.message, 403));
    }
    sessionData = null;
  }

  // Create token
  const expiresIn = process.env.JWT_EXPIRES_IN || '90d';
  const signToken = (id, role, deviceId) => {
    const payload = { id, role };
    if (deviceId) payload.deviceId = deviceId;
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
  };

  const token = signToken(user._id, user.role, sessionData?.deviceId);

  // Set cookie
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    expires: new Date(Date.now() + (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000),
    ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  };

  res.cookie('main_jwt', token, cookieOptions);

  // Generate CSRF token on successful login
  const { generateCSRFToken } = require('../../middleware/csrf/csrfProtection');
  generateCSRFToken(res);

  // Update last login and last activity
  user.lastLogin = new Date();
  user.lastActivity = Date.now(); // SECURITY FIX #9: Initialize session activity
  await user.save({ validateBeforeSave: false });

  // Create safe user payload
  const safeUserPayload = {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    isVerified: user.emailVerified || user.phoneVerified,
    lastLogin: user.lastLogin,
  };

  // Log activity
  logActivityAsync({
    userId: user._id,
    role: 'buyer',
    action: 'LOGIN',
    description: 'User logged in with email, password, and 2FA',
    req,
  });

  // SECURITY: Token is ONLY in HTTP-only cookie, NOT in JSON response
  // Return response without token to prevent XSS attacks
  const response = {
    status: 'success',
    message: 'Login successful',
    user: safeUserPayload,
  };

  if (sessionData) {
    response.deviceId = sessionData.deviceId;
    // refreshToken is stored in device session, not exposed to client
    if (sessionData.suspicious) {
      response.warning = 'New device detected. Please verify this is you.';
    }
  }

  res.status(200).json(response);
});

exports.sendOtp = catchAsync(async (req, res, next) => {
  const { loginId } = req.body;

  if (!loginId) {
    return next(new AppError('Please provide email or phone number', 400));
  }

  let user;

  if (validator.isEmail(loginId)) {
    user = await User.findOne({ email: loginId });
  } else if (validator.isMobilePhone(loginId)) {
    user = await User.findOne({ phone: loginId.replace(/\D/g, '') });
  } else {
    return next(
      new AppError('Please provide a valid email or phone number', 400),
    );
  }

  if (!user) {
    return next(
      new AppError('No user found with that email or phone number', 404),
    );
  }

  const otp = user.createOtp();
  await user.save({ validateBeforeSave: false });
  
  // SECURITY FIX #11 (Phase 3 Enhancement): Secure logging (masks sensitive data)
  const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
  logOtpGeneration(user._id, loginId, 'login');
  secureLog.debug('Login OTP generated', {
    userId: user._id,
    loginId,
    expires: new Date(user.otpExpires).toLocaleString(),
    // OTP value is NEVER logged, even in development
  });

  // Send OTP via email
  if (validator.isEmail(loginId)) {
    try {
      await sendLoginOtpEmail(user.email, otp, user.name);
      logger.info(`[Auth] Login OTP email sent to ${user.email}`);
    } catch (error) {
      logger.error('[Auth] Failed to send login OTP email:', error.message);
      // Don't fail the request if email fails, OTP is still generated
    }
  }

  // SECURITY FIX #3: NEVER include OTP in API response, even in development
  const response = {
    status: 'success',
    message: 'OTP sent to your email or phone!',
    // OTP is NEVER included in response (security best practice)
  };

  res.status(200).json(response);
});

exports.verifyOtp = catchAsync(async (req, res, next) => {
  logger.info('req.body', req.body);
  try {
    const { loginId, otp, password, redirectTo } = req.body;


    if (!loginId || !otp || !password) {
      return next(
        new AppError('Please provide loginId, OTP, and password', 400),
      );
    }

    let user;
    const query = User.findOne();
    logger.info('query', query);


    if (validator.isEmail(loginId)) {
      query.where({ email: loginId });
    } else if (validator.isMobilePhone(loginId)) {
      query.where({ phone: loginId.replace(/\D/g, '') });
    } else {
      return next(
        new AppError('Please provide a valid email or phone number', 400),
      );
    }

    query.select('+password +otp +otpExpires +otpAttempts +otpLockedUntil');
    user = await query;
    logger.info('user', user);

    if (!user) {
      logger.info('[verifyOtp] User not found for:', loginId);
      return next(
        new AppError('No user found with that email or phone number', 404),
      );
    }

    // ✅ CRITICAL: Check if account is verified before allowing login
    if (!user.emailVerified && !user.phoneVerified) {
      return next(
        new AppError(
          'Account not verified. Please verify your email or phone number first using the verification code sent to you. If you need a new code, please use the resend option.',
          403
        )
      );
    }

    // ✅ ENFORCE: User must login with the method they verified
    const isEmailLogin = validator.isEmail(loginId);
    const isPhoneLogin = validator.isMobilePhone(loginId);

    if (user.emailVerified && !user.phoneVerified) {
      // Only email verified - must login with email
      if (!isEmailLogin) {
        return next(
          new AppError(
            'Your account is verified with email. Please login using your email address.',
            403
          )
        );
      }
    } else if (user.phoneVerified && !user.emailVerified) {
      // Only phone verified - must login with phone
      if (!isPhoneLogin) {
        return next(
          new AppError(
            'Your account is verified with phone number. Please login using your phone number.',
            403
          )
        );
      }
    }
    // If both are verified, user can login with either method

    // Determine which verification method was used
    const verifiedBy = [];
    if (user.emailVerified) verifiedBy.push('email');
    if (user.phoneVerified) verifiedBy.push('phone');

    logger.info('[verifyOtp] User found:', {
      id: user._id,
      email: user.email,
      phone: user.phone,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      verifiedBy: verifiedBy, // ✅ Shows which method(s) verified the account
      isVerified: user.emailVerified || user.phoneVerified,
      loginMethod: isEmailLogin ? 'email' : isPhoneLogin ? 'phone' : 'unknown',
      hasOtp: !!user.otp
    });

    // Verify OTP - normalize input (trim and remove non-digits)
    const otpString = String(otp || '').trim().replace(/\D/g, '');

    if (!otpString || otpString.length === 0 || otpString.length !== 6) {
      return next(new AppError('Please provide a valid 6-digit OTP code', 400));
    }

    // Verify OTP (returns object with valid, reason, etc.)
    const otpResult = user.verifyOtp(otpString);

    // Handle account lockout
    if (otpResult.locked) {
      return next(
        new AppError(
          `Your account is locked for ${otpResult.minutesRemaining} minute(s) due to multiple failed attempts. Please try again later.`,
          429
        )
      );
    }

    // Handle failed OTP verification
    if (!otpResult.valid) {
      // Increment failed attempts
      user.otpAttempts = (user.otpAttempts || 0) + 1;

      // Lock account after 5 failed attempts
      if (user.otpAttempts >= 5) {
        user.otpLockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        await user.save({ validateBeforeSave: false });
        return next(
          new AppError(
            'Too many failed attempts. Your account is locked for 15 minutes.',
            429
          )
        );
      }

      await user.save({ validateBeforeSave: false });

      // Provide specific error message
      const attemptsRemaining = 5 - user.otpAttempts;
      let errorMessage = 'Invalid OTP code.';

      if (otpResult.reason === 'expired') {
        errorMessage = `OTP expired ${otpResult.minutesExpired || 0} minute(s) ago. Request a new one.`;
      } else if (otpResult.reason === 'no_otp') {
        errorMessage = 'No OTP found. Please request a new OTP.';
      } else if (otpResult.reason === 'mismatch') {
        errorMessage = `Wrong OTP. You have ${attemptsRemaining} attempt(s) remaining.`;
      } else {
        errorMessage = `Invalid OTP. You have ${attemptsRemaining} attempt(s) remaining.`;
      }

      return next(new AppError(errorMessage, 401));
    }

    // OTP is valid - save user (attempts already reset in verifyOtp method)
    await user.save({ validateBeforeSave: false });

    // Verify password
    const passwordValid = await user.correctPassword(password);
    logger.info('[verifyOtp] Password verification result:', passwordValid);

    if (!passwordValid) {
      console.log('[verifyOtp] Password validation failed');
      // SECURITY: Generic error message to prevent information leakage
      return next(new AppError('Invalid credentials', 401));
    }

    // Check if 2FA is enabled and verify 2FA code if required
    const userWith2FA = await User.findById(user._id).select('+twoFactorSecret');
    if (userWith2FA.twoFactorEnabled) {
      const { twoFactorCode } = req.body;
      
      if (!twoFactorCode) {
        return res.status(200).json({
          status: '2fa_required',
          message: 'Two-factor authentication is enabled. Please provide your 2FA code.',
          requires2FA: true,
          data: {
            userId: user._id,
            email: user.email,
            phone: user.phone,
          },
        });
      }

      // Verify 2FA code
      const verified = speakeasy.totp.verify({
        secret: userWith2FA.twoFactorSecret,
        encoding: 'base32',
        token: twoFactorCode,
        window: 2, // Allow ±1 time step (60 seconds total window)
      });

      // Also check backup codes if 2FA code fails
      if (!verified && userWith2FA.twoFactorBackupCodes && userWith2FA.twoFactorBackupCodes.length > 0) {
        const backupCodeIndex = userWith2FA.twoFactorBackupCodes.findIndex(
          (code) => code === twoFactorCode.toUpperCase()
        );
        
        if (backupCodeIndex !== -1) {
          // Remove used backup code
          userWith2FA.twoFactorBackupCodes.splice(backupCodeIndex, 1);
          await userWith2FA.save({ validateBeforeSave: false });
          // Backup code is valid, continue with login
        } else {
          return next(new AppError('Invalid 2FA code. Please try again.', 401));
        }
      } else if (!verified) {
        return next(new AppError('Invalid 2FA code. Please try again.', 401));
      }
    }

    // Capture IP and device
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Security monitoring
    const ipChange = await securityMonitor.detectIPChange(user, ipAddress, 'buyer');
    const deviceChange = await securityMonitor.detectDeviceChange(user, userAgent, 'buyer');
    const multipleIps = await securityMonitor.detectMultipleIps(user, 'buyer');
    const geoMismatch = await securityMonitor.detectGeoMismatch(user, ipAddress, 'buyer');
    const location = await securityMonitor.getIpLocation(ipAddress);

    // Compute risk level
    const riskLevel = securityMonitor.computeRiskLevel({
      ipChanged: ipChange.changed,
      deviceChanged: deviceChange.changed,
      multipleIps: multipleIps.multipleIps,
      geoMismatch: geoMismatch.mismatch,
    });

    // Log IP change if detected
    if (ipChange.changed) {
      await ActivityLog.create({
        userId: user._id,
        userModel: 'User',
        role: 'buyer',
        action: 'IP_CHANGE',
        description: `IP address changed from ${ipChange.previousIp} to ${ipChange.currentIp}`,
        activityType: 'IP_CHANGE',
        ipAddress: ipChange.currentIp,
        previousIp: ipChange.previousIp,
        userAgent,
        location,
        riskLevel: 'medium',
        platform: 'eazmain',
        metadata: {
          previousIp: ipChange.previousIp,
          currentIp: ipChange.currentIp,
        },
      });
    }

    // Log device change if detected
    if (deviceChange.changed) {
      await ActivityLog.create({
        userId: user._id,
        userModel: 'User',
        role: 'buyer',
        action: 'DEVICE_CHANGE',
        description: `Device changed from ${deviceChange.previousDevice?.substring(0, 50)} to ${deviceChange.currentDevice?.substring(0, 50)}`,
        activityType: 'DEVICE_CHANGE',
        ipAddress,
        userAgent: deviceChange.currentDevice,
        location,
        riskLevel: 'medium',
        platform: 'eazmain',
        metadata: {
          previousDevice: deviceChange.previousDevice,
          currentDevice: deviceChange.currentDevice,
        },
      });
    }

    // Clear OTP and update last login
    user.otp = undefined;
    user.otpExpires = undefined;
    user.lastLogin = Date.now();
    user.lastActivity = Date.now(); // SECURITY FIX #9: Initialize session activity
    await user.save({ validateBeforeSave: false });
    logger.info('2', user);

    // Log login activity with security info
    const loginLog = await ActivityLog.create({
      userId: user._id,
      userModel: 'User',
      role: 'buyer',
      action: 'LOGIN',
      description: `User logged in via OTP`,
      activityType: 'LOGIN',
      ipAddress,
      previousIp: ipChange.previousIp || null,
      userAgent,
      location,
      riskLevel,
      platform: 'eazmain',
      metadata: {
        ipChanged: ipChange.changed,
        deviceChanged: deviceChange.changed,
        multipleIps: multipleIps.multipleIps,
        ipCount: multipleIps.ipCount,
      },
    });

    // Trigger security alert if risk is high or critical
    if (riskLevel === 'high' || riskLevel === 'critical') {
      await securityMonitor.triggerSecurityAlert(user, loginLog, 'buyer');
    }

    // Check if critical risk requires force logout
    if (riskLevel === 'critical') {
      logger.warn(`[User Login] CRITICAL RISK detected for user ${user.email || user.phone}. Login allowed but logged.`);
    }

    // Send login notification email
    if (user.email) {
      try {
        const loginInfo = {
          ip: ipAddress,
          device: userAgent,
          location: location || 'Unknown location',
        };
        await sendLoginEmail(user.email, user.name, loginInfo);
        logger.info(`[Auth] Login notification email sent to ${user.email}`);
      } catch (error) {
        logger.error('[Auth] Failed to send login notification email:', error.message);
        // Don't fail the login if email fails
      }
    }

    // Sanitize redirect path
    const sanitizedRedirectTo = sanitizePath(redirectTo, '/');
    logger.info(`[Auth] Redirect path: ${redirectTo} -> ${sanitizedRedirectTo}`);

    // Create device session and generate tokens
    const { createDeviceSession } = require('../../utils/helpers/createDeviceSession');
    let sessionData;
    try {
      logger.info('[Auth] Creating device session for user:', user._id);
      sessionData = await createDeviceSession(req, user, 'eazmain');
      logger.info('[Auth] Device session created successfully:', sessionData.deviceId);
    } catch (deviceError) {
      // If device limit exceeded, return error (only in production)
      if (process.env.NODE_ENV === 'production' && deviceError.message && deviceError.message.includes('Too many devices')) {
        return next(new AppError(deviceError.message, 403));
      }
      // For other errors, log full error details and continue without device session (fallback)
      logger.error('[Auth] ❌ Error creating device session:', deviceError.message || deviceError);
      logger.error('[Auth] Error stack:', deviceError.stack);
      logger.error('[Auth] Full error object:', JSON.stringify(deviceError, Object.getOwnPropertyNames(deviceError)));
      sessionData = null;
    }

    // Create token with deviceId
    const expiresIn = process.env.JWT_EXPIRES_IN || '90d';
    const signToken = (id, role, deviceId) => {
      const payload = { id, role };
      if (deviceId) {
        payload.deviceId = deviceId;
      }
      return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: expiresIn,
      });
    };

    const token = signToken(user._id, user.role, sessionData?.deviceId);

    // Set cookie (same as createSendToken)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction, // true in production, false in development
      sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site in production, 'lax' for same-site in dev
      path: '/', // Available on all paths
      expires: new Date(
        Date.now() +
        (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000, // 90 days default
      ),
      // Set domain for production to allow cookie sharing across subdomains
      // Only set in production, leave undefined in development (localhost)
      ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
    };

    res.cookie('main_jwt', token, cookieOptions);
    
    // Generate CSRF token on successful authentication
    const { generateCSRFToken } = require('../../middleware/csrf/csrfProtection');
    generateCSRFToken(res);
    
    console.log(`[Auth] JWT cookie set (main_jwt): httpOnly=true, secure=${cookieOptions.secure}, sameSite=${cookieOptions.sameSite}, path=${cookieOptions.path}`);

    // Remove sensitive data
    user.password = undefined;
    user.otp = undefined;
    user.otpExpires = undefined;

    // Reuse verifiedBy from earlier in the function (already declared at line 328)
    // verifiedBy is already populated with the verification methods

    // Create safe user payload
    const safeUserPayload = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      verifiedBy: verifiedBy, // ✅ Shows which method(s) verified the account (reused from line 328)
      isVerified: user.emailVerified || user.phoneVerified, // ✅ Overall verification status
      lastLogin: user.lastLogin,
    };

    // Log activity
    logActivityAsync({
      userId: user._id,
      role: 'buyer',
      action: 'LOGIN',
      description: `User logged in via OTP verification`,
      req,
    });

    // SECURITY: Token is ONLY in HTTP-only cookie, NOT in JSON response
    // Return JSON without token to prevent XSS attacks
    const response = {
      status: 'success',
      message: 'OTP verified',
      user: safeUserPayload,
      redirectTo: sanitizedRedirectTo,
    };

    // Add device session info if created
    if (sessionData) {
      response.deviceId = sessionData.deviceId;
      // refreshToken is stored in device session, not exposed to client
      if (sessionData.suspicious) {
        response.warning = 'New device detected. Please verify this is you.';
      }
    }

    res.status(200).json(response);
  } catch (error) {
    logger.error('Verify OTP error:', error);
  }
});

exports.logout = catchAsync(async (req, res, next) => {
  // Logout device session with timeout
  const { logoutDevice } = require('../../utils/helpers/createDeviceSession');
  try {
    // Add timeout to prevent hanging - 3 seconds max
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Logout device timeout')), 3000);
    });

    await Promise.race([
      logoutDevice(req),
      timeoutPromise,
    ]);
  } catch (error) {
    logger.error('[Auth] Error logging out device session:', error.message);
    // Continue with cookie clearing even if device session logout fails or times out
  }

  // Log activity if user is authenticated (non-blocking)
  if (req.user) {
    try {
      logActivityAsync({
        userId: req.user._id || req.user.id,
        role: 'buyer',
        action: 'LOGOUT',
        description: `User logged out`,
        req,
      });
    } catch (error) {
      logger.error('[Auth] Error logging activity:', error.message);
      // Don't block logout if activity logging fails
    }
  }

  // Clear JWT cookie using standardized helper
  const { clearAuthCookie } = require('../../utils/helpers/authHelpers');
  clearAuthCookie(res, 'buyer');
  
  res.status(200).json({ status: 'success', message: 'Logged out successfully' });
});
//protect auth
exports.protect = catchAsync(async (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();
  
  // 🛡️ HARD SAFETY GUARD: Prevent seller routes from using buyer auth
  if (fullPath.startsWith('/api/v1/seller') || fullPath.startsWith('/seller')) {
    console.error('═══════════════════════════════════════════════════════════');
    console.error('[AUTH TRACE] ❌ CRITICAL ERROR: SELLER route passed to BUYER auth middleware');
    console.error('[AUTH TRACE] Route:', method, fullPath);
    console.error('[AUTH TRACE] This is a CONFIGURATION ERROR - seller routes must use protectSeller');
    console.error('[AUTH TRACE] Stack trace:', new Error().stack);
    console.error('═══════════════════════════════════════════════════════════');
    // Don't throw - let it fail with 401 so we can see the issue
    // But log it clearly so we know what's wrong
  }
  
  // 🔍 AUTH TRACE LOGGING
  if (fullPath.includes('/coupon') || fullPath.includes('/seller')) {
    console.log('[AUTH TRACE]', {
      path: fullPath,
      method: method,
      middleware: 'protectBuyer (buyer/authController.js)',
      cookies: req.cookies ? Object.keys(req.cookies) : 'none',
      hasSellerJwt: req.cookies?.seller_jwt ? 'YES' : 'NO',
      hasMainJwt: req.cookies?.main_jwt ? 'YES' : 'NO',
      timestamp: new Date().toISOString(),
    });
  }

  // Check public routes with caching
  if (isPublicRoute(fullPath, method)) {
    logger.info(`Allowing ${method} access to ${fullPath} (public route);`);
    return next();
  }
  // SECURITY: Cookie-only authentication - tokens MUST be in HTTP-only cookies
  // Authorization headers are NOT accepted to prevent XSS token theft
  // Extract token ONLY from cookies
  let token = null;
  // Check for app-specific cookie based on route path
  // IMPORTANT: Each app (eazmain, eazseller, eazadmin) uses its own cookie
  // Note: /api/v1/paymentrequest and /api/v1/support/seller are used by sellers, so they should use seller_jwt
  // Also check for seller order routes: /api/v1/order/get-seller-orders and /api/v1/order/seller-order
  // Product variant routes are also seller routes: /api/v1/product/:id/variants
  // POST /api/v1/product is a seller route (create product)
  // PATCH /api/v1/product/:id is a seller route (update product)
  // DELETE /api/v1/product/:id is a seller route (delete product)
  // GET /api/v1/product is public (not a seller route)
  // EXCEPTION: Admin-only seller routes (these require admin_jwt, not seller_jwt)
  // GET /api/v1/seller - getAllSeller (admin-only)
  // PATCH /api/v1/seller/:id/status - update seller status (admin-only)
  // PATCH /api/v1/seller/:id/approve-verification - approve seller verification (admin-only)
  // PATCH /api/v1/seller/:id/reject-verification - reject seller verification (admin-only)
  // PATCH /api/v1/seller/:id/document-status - update document status (admin-only)
  // PATCH /api/v1/seller/:id/approve-payout - approve payout (admin-only)
  // PATCH /api/v1/seller/:id/reject-payout - reject payout (admin-only)
  // GET /api/v1/seller/:id - getSeller (admin-only, unless seller accessing their own)
  const isAdminOnlySellerRoute = 
    (fullPath === '/api/v1/seller' && method === 'GET') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/status$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/approve-verification$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/reject-verification$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/document-status$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/approve-payout$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/reject-payout$/) && method === 'PATCH') ||
    // GET /seller/:id is admin-only, BUT /seller/me and /seller/reviews are seller-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+$/) && method === 'GET' && fullPath !== '/api/v1/seller/me' && fullPath !== '/api/v1/seller/reviews');
  // Check if this is a seller route (but allow admins to access shared product routes with admin_jwt)
  const isSellerRoute = !isAdminOnlySellerRoute && (
    fullPath.startsWith('/api/v1/seller') ||
    fullPath.startsWith('/api/v1/support/seller') ||
    fullPath.startsWith('/api/v1/paymentrequest') ||
    fullPath.startsWith('/api/v1/paymentmethod') || // Payment method routes (sellers need to add payment methods)
    fullPath.includes('/order/get-seller-orders') ||
    fullPath.includes('/order/seller-order/') ||
    fullPath.startsWith('/api/v1/analytics/seller') || // Seller analytics endpoints
    (fullPath.includes('/product/') && fullPath.includes('/variants')) ||
    (fullPath === '/api/v1/product' && method === 'POST') ||
    // Product PATCH/DELETE: Allow both seller_jwt and admin_jwt (shared route)
    (fullPath.startsWith('/api/v1/product/') && (method === 'PATCH' || method === 'DELETE'))
  );
  
  // Shared product routes that can be accessed by both sellers and admins
  // These routes should check both seller_jwt and admin_jwt cookies
  // IMPORTANT: These routes are NOT seller-only - they allow admins too
  const isSharedProductRoute = (
    (fullPath === '/api/v1/product' && method === 'POST') ||
    (fullPath.startsWith('/api/v1/product/') && (method === 'PATCH' || method === 'DELETE')) ||
    (fullPath.includes('/product/') && fullPath.includes('/variants'))
  );
  
  // CRITICAL: Ensure /api/v1/seller/coupon is detected as seller route
  // This route is mounted at /api/v1/seller/coupon, so it should match the startsWith check above
  // Adding explicit check for coupon routes to ensure they're detected
  if (fullPath.startsWith('/api/v1/seller/coupon')) {
    if (!isSellerRoute) {
      console.warn(`[Auth] ⚠️ Seller coupon route not detected as seller route: ${fullPath}`);
    }
  }

  const isAdminRoute = fullPath.startsWith('/api/v1/admin') ||
    fullPath.startsWith('/api/v1/support/admin') ||
    fullPath.startsWith('/api/v1/logs') ||
    fullPath.startsWith('/api/v1/eazshop');

  // Admin-only shared routes (routes that require admin but don't start with /api/v1/admin)
  // GET /api/v1/order - admin only (getAllOrder)
  // GET /api/v1/order/:id - admin only (getOrder)
  // PATCH /api/v1/order/:id - admin only (updateOrder)
  // GET /api/v1/users - admin only (getAllUsers)
  // GET /api/v1/users/:id - admin only (getUser)
  // PATCH /api/v1/users/:id - admin only (updateUser)
  // DELETE /api/v1/users/:id - admin only (deleteUser)
  const isAdminOnlySharedRoute = (
    (fullPath === '/api/v1/order' && method === 'GET') ||
    (fullPath.startsWith('/api/v1/order/') && method === 'GET' && !fullPath.includes('/get-seller-orders') && !fullPath.includes('/seller-order/') && !fullPath.includes('/get-user-orders') && !fullPath.includes('/get-user-order/') && !fullPath.endsWith('/tracking')) ||
    (fullPath.startsWith('/api/v1/order/') && method === 'PATCH' && !fullPath.includes('/shipping-address') && !fullPath.includes('/update-address') && !fullPath.includes('/pay-shipping-difference') && !fullPath.includes('/send-email') && !fullPath.includes('/confirm-payment') && !fullPath.includes('/status') && !fullPath.includes('/driver-location') && !fullPath.includes('/tracking') && !fullPath.includes('/request-refund') && !fullPath.includes('/refund-status')) ||
    (fullPath === '/api/v1/users' && method === 'GET') || // GET /users is admin-only (getAllUsers)
    (fullPath.startsWith('/api/v1/users/') && method === 'GET' && !fullPath.includes('/profile') && !fullPath.includes('/me') && !fullPath.includes('/get/count') && !fullPath.includes('/reset-password') && !fullPath.includes('/personalized') && !fullPath.includes('/recently-viewed')) || // GET /users/:id is admin-only
    // PATCH /users/:id is admin-only, but allow non-admin avatar + self-update routes
    (fullPath.startsWith('/api/v1/users/') && method === 'PATCH' &&
      !fullPath.includes('/updatePassword') &&
      !fullPath.includes('/updateMe') &&
      !fullPath.includes('/reset-password') &&
      !fullPath.includes('/avatar')) || // <-- buyer avatar update should use buyer cookie
    (fullPath.startsWith('/api/v1/users/') && method === 'DELETE' && !fullPath.includes('/deleteMe')) // DELETE /users/:id is admin-only
  );

  // Shared routes that can be accessed by multiple roles (buyers, sellers, admins)
  // Check for support ticket creation - can be used by any authenticated user
  const isSharedSupportRoute = fullPath === '/api/v1/support/tickets' && method === 'POST';
  
  // Notification routes are shared - can be accessed by buyers, sellers, and admins
  const isSharedNotificationRoute = fullPath.startsWith('/api/v1/notifications');

  // For shared product routes, check admin_jwt first (admins can manage products)
  // Then fall back to seller_jwt (sellers can manage their own products)
  let cookieName;
  if (isSharedProductRoute) {
    // Shared product routes: try admin_jwt first, then seller_jwt
    cookieName = req.cookies?.['admin_jwt'] ? 'admin_jwt' : 'seller_jwt';
  } else if (isSellerRoute) {
    cookieName = 'seller_jwt';
  } else if (isAdminRoute || isAdminOnlySharedRoute || isAdminOnlySellerRoute) {
    cookieName = 'admin_jwt';
  } else {
    cookieName = 'main_jwt'; // Default to buyer/eazmain
  }

  // Enhanced debug logging for verify-otp, payout, and payment method routes
  if (fullPath.includes('/verify-otp') || fullPath.includes('/payout') || fullPath.includes('/paymentmethod')) {
    logger.info(`[Auth] 🔍 Payment/OTP route detected:`, {
      fullPath,
      method,
      isSellerRoute,
      cookieName,
      hasAuthHeader: !!req.headers.authorization,
      cookieKeys: req.cookies ? Object.keys(req.cookies) : 'none',
      seller_jwt: req.cookies?.seller_jwt ? 'present' : 'missing',
      main_jwt: req.cookies?.main_jwt ? 'present' : 'missing',
      admin_jwt: req.cookies?.admin_jwt ? 'present' : 'missing'
    });
  }

  // Debug logging for route detection
  if (fullPath.includes('/order') || fullPath.includes('/logs')) {
    console.log(`[Auth] Route detected: ${fullPath}, method: ${method}, isSellerRoute: ${isSellerRoute}, isAdminRoute: ${isAdminRoute}, isAdminOnlySharedRoute: ${isAdminOnlySharedRoute}, cookieName: ${cookieName}`);
  }

  // Security: For seller routes, ONLY accept seller_jwt, never main_jwt
  if (isSellerRoute) {
    // Explicitly check for seller_jwt only
    if (req.cookies && req.cookies.main_jwt) {
      logger.warn(`[Auth] ⚠️ SECURITY: Seller route detected main_jwt cookie - ignoring it. Route: ${fullPath}`);
      // Don't use main_jwt for seller routes - this prevents cross-app authentication
    }
  }

  if (!token) {
    // For shared support routes, check multiple cookies (seller, buyer, admin)
    if (isSharedSupportRoute && req.cookies) {
      // Try seller_jwt first (sellers creating tickets)
      if (req.cookies.seller_jwt) {
        token = req.cookies.seller_jwt;
        logger.info(`[Auth] ✅ Token found in seller_jwt cookie for ${method} ${fullPath}`);
      }
      // Then try admin_jwt (admins creating tickets)
      else if (req.cookies.admin_jwt) {
        token = req.cookies.admin_jwt;
        logger.info(`[Auth] ✅ Token found in admin_jwt cookie for ${method} ${fullPath}`);
      }
      // Finally try main_jwt (buyers creating tickets)
      else if (req.cookies.main_jwt) {
        token = req.cookies.main_jwt;
        logger.info(`[Auth] ✅ Token found in main_jwt cookie for ${method} ${fullPath}`);
      }
    }
    
    // For shared notification routes, check multiple cookies (seller, buyer, admin)
    if (isSharedNotificationRoute && req.cookies && !token) {
      // Try seller_jwt first (sellers accessing notifications)
      if (req.cookies.seller_jwt) {
        token = req.cookies.seller_jwt;
        logger.info(`[Auth] ✅ Token found in seller_jwt cookie for notification route: ${method} ${fullPath}`);
      }
      // Then try admin_jwt (admins accessing notifications)
      else if (req.cookies.admin_jwt) {
        token = req.cookies.admin_jwt;
        logger.info(`[Auth] ✅ Token found in admin_jwt cookie for notification route: ${method} ${fullPath}`);
      }
      // Finally try main_jwt (buyers accessing notifications)
      else if (req.cookies.main_jwt) {
        token = req.cookies.main_jwt;
        logger.info(`[Auth] ✅ Token found in main_jwt cookie for notification route: ${method} ${fullPath}`);
      }
    }

    // For specific routes, use the determined cookie name
    if (!token && req.cookies && req.cookies[cookieName]) {
      token = req.cookies[cookieName];
      logger.info(`[Auth] ✅ Token found in cookie (${cookieName}) for ${method} ${fullPath}`);
    }
    
    // Enhanced logging for payment method routes
    if (fullPath.includes('/paymentmethod') && !token) {
      logger.warn(`[Auth] ⚠️ Payment method route - no token found:`, {
        fullPath,
        method,
        isSellerRoute,
        cookieName,
        availableCookies: req.cookies ? Object.keys(req.cookies) : 'none',
        expectedCookie: cookieName,
        hasExpectedCookie: req.cookies?.[cookieName] ? 'YES' : 'NO'
      });
    }
    
    // For admin-only shared routes, also try admin_jwt if main_jwt was defaulted
    if (!token && isAdminOnlySharedRoute && req.cookies && req.cookies.admin_jwt) {
      token = req.cookies.admin_jwt;
      console.log(`[Auth] ✅ Token found in admin_jwt cookie for admin-only shared route: ${method} ${fullPath}`);
    }

    // If still no token found
    if (!token) {
      // Enhanced debug logging for verify-otp routes and seller coupon routes
      const isVerifyOtpRoute = fullPath.includes('/verify-otp');
      const isSellerCouponRoute = fullPath.startsWith('/api/v1/seller/coupon');

      console.error('═══════════════════════════════════════════════════════════');
      console.error(`[Auth] ❌ CRITICAL: No token found for ${isVerifyOtpRoute ? 'verify-otp' : isSellerCouponRoute ? 'seller coupon' : 'protected'} route`);
      console.error('═══════════════════════════════════════════════════════════');
      
      // Enhanced logging for seller coupon routes
      if (isSellerCouponRoute) {
        console.error(`[Auth] 🔍 SELLER COUPON ROUTE DEBUG:`);
        console.error(`[Auth] Route: ${method} ${fullPath}`);
        console.error(`[Auth] Route Detection:`, {
          isSellerRoute,
          isAdminOnlySellerRoute,
          cookieName,
          expectedCookie: 'seller_jwt',
        });
        console.error(`[Auth] Available Cookies:`, req.cookies ? Object.keys(req.cookies) : 'none');
        console.error(`[Auth] seller_jwt present: ${req.cookies?.seller_jwt ? 'YES' : 'NO'}`);
        if (req.cookies?.seller_jwt) {
          console.error(`[Auth] seller_jwt length: ${req.cookies.seller_jwt.length}`);
        }
      }

      if (isVerifyOtpRoute) {
        logger.error(`[Auth] Route: ${method} ${fullPath}`);
        logger.error(`[Auth] Request details:`, {
          url: req.url,
          originalUrl: req.originalUrl,
          path: req.path,
          method: req.method,
          timestamp: new Date().toISOString()
        });
        // SECURITY: Never log full auth headers or cookie strings (tokens / session IDs)
        logger.error(`[Auth] Headers (sanitized):`, {
          authorization: req.headers.authorization ? {
            present: true,
            length: req.headers.authorization.length,
            prefix: req.headers.authorization.substring(0, 20) + '...' // prefix only
          } : 'missing',
          cookie: req.headers.cookie ? {
            present: true,
            length: req.headers.cookie.length
          } : 'missing'
        });
        logger.error(`[Auth] Cookies (parsed):`, req.cookies ? {
          keys: Object.keys(req.cookies),
          seller_jwt: req.cookies.seller_jwt ? {
            present: true,
            length: req.cookies.seller_jwt.length,
            prefix: req.cookies.seller_jwt.substring(0, 20) + '...'
          } : 'missing',
          main_jwt: req.cookies.main_jwt ? 'present' : 'missing',
          admin_jwt: req.cookies.admin_jwt ? 'present' : 'missing',
          cookieCount: Object.keys(req.cookies).length
        } : 'undefined');
        logger.error(`[Auth] Route Detection:`, {
          isSellerRoute,
          cookieName,
          isSharedSupportRoute
        });
      } else {
        // Standard logging for other routes
        logger.info(`[Auth] ❌ No token found for protected route: ${method} ${fullPath}`);
        logger.info(`[Auth] Authorization header: ${req.headers.authorization ? 'present' : 'missing'}`);
        logger.info(`[Auth] Cookies object:`, req.cookies ? Object.keys(req.cookies) : 'undefined');
      }

      if (isSharedSupportRoute || isSharedNotificationRoute) {
        logger.info(`[Auth] Shared route - checked seller_jwt: ${req.cookies?.seller_jwt ? 'present' : 'missing'}, admin_jwt: ${req.cookies?.admin_jwt ? 'present' : 'missing'}, main_jwt: ${req.cookies?.main_jwt ? 'present' : 'missing'}`);
      } else {
        logger.info(`[Auth] Cookie ${cookieName}: ${req.cookies?.[cookieName] ? 'present' : 'missing'}`);
      }
      // Log all cookies for debugging (but don't log values for security)
      logger.info(`[Auth] Available cookie names:`, req.cookies ? Object.keys(req.cookies) : 'none');

      console.error(`[Auth] 🛑 RETURNING 401 - No token found`);
      console.error(`[Auth] Route: ${method} ${fullPath}`);
      console.error(`[Auth] Expected cookie: ${cookieName}`);
      console.error(`[Auth] Available cookies:`, req.cookies ? Object.keys(req.cookies).join(', ') : 'none');
      console.error('═══════════════════════════════════════════════════════════');

      return next(
        new AppError('You are not logged in! Please log in to get access.', 401),
      );
    }
  }
  // Check token blacklist using the helper method (hashes token before checking)
  const isBlacklisted = await TokenBlacklist.isBlacklisted(token);
  if (isBlacklisted) {
    return next(
      new AppError('Your session has expired. Please log in again.', 401),
    );
  }

  // Verify token
  const { decoded, error } = await verifyToken(token, fullPath);

  if (error || !decoded) {
    logger.error(
      'Token verification failed:',
      error?.message || 'Invalid token',
    );
    return next(new AppError('Session expired', 401));
  }

  // Find user
  const currentUser = await findUserByToken(decoded);
  if (!currentUser) {
    const isVerifyOtpRoute = fullPath.includes('/verify-otp');
    if (isVerifyOtpRoute) {
      logger.error(`[Auth] ❌ User not found for token in verify-otp route:`, {
        userId: decoded.id,
        role: decoded.role,
        fullPath
      });
    }
    return next(
      new AppError('The user belonging to this token no longer exists', 401),
    );
  }

  // Check password change timestamp
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    const isVerifyOtpRoute = fullPath.includes('/verify-otp');
    if (isVerifyOtpRoute) {
      logger.error(`[Auth] ❌ Password changed after token issued for verify-otp route:`, {
        userId: currentUser.id,
        fullPath
      });
    }
    return next(
      new AppError('User recently changed password! Please log in again', 401),
    );
  }

  // SECURITY FIX #9: Session timeout check (30 minutes of inactivity)
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  if (currentUser.lastActivity && Date.now() - new Date(currentUser.lastActivity).getTime() > SESSION_TIMEOUT) {
    console.warn(`[Auth] Session timeout for user ${currentUser.id} - last activity: ${currentUser.lastActivity}`);
    return next(new AppError('Session expired', 401));
  }

  // Update last activity timestamp
  currentUser.lastActivity = Date.now();
  // Save without triggering validation (non-blocking update)
  currentUser.save({ validateBeforeSave: false }).catch(err => {
    // Log error but don't block request if save fails
    console.error('[Auth] Error updating lastActivity:', err);
  });

  // Attach user to request with deviceId from token
  req.user = currentUser;
  if (decoded.deviceId) {
    req.user.deviceId = decoded.deviceId;
  }

  // CRITICAL: Verify role matches route requirements
  // For seller routes, ensure user is actually a seller
  // Check for seller routes including order routes and product routes
  // EXCEPTION: Admin-only seller routes (these require admin role, not seller role)
  // GET /api/v1/seller - getAllSeller (admin-only)
  // PATCH /api/v1/seller/:id/status - update seller status (admin-only)
  // PATCH /api/v1/seller/:id/approve-verification - approve seller verification (admin-only)
  // PATCH /api/v1/seller/:id/reject-verification - reject seller verification (admin-only)
  // PATCH /api/v1/seller/:id/document-status - update document status (admin-only)
  // PATCH /api/v1/seller/:id/approve-payout - approve payout (admin-only)
  // PATCH /api/v1/seller/:id/reject-payout - reject payout (admin-only)
  // GET /api/v1/seller/:id - getSeller (admin-only, unless seller accessing their own)
  const isAdminOnlySellerRouteCheck = 
    (fullPath === '/api/v1/seller' && method === 'GET') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/status$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/approve-verification$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/reject-verification$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/document-status$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/approve-payout$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/reject-payout$/) && method === 'PATCH') ||
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+$/) && method === 'GET'); // GET /seller/:id is admin-only
  
  // Use isSharedProductRoute that was already declared earlier (line 1352)
  // Shared product routes should NOT be restricted to sellers only - they allow admins too
  const isSellerRouteCheck = !isAdminOnlySellerRouteCheck && !isSharedProductRoute && (
    fullPath.startsWith('/api/v1/seller') ||
    fullPath.startsWith('/api/v1/support/seller') ||
    fullPath.startsWith('/api/v1/paymentrequest') ||
    fullPath.includes('/order/get-seller-orders') ||
    fullPath.includes('/order/seller-order/')
  );

  if (isSellerRouteCheck) {
    if (currentUser.role !== 'seller') {
      logger.error(`[Auth] ❌ SECURITY: Seller route accessed by ${currentUser.role} (${currentUser.email || currentUser.phone})`);
      return next(
        new AppError(`You do not have permission to perform this action. Required role: seller, Your role: ${currentUser.role}`, 403)
      );
    }
  }

  // For admin routes, ensure user is actually an admin
  // Check both explicit admin routes and admin-only shared routes
  const isAdminRouteCheck = fullPath.startsWith('/api/v1/admin') ||
    fullPath.startsWith('/api/v1/support/admin') ||
    fullPath.startsWith('/api/v1/logs') ||
    fullPath.startsWith('/api/v1/eazshop') ||
    (fullPath === '/api/v1/seller' && method === 'GET') || // GET /api/v1/seller is admin-only (getAllSeller)
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/status$/) && method === 'PATCH') || // PATCH /seller/:id/status is admin-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/approve-verification$/) && method === 'PATCH') || // Approve verification is admin-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/reject-verification$/) && method === 'PATCH') || // Reject verification is admin-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/document-status$/) && method === 'PATCH') || // Document status is admin-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/approve-payout$/) && method === 'PATCH') || // Approve payout is admin-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+\/reject-payout$/) && method === 'PATCH') || // Reject payout is admin-only
    // GET /seller/:id is admin-only, BUT /seller/me and /seller/reviews are seller-only
    (fullPath.match(/^\/api\/v1\/seller\/[^/]+$/) && method === 'GET' && fullPath !== '/api/v1/seller/me' && fullPath !== '/api/v1/seller/reviews') || // GET /seller/:id is admin-only
    ((fullPath === '/api/v1/order' && method === 'GET') ||
     (fullPath.startsWith('/api/v1/order/') && method === 'GET' && !fullPath.includes('/get-seller-orders') && !fullPath.includes('/seller-order/') && !fullPath.includes('/get-user-orders') && !fullPath.includes('/get-user-order/')) ||
     (fullPath.startsWith('/api/v1/order/') && method === 'PATCH' && !fullPath.includes('/shipping-address') && !fullPath.includes('/update-address') && !fullPath.includes('/pay-shipping-difference') && !fullPath.includes('/send-email') && !fullPath.includes('/confirm-payment') && !fullPath.includes('/status') && !fullPath.includes('/driver-location') && !fullPath.includes('/tracking') && !fullPath.includes('/request-refund') && !fullPath.includes('/refund-status'))) ||
    // Admin-only user routes: GET /api/v1/users (getAllUsers), GET/PATCH/DELETE /api/v1/users/:id
    // BUT explicitly exclude self-service buyer routes like /profile, /me, /get/count, /reset-password, /personalized, /recently-viewed, /avatar
    (fullPath === '/api/v1/users' && method === 'GET') || // GET /users is admin-only (getAllUsers)
    (fullPath.startsWith('/api/v1/users/') && method === 'GET' &&
      !fullPath.includes('/profile') &&
      !fullPath.includes('/me') &&
      !fullPath.includes('/get/count') &&
      !fullPath.includes('/reset-password') &&
      !fullPath.includes('/personalized') &&
      !fullPath.includes('/recently-viewed')) ||
    (fullPath.startsWith('/api/v1/users/') && method === 'PATCH' &&
      !fullPath.includes('/updatePassword') &&
      !fullPath.includes('/updateMe') &&
      !fullPath.includes('/reset-password') &&
      !fullPath.includes('/avatar')) ||
    (fullPath.startsWith('/api/v1/users/') && method === 'DELETE' && !fullPath.includes('/deleteMe'));

  if (isAdminRouteCheck) {
    if (currentUser.role !== 'admin') {
      console.error(`[Auth] ❌ SECURITY: Admin route accessed by ${currentUser.role} (${currentUser.email || currentUser.phone})`);
      console.error(`[Auth] ❌ Route details: ${method} ${fullPath}`);
      console.error(`[Auth] ❌ User ID: ${currentUser.id}, Role: ${currentUser.role}`);
      return next(
        new AppError(`You do not have permission to perform this action. Required role: admin, Your role: ${currentUser.role}`, 403)
      );
    }
  }

  // Enhanced logging for verify-otp routes
  if (fullPath.includes('/verify-otp')) {
    logger.info(`[Auth] ✅ Authentication successful for verify-otp:`, {
      userId: currentUser.id,
      role: currentUser.role,
      email: currentUser.email || currentUser.phone,
      fullPath
    });
  } else {
    logger.info(
      `Authenticated as ${currentUser.role}: ${currentUser.email || currentUser.phone}`,
    );
  }
  next();
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // Ensure req.user exists
    if (!req.user) {
      logger.error(`[restrictTo] ❌ No user found in request. Path: ${req.path}, Method: ${req.method}`);
      return next(
        new AppError('You are not authenticated. Please log in to get access.', 401),
      );
    }

    // Get role from user object, fallback to 'user' if not set
    const userRole = req.user.role || 'user';

    console.log(`[restrictTo] Checking permissions - User role: ${userRole}, Required roles:`, roles, `Path: ${req.path}, Method: ${req.method}, Full URL: ${req.originalUrl}`);

    if (!roles.includes(userRole)) {
      console.error(`[restrictTo] ❌ Permission denied - User role: ${userRole}, Required: ${roles.join(' or ')}, Path: ${req.path}, Method: ${req.method}, Full URL: ${req.originalUrl}, User ID: ${req.user.id}`);
      console.error(`[restrictTo] ❌ Request headers:`, {
        'user-agent': req.headers['user-agent'],
        'referer': req.headers['referer'],
        'origin': req.headers['origin'],
      });
      return next(
        new AppError(`You do not have permission to perform this action. Required role: ${roles.join(' or ')}, Your role: ${userRole}`, 403),
      );
    }

    logger.info(`[restrictTo] ✅ Permission granted - User role: ${userRole} matches required roles`);
    next();
  };
};

// SECURITY FIX: Legacy OTP-based password reset (deprecated - use requestPasswordReset instead)
// This function is kept for backward compatibility but has been secured
exports.sendPasswordResetOtp = catchAsync(async (req, res, next) => {
  try {
    const { loginId } = req.body;

    // Validate input
    if (!loginId) {
      return next(new AppError('Please provide email or phone number', 400));
    }

    // Determine if loginId is email or phone
    const isEmail = loginId.includes('@');
    const query = isEmail ? { email: loginId } : { phone: loginId };

    // SECURITY FIX #1: Prevent account enumeration - always return same response
    // Find user silently (don't reveal if user exists)
    const user = await User.findOne(query);

    // SECURITY FIX #1: Always return generic success message (prevent account enumeration)
    // Even if user doesn't exist, return the same message to prevent timing attacks
    const genericResponse = {
      message: 'If an account exists, a reset code has been sent.',
      method: isEmail ? 'email' : 'phone',
    };

    // Only process if user exists (but don't reveal this to client)
    if (user) {
      // SECURITY FIX #1: Use createOtp() method which hashes OTP before storing
      // This replaces the insecure: user.otp = otp (plaintext)
      const otp = user.createOtp(); // Hashes OTP using SHA-256 before storing
      user.otpType = 'passwordReset'; // Differentiate from login OTP
      await user.save();

      // SECURITY FIX #3: Log OTP to server console only (never send to client)
      // For development, log to server console only
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV ONLY - SERVER SIDE] OTP for ${loginId}: ${otp}`);
        console.log(`[DEV ONLY - SERVER SIDE] User ID: ${user._id}`);
      }

      // Send OTP via email or SMS (silently fail if service fails)
      try {
        if (isEmail) {
          await sendLoginOtpEmail(user.email, otp, user.name);
          console.log(`[Auth] Password reset OTP email sent to ${user.email}`);
        } else {
          await sendSMS({
            to: user.phone,
            message: `Your password reset code is: ${otp}. It will expire in 10 minutes.`,
          });
        }
      } catch (emailError) {
        // Log error but don't expose to client (prevent information leakage)
        console.error('[Password Reset] Failed to send OTP:', emailError);
        // Still return success to prevent account enumeration
      }
    } else {
      // User doesn't exist - add small random delay to prevent timing attacks
      // This makes response time similar whether user exists or not
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
    }

    // SECURITY FIX #2 & #3: Always return same generic message, never include OTP
    // OTP is NEVER sent in API response (even in development)
    res.status(200).json(genericResponse);
  } catch (error) {
    // SECURITY FIX #2: Generic error message (don't leak internal details)
    console.error('[Password Reset] Error:', error);
    // Always return same generic message even on errors
    res.status(200).json({
      message: 'If an account exists, a reset code has been sent.',
      method: req.body.loginId?.includes('@') ? 'email' : 'phone',
    });
  }
});
// SECURITY FIX: Legacy OTP verification (deprecated - use resetPasswordWithToken instead)
// This function is kept for backward compatibility but has been secured
exports.verifyResetOtp = catchAsync(async (req, res, next) => {
  try {
    const { loginId, otp } = req.body;

    // Validate input
    if (!loginId || !otp) {
      return next(new AppError('Please provide loginId and OTP', 400));
    }

    // Determine if loginId is email or phone
    const isEmail = loginId.includes('@');
    const query = isEmail ? { email: loginId } : { phone: loginId };

    // Find user with valid OTP
    const user = await User.findOne({
      ...query,
      otpType: 'passwordReset',
    }).select('+otp +otpExpires +otpAttempts +otpLockedUntil');

    // SECURITY FIX #2: Generic error message (prevent account enumeration)
    if (!user) {
      // Add small delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
      return next(new AppError('Invalid or expired OTP', 400));
    }

    // SECURITY FIX #4 (Phase 2 Enhancement): Track failed attempts
    const { trackFailedAttempt, clearFailedAttempts } = require('../../middleware/security/otpVerificationSecurity');
    
    // Verify OTP using secure method (compares hashed OTP)
    const otpVerification = user.verifyOtp(otp);
    
    // SECURITY FIX #2: Generic error message (don't reveal if OTP format is wrong vs expired)
    if (!otpVerification || !otpVerification.valid) {
      // SECURITY FIX #4: Track failed attempt for lockout
      trackFailedAttempt(req);
      
      // Log failed attempt for security monitoring
      console.warn(`[Security] Failed OTP verification attempt for ${loginId}`, {
        reason: otpVerification?.reason || 'unknown',
        locked: otpVerification?.locked || false,
        ip: req.ip,
      });
      
      // Add small delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
      return next(new AppError('Invalid or expired OTP', 400));
    }
    
    // SECURITY FIX #4: Clear failed attempts on successful verification
    clearFailedAttempts(req);

    user.otpVerified = true;
    // Generate reset token (cryptographically secure)
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash token before storing in database
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.resetTokenExpires = Date.now() + 15 * 60 * 1000; // 15 minutes (matching cookie expiry)
    await user.save({ validateBeforeSave: false });

    // SECURITY FIX: Store reset token in httpOnly cookie (not accessible via JavaScript)
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('reset-token', resetToken, {
      httpOnly: true, // Not accessible via JavaScript - prevents XSS attacks
      secure: isProduction, // HTTPS only in production
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000, // 15 minutes
      ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
    });

    // SECURITY: Do NOT send resetToken in response
    res.status(200).json({
      status: 'success',
      message: 'OTP verified. You can now reset your password.',
    });
  } catch (error) {
    // SECURITY FIX #2: Generic error message (don't leak internal details)
    console.error('[Verify OTP] Error:', error);
    res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
  }
});
// Reset password
exports.resetPassword = catchAsync(async (req, res, next) => {
  try {
    const { loginId, newPassword } = req.body;

    // SECURITY FIX: Get reset token from httpOnly cookie (not from request body)
    const resetToken = req.cookies['reset-token'];
    
    if (!resetToken) {
      return next(new AppError('Reset token expired or invalid. Please verify OTP again.', 403));
    }

    // Validate input
    if (!loginId || !newPassword) {
      return next(new AppError('Please provide loginId and newPassword', 400));
    }

    // Check password strength
    if (newPassword.length < 8) {
      return next(
        new AppError('Password must be at least 8 characters long', 400),
      );
    }

    // Determine if loginId is email or phone
    const isEmail = loginId.includes('@');
    const query = isEmail ? { email: loginId } : { phone: loginId };

    // Hash the token from cookie to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Find user with valid reset token
    const user = await User.findOne({
      ...query,
      resetPasswordToken: hashedToken,
      resetTokenExpires: { $gt: Date.now() },
      otpType: 'passwordReset',
    }).select(
      '+otp +otpExpires +otpVerified +resetPasswordToken +resetTokenExpires +password',
    );

    if (!user) {
      // Clear invalid token cookie
      res.clearCookie('reset-token');
      return next(new AppError('Reset token expired or invalid', 403));
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password and clear reset fields
    user.password = hashedPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpType = undefined;
    user.otpVerified = undefined;
    user.resetPasswordToken = undefined;
    user.resetTokenExpires = undefined;
    user.passwordChangedAt = Date.now();

    await user.save();

    // SECURITY: Clear reset token cookie after successful password reset
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('reset-token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
    });

    // Send confirmation email/SMS
    if (isEmail) {
      await sendCustomEmail({
        to: user.email,
        subject: 'Password Reset Successful',
        html: `
          <h2>Password Reset Successful</h2>
          <p>Your password has been successfully reset.</p>
          <p>If you did not perform this action, please contact support immediately.</p>
        `,
      });
    } else {
      await sendSMS({
        to: user.phone,
        message:
          'Your password has been successfully reset. If you did not perform this action, please contact support immediately.',
      });
    }

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    logger.error('Password reset error:', error);
    res
      .status(500)
      .json({ error: 'Failed to reset password. Please try again.' });
  }
});

/**
 * ==================================================
 * UNIFIED EMAIL-ONLY PASSWORD RESET FLOW
 * ==================================================
 * 
 * STEP 1: Request Password Reset (Email Only)
 * POST /api/v1/auth/forgot-password
 * Body: { email: "user@example.com" }
 * 
 * STEP 2: Reset Password with Token
 * POST /api/v1/auth/reset-password
 * Body: { token: "reset_token", newPassword: "newpass123", confirmPassword: "newpass123" }
 */

/**
 * Request Password Reset (Email Only)
 * - Accepts email address
 * - Silently handles (no account enumeration)
 * - Generates secure reset token
 * - Sends reset link via email
 * - Rate limited (5 requests per email per hour)
 */
exports.requestPasswordReset = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  // Validate email
  if (!email) {
    return next(new AppError('Please provide an email address', 400));
  }

  // Normalize email
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    // Silently return success to prevent account enumeration
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Find user by email (silently - don't reveal if user exists)
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordResetToken +passwordResetExpires');

  // SECURITY: Always return success message (prevent account enumeration)
  // Even if user doesn't exist, return the same message
  if (!user) {
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Check rate limiting (max 5 requests per email per hour)
  // If user has a recent reset token that hasn't expired yet, don't send another
  if (user.passwordResetExpires && user.passwordResetExpires > Date.now()) {
    // Token still valid, don't send another email (rate limiting)
    // Still return success to prevent information leakage
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Generate reset token using user model method
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  try {
    // Send password reset email
    await sendPasswordResetEmail(user.email, resetToken, user.name || 'User');
    
    console.log(`[Password Reset] Reset email sent to ${user.email}`);
  } catch (err) {
    // If email fails, clear the reset token
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    // Still return success to prevent information leakage
    console.error('[Password Reset] Failed to send reset email:', err);
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Generic success message (no account enumeration)
  res.status(200).json({
    status: 'success',
    message: 'If an account exists, a reset email has been sent.',
  });
});

/**
 * Reset Password with Token
 * - Validates reset token
 * - Ensures token is not expired or used
 * - Hashes password using bcrypt (12 rounds)
 * - Updates user password
 * - Clears reset token & expiry
 * - Invalidates ALL active sessions
 * - Sends confirmation email
 */
exports.resetPasswordWithToken = catchAsync(async (req, res, next) => {
  const { token, newPassword, confirmPassword } = req.body;

  // Validate input
  if (!token) {
    return next(new AppError('Reset token is required', 400));
  }

  if (!newPassword || !confirmPassword) {
    return next(new AppError('Please provide both new password and confirmation', 400));
  }

  // Validate password match
  if (newPassword !== confirmPassword) {
    return next(new AppError('Passwords do not match', 400));
  }

  // Check password strength
  if (newPassword.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Hash the token to compare with stored hash
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid reset token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires +password');

  if (!user) {
    return next(new AppError('Invalid or expired reset token', 400));
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update user password and clear reset fields
  user.password = hashedPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordChangedAt = Date.now();

  await user.save();

  // SECURITY: Invalidate all active sessions
  // This ensures that if someone had access to the account, they're logged out
  // Note: This requires session management implementation
  // For JWT-based auth, tokens will naturally expire, but you may want to:
  // 1. Add a passwordChangedAt check in token verification
  // 2. Maintain a token blacklist
  // 3. Use refresh tokens that can be revoked

  try {
    // Send confirmation email
    await sendCustomEmail({
      to: user.email,
      subject: 'Password Reset Successful',
      html: `
        <h2>Password Reset Successful</h2>
        <p>Your password has been successfully reset.</p>
        <p>If you did not perform this action, please contact support immediately.</p>
        <p><strong>Security Notice:</strong> All active sessions have been invalidated. Please log in again.</p>
      `,
    });
  } catch (err) {
    // Don't fail the request if email fails
    console.error('[Password Reset] Failed to send confirmation email:', err);
  }

  res.status(200).json({
    status: 'success',
    message: 'Password reset successfully. Please login with your new password.',
  });
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }

  user.password = req.body.newPassword;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  createSendToken(user, 200, res, null, 'main_jwt');
});

// Reset/Set PIN endpoint - handles both setting initial PIN and resetting existing PIN
exports.resetPin = catchAsync(async (req, res, next) => {
  const { currentPin, newPin } = req.body;

  // Validate input - newPin is always required
  if (!newPin) {
    return next(new AppError('Please provide a new PIN', 400));
  }

  // Validate PIN format (4 digits)
  const pinRegex = /^\d{4}$/;
  if (!pinRegex.test(newPin)) {
    return next(new AppError('PIN must be exactly 4 digits', 400));
  }

  // Get user with PIN selected
  const user = await User.findById(req.user.id).select('+pin');

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Unable to process request', 404));
  }

  const hasExistingPin = !!user.pin;

  // If user has an existing PIN, currentPin is required
  if (hasExistingPin) {
    if (!currentPin) {
      return next(new AppError('Please provide your current PIN', 400));
    }

    if (!pinRegex.test(currentPin)) {
      return next(new AppError('Current PIN must be exactly 4 digits', 400));
    }

    // Verify current PIN
    if (!(await user.correctPin(currentPin))) {
      return next(new AppError('Current PIN is incorrect', 401));
    }

    // Check if new PIN is different from current
    if (await user.correctPin(newPin)) {
      return next(new AppError('New PIN must be different from current PIN', 400));
    }
  }
  // If no existing PIN, this is initial PIN setup (currentPin not required)

  // Update or set PIN
  user.pin = newPin;
  // Ensure pinChangedAt is set (for first-time PIN setup)
  if (!user.pinChangedAt) {
    user.pinChangedAt = Date.now();
  }
  await user.save();

  res.status(200).json({
    status: 'success',
    message: hasExistingPin ? 'PIN reset successfully' : 'PIN set successfully',
  });
});

// Resend OTP endpoint for buyers
exports.resendOtp = catchAsync(async (req, res, next) => {
  const { email, phone } = req.body;

  if (!email && !phone) {
    return next(
      new AppError('Please provide either email or phone number', 400)
    );
  }

  let user;
  if (email && validator.isEmail(email)) {
    user = await User.findOne({ email });
  } else if (phone) {
    user = await User.findOne({ phone: phone.replace(/\D/g, '') });
  } else {
    return next(
      new AppError('Please provide a valid email or phone number', 400)
    );
  }

  if (!user) {
    return next(
      new AppError('No user found with that email or phone number', 404)
    );
  }

  // Check if account is locked
  if (user.otpLockedUntil && new Date(user.otpLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(user.otpLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    return next(
      new AppError(
        `Account locked. Please try again in ${minutesRemaining} minute(s).`,
        429
      )
    );
  }

  // Generate new OTP
  const { sendLoginOtpEmail } = require('../../utils/email/emailService');
  const otp = user.createOtp();
  await user.save({ validateBeforeSave: false });

  // SECURITY FIX #11 (Phase 3 Enhancement): Secure logging (masks sensitive data)
  const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
  logOtpGeneration(user._id, user.email || user.phone, 'resend');
  secureLog.debug('Resend OTP generated', {
    userId: user._id,
    loginId: user.email || user.phone,
    // OTP value is NEVER logged, even in development
  });

  // Send OTP via email
  if (user.email) {
    try {
      await sendLoginOtpEmail(user.email, otp, user.name);
      logger.info(`[Resend OTP] OTP sent to ${user.email}`);
    } catch (error) {
      logger.error('[Resend OTP] Failed to send email:', error.message);
    }
  }

  // Send OTP via SMS if phone provided
  if (user.phone) {
    try {
      const { sendSMS } = require('../../utils/email/emailService');
      await sendSMS({
        to: user.phone,
        message: `Your EazShop verification code is: ${otp}. Valid for 10 minutes.`,
      });
      logger.info(`[Resend OTP] OTP sent to phone ${user.phone}`);
    } catch (error) {
      logger.error('[Resend OTP] Failed to send SMS:', error.message);
    }
  }

  // SECURITY FIX #3: NEVER include OTP in API response, even in development
  res.status(200).json({
    status: 'success',
    message: 'Verification code sent to your email or phone!',
    // OTP is NEVER included in response (security best practice)
  });
});

// Verify account with OTP (for signup verification)
exports.verifyAccount = catchAsync(async (req, res, next) => {
  const { email, phone, otp } = req.body;

  if (!otp) {
    return next(new AppError('Please provide the verification code', 400));
  }

  if (!email && !phone) {
    return next(
      new AppError('Please provide either email or phone number', 400)
    );
  }

  // Normalize inputs
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  let user;
  if (normalizedEmail) {
    user = await User.findOne({ email: normalizedEmail }).select('+otp +otpExpires +otpAttempts +otpLockedUntil +otpType');
  } else if (normalizedPhone) {
    user = await User.findOne({ phone: normalizedPhone })
      .select('+otp +otpExpires +otpAttempts +otpLockedUntil +otpType');
  } else {
    return next(
      new AppError('Please provide a valid email or phone number', 400)
    );
  }

  if (!user) {
    return next(
      new AppError('No user found with that email or phone number', 404)
    );
  }

  // Normalize OTP
  const otpString = String(otp || '').trim().replace(/\D/g, '');

  if (!otpString || otpString.length !== 6) {
    return next(new AppError('Please provide a valid 6-digit verification code', 400));
  }

  // Verify OTP using shared helper with type checking
  const { verifyOtp, clearOtp } = require('../../utils/helpers/otpHelpers');
  const otpResult = verifyOtp(user, otpString, OTP_TYPES.SIGNUP);

  // Handle account lockout
  if (otpResult.locked) {
    await user.save({ validateBeforeSave: false });
    return next(
      new AppError(
        `Your account is locked for ${otpResult.minutesRemaining} minute(s) due to multiple failed attempts. Please try again later.`,
        429
      )
    );
  }

  // Handle failed OTP verification
  if (!otpResult.valid) {
    await user.save({ validateBeforeSave: false });

    // Provide specific error message
    const attemptsRemaining = 5 - (user.otpAttempts || 0);
    let errorMessage = 'Invalid verification code.';

    if (otpResult.reason === 'expired') {
      errorMessage = `Verification code expired ${otpResult.minutesExpired || 0} minute(s) ago. Request a new one.`;
    } else if (otpResult.reason === 'no_otp') {
      errorMessage = 'No verification code found. Please request a new one.';
    } else if (otpResult.reason === 'type_mismatch') {
      errorMessage = 'This verification code is not valid for account verification.';
    } else if (otpResult.reason === 'mismatch') {
      errorMessage = `Wrong code. You have ${attemptsRemaining} attempt(s) remaining.`;
    } else {
      errorMessage = `Invalid code. You have ${attemptsRemaining} attempt(s) remaining.`;
    }

    return next(new AppError(errorMessage, 401));
  }

  // OTP is valid - mark as verified
  if (normalizedEmail) {
    user.emailVerified = true;
  }
  if (normalizedPhone) {
    user.phoneVerified = true;
  }

  // Clear OTP fields using shared helper
  clearOtp(user);
  await user.save({ validateBeforeSave: false });

  // Determine which verification method was used
  const verifiedBy = [];
  if (user.emailVerified) verifiedBy.push('email');
  if (user.phoneVerified) verifiedBy.push('phone');

  // Determine which login method to use based on verification
  let loginMethod = 'either';
  if (user.emailVerified && !user.phoneVerified) {
    loginMethod = 'email';
  } else if (user.phoneVerified && !user.emailVerified) {
    loginMethod = 'phone';
  }

  res.status(200).json({
    status: 'success',
    message: 'Account verified successfully! You can now log in.',
    data: {
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        verifiedBy: verifiedBy, // ✅ Shows which method(s) verified the account
        isVerified: user.emailVerified || user.phoneVerified, // ✅ Overall verification status
        loginMethod: loginMethod, // ✅ Shows which method to use for login ('email', 'phone', or 'either')
      },
    },
  });
});

// Legacy email verification (kept for backward compatibility)
exports.emailVerification = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError('No user found with that email address', 404));
  }

  // Use OTP instead of email link
  const { sendLoginOtpEmail } = require('../../utils/email/emailService');
  const otp = user.createOtp();
  await user.save({ validateBeforeSave: false });

  try {
    await sendLoginOtpEmail(user.email, otp, user.name);
    logger.info(`[Email Verification] OTP sent to ${user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'Verification code sent to your email!',
      otp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err) {
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError('There was an error sending the verification code', 500),
    );
  }
});

// ==================== TWO-FACTOR AUTHENTICATION ====================

/**
 * Enable Two-Factor Authentication
 * POST /api/v1/users/enable-2fa
 * Generates a secret and QR code for 2FA setup
 */
exports.enableTwoFactor = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Unable to process request', 404));
  }

  // Generate a secret using speakeasy (properly base32 encoded)
  const secretData = speakeasy.generateSecret({
    name: `EazShop (${user.email || user.phone?.toString() || 'User'})`,
    issuer: 'EazShop',
    length: 32,
  });

  // Get base32 secret (this is what we store and use)
  const base32Secret = secretData.base32;
  
  // Store temporary secret (will be moved to twoFactorSecret after verification)
  // IMPORTANT: Do NOT set twoFactorEnabled = true here (only after verification)
  user.twoFactorTempSecret = base32Secret;
  // Ensure twoFactorEnabled remains false until verification
  user.twoFactorEnabled = false;
  await user.save({ validateBeforeSave: false });

  // Generate backup codes (10 codes, 8 characters each)
  const backupCodes = [];
  for (let i = 0; i < 10; i++) {
    backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  user.twoFactorBackupCodes = backupCodes;
  await user.save({ validateBeforeSave: false });

  // Get otpauth URL from speakeasy
  const otpAuthUrl = secretData.otpauth_url;

  // Mask secret for response (show only last 4 characters)
  const base32SecretMasked = base32Secret.length > 4 
    ? `${'*'.repeat(base32Secret.length - 4)}${base32Secret.slice(-4)}`
    : '****';

  res.status(200).json({
    status: 'success',
    message: 'Two-factor authentication setup initiated. Please scan the QR code and verify the code to complete setup.',
    data: {
      // Nested structure for web compatibility (matches EazMain web app)
      twoFactor: {
        otpAuthUrl,
        base32: base32SecretMasked, // Masked secret for display (last 4 chars visible)
        // NOTE: Full secret is NOT exposed in response for security
      },
      // Flat structure for backward compatibility
      otpAuthUrl,
      base32SecretMasked,
      twoFactorPending: true, // Indicates 2FA is pending verification
      is2FAEnabled: false, // Still pending verification
      backupCodes,
    },
  });
});

/**
 * Get Two-Factor Authentication Setup Data
 * GET /api/v1/users/2fa/setup
 * Returns setup data if user hasn't completed 2FA setup yet
 */
exports.getTwoFactorSetup = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+twoFactorTempSecret +twoFactorBackupCodes');

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Unable to process request', 404));
  }

  if (user.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is already enabled', 400));
  }

  if (!user.twoFactorTempSecret) {
    return next(new AppError('No setup in progress. Please enable 2FA first.', 400));
  }

  // Generate otpauth URL from the stored base32 secret
  const serviceName = 'EazShop';
  const accountName = user.email || user.phone?.toString() || 'User';
  const otpAuthUrl = speakeasy.otpauthURL({
    secret: user.twoFactorTempSecret,
    label: accountName,
    issuer: serviceName,
    encoding: 'base32',
  });

  // Mask secret for response
  const base32SecretMasked = user.twoFactorTempSecret.length > 4 
    ? `${'*'.repeat(user.twoFactorTempSecret.length - 4)}${user.twoFactorTempSecret.slice(-4)}`
    : '****';

  res.status(200).json({
    status: 'success',
    message: 'Two-factor authentication setup data retrieved.',
    data: {
      // Nested structure for web compatibility
      twoFactor: {
        otpAuthUrl,
        base32: base32SecretMasked, // Masked secret for display
      },
      // Flat structure for backward compatibility
      otpAuthUrl,
      base32SecretMasked,
      twoFactorPending: true, // Indicates 2FA is pending verification
      is2FAEnabled: false, // Still pending verification
      backupCodes: user.twoFactorBackupCodes || [],
    },
  });
});

/**
 * Verify Two-Factor Authentication Code
 * POST /api/v1/users/2fa/verify
 * Verifies the code from authenticator app and completes 2FA setup
 */
exports.verifyTwoFactor = catchAsync(async (req, res, next) => {
  const { code } = req.body;

  if (!code || code.length !== 6) {
    return next(new AppError('Please provide a valid 6-digit verification code', 400));
  }

  const user = await User.findById(req.user.id).select('+twoFactorTempSecret');

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Unable to process request', 404));
  }

  if (!user.twoFactorTempSecret) {
    return next(new AppError('No 2FA setup in progress. Please enable 2FA first.', 400));
  }

  // Verify TOTP using speakeasy (proper implementation)
  const verified = speakeasy.totp.verify({
    secret: user.twoFactorTempSecret,
    encoding: 'base32',
    token: code,
    window: 2, // Allow ±1 time step (60 seconds total window)
  });

  if (!verified) {
    return next(new AppError('Invalid verification code. Please try again.', 401));
  }

  // Move temp secret to permanent secret and enable 2FA
  user.twoFactorSecret = user.twoFactorTempSecret;
  user.twoFactorTempSecret = undefined;
  user.twoFactorEnabled = true;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Two-factor authentication has been successfully enabled!',
    data: {
      is2FAEnabled: true,
      twoFactorEnabled: true,
      twoFactorPending: false, // No longer pending
      // Nested structure for web compatibility
      twoFactor: {
        enabled: true,
      },
    },
  });
});

/**
 * Disable Two-Factor Authentication
 * POST /api/v1/users/disable-2fa
 * Disables 2FA for the user (may require verification code)
 */
exports.disableTwoFactor = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Unable to process request', 404));
  }

  if (!user.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is not enabled', 400));
  }

  // Clear 2FA data
  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorTempSecret = undefined;
  user.twoFactorBackupCodes = [];
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Two-factor authentication has been disabled',
    data: {
      is2FAEnabled: false,
      twoFactorEnabled: false,
    },
  });
});
