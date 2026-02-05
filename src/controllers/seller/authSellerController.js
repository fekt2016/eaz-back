const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const AppError = require('../../utils/errors/appError');
const { sendEmail, sendPasswordResetEmail } = require('../../utils/email/emailService');
const crypto = require('crypto');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const SecurityLog = require('../../models/user/securityModal');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const { sendLoginOtpEmail } = require('../../utils/email/emailService');
const { logActivityAsync, logActivity } = require('../../modules/activityLog/activityLog.service');
const securityMonitor = require('../../services/securityMonitor');
const ActivityLog = require('../../models/activityLog/activityLogModel');
const speakeasy = require('speakeasy');
const NodeCache = require('node-cache');
const logger = require('../../utils/logger');
// Shared helpers for standardized auth
const { normalizeEmail, normalizePhone, handleSuccessfulLogin, clearAuthCookie } = require('../../utils/helpers/authHelpers');
const { OTP_TYPES, generateOtp, verifyOtp, clearOtp } = require('../../utils/helpers/otpHelpers');

// Initialize login session cache (5 minutes TTL) for 2FA login flow
const loginSessionCache = new NodeCache({ stdTTL: 300 });

/**
 * POST /seller/signup
 * Register a new seller account
 * Requires OTP verification before login
 */
exports.signupSeller = catchAsync(async (req, res, next) => {
  // SECURITY: Normalize email to lowercase
  if (req.body.email) {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail) {
      return next(new AppError('Please provide a valid email address', 400));
    }
    req.body.email = normalizedEmail;
  }

  // SECURITY: Normalize phone number (digits only)
  if (req.body.phone) {
    req.body.phone = normalizePhone(req.body.phone);
  }

  // SECURITY: Set verification status to false (requires OTP verification)
  req.body.verification = {
    emailVerified: false, // Always false on signup - requires OTP verification
    businessVerified: false,
  };

  // SECURITY: Enforce role server-side (seller only)
  req.body.role = 'seller';

  // ✅ FIX: Remove paymentMethods completely if not provided
  // Payment methods should be added later in settings, not during registration
  // This prevents validation errors from empty enum fields
  if (req.body.paymentMethods) {
    const { bankAccount, mobileMoney } = req.body.paymentMethods;
    
    // Check if paymentMethods has any meaningful data
    const hasBankData = bankAccount && (bankAccount.bankName || bankAccount.accountNumber || bankAccount.accountName);
    const hasMobileData = mobileMoney && (mobileMoney.phone || mobileMoney.network || mobileMoney.accountName);
    
    // Remove paymentMethods if all fields are empty/undefined
    if (!hasBankData && !hasMobileData) {
      delete req.body.paymentMethods;
    } else {
      // Clean up empty enum fields that would fail validation
      if (bankAccount) {
        if (!bankAccount.bankName || bankAccount.bankName === '') {
          delete bankAccount.bankName;
        }
        if (!bankAccount.accountNumber) {
          delete bankAccount.accountNumber;
        }
        if (!bankAccount.accountName) {
          delete bankAccount.accountName;
        }
        // If bankAccount is now empty, remove it
        if (Object.keys(bankAccount).length === 0) {
          delete req.body.paymentMethods.bankAccount;
        }
      }
      if (mobileMoney) {
        if (!mobileMoney.phone || mobileMoney.phone === '') {
          delete mobileMoney.phone;
        }
        if (!mobileMoney.network || mobileMoney.network === '') {
          delete mobileMoney.network;
        }
        if (!mobileMoney.accountName) {
          delete mobileMoney.accountName;
        }
        // If mobileMoney is now empty, remove it
        if (Object.keys(mobileMoney).length === 0) {
          delete req.body.paymentMethods.mobileMoney;
        }
      }
      // If paymentMethods is now empty, remove it completely
      if (Object.keys(req.body.paymentMethods).length === 0) {
        delete req.body.paymentMethods;
      }
    }
  }

  const newSeller = await Seller.create(req.body);
  if (!newSeller) {
    return next(new AppError('check your cred and register again', 401));
  }

  // Double-check: Ensure role is ALWAYS 'seller' after creation
  if (!newSeller.role || newSeller.role !== 'seller') {
    logger.info(`[Seller Auth] Correcting role from "${newSeller.role}" to "seller" for new seller: ${newSeller.email}`);
    newSeller.role = 'seller';
    await newSeller.save({ validateBeforeSave: false });
  }

  // SECURITY: Generate OTP for signup verification using shared helper
  const otp = generateOtp(newSeller, OTP_TYPES.SIGNUP);
  await newSeller.save({ validateBeforeSave: false });

  // SECURITY FIX #2: Secure logging (masks sensitive data, never logs OTP)
  const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
  logOtpGeneration(newSeller._id, newSeller.email, 'signup');
  secureLog.debug('Seller signup OTP generated', {
    userId: newSeller._id,
    email: newSeller.email,
    // OTP value is NEVER logged, even in development
  });

  // Send OTP via email
  try {
    await sendLoginOtpEmail(newSeller.email, otp, newSeller.name || newSeller.shopName);
    secureLog.debug('Seller signup OTP email sent', {
      userId: newSeller._id,
      email: newSeller.email,
    });
  } catch (emailError) {
    secureLog.error('Failed to send seller signup OTP email', {
      userId: newSeller._id,
      error: emailError.message,
    });
    // Don't fail signup if email fails - OTP is still generated
  }

  // Log activity
  logActivityAsync({
    userId: newSeller._id,
    role: 'seller',
    action: 'SIGNUP',
    description: `New seller registered: ${newSeller.email}`,
    req,
  });

  // Notify all admins about new seller registration
  try {
    const notificationService = require('../../services/notification/notificationService');
    await notificationService.createSellerRegistrationNotification(
      newSeller._id,
      newSeller.shopName || newSeller.name,
      newSeller.email
    );
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Seller Signup] Admin notification created for new seller ${newSeller._id}`);
    }
  } catch (notificationError) {
    logger.error('[Seller Signup] Error creating admin notification:', notificationError);
    // Don't fail signup if notification fails
  }

  // ✅ Don't create token yet - seller must verify email first
  res.status(201).json({
    status: 'success',
    requiresVerification: true,
    message: 'Account created! Please check your email for the verification code.',
    data: {
      seller: {
        id: newSeller._id,
        name: newSeller.name,
        email: newSeller.email,
        shopName: newSeller.shopName,
      },
      otp: process.env.NODE_ENV !== 'production' ? otp : undefined, // Only in dev
    },
  });
});

/**
 * POST /seller/login
 * Login with email + password only (no OTP)
 * If 2FA is enabled, returns 2fa_required response
 * If 2FA is disabled, issues token immediately
 * MATCHES BUYER LOGIN FLOW EXACTLY
 */
exports.loginSeller = catchAsync(async (req, res, next) => {
  // Debug logging to help diagnose request body issues
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Seller Login] Request received');
    console.log('[Seller Login] Content-Type:', req.headers['content-type']);
    console.log('[Seller Login] Request body keys:', Object.keys(req.body || {}));
    console.log('[Seller Login] Request body:', JSON.stringify(req.body));
    console.log('[Seller Login] Request method:', req.method);
    console.log('[Seller Login] Request URL:', req.originalUrl);
  }

  // Check if body parsing worked
  if (!req.body || typeof req.body !== 'object') {
    return next(
      new AppError(
        'Invalid request format. Please ensure Content-Type is application/json and the request body is valid JSON.',
        400
      )
    );
  }

  const { email, password } = req.body;

  if (!email || !password) {
    // Provide more helpful error message
    const missingFields = [];
    if (!email) missingFields.push('email');
    if (!password) missingFields.push('password');
    
    const receivedKeys = Object.keys(req.body || {}).length > 0 
      ? Object.keys(req.body).join(', ') 
      : 'none';
    
    return next(
      new AppError(
        `Please provide ${missingFields.join(' and ')}. Received fields: ${receivedKeys}`,
        400
      )
    );
  }

  if (!validator.isEmail(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // SECURITY: Normalize email to prevent case-sensitivity issues
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // Debug logging (only in development)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Seller Login] Normalized email:', normalizedEmail);
  }

  // Find seller with password and 2FA status
  const seller = await Seller.findOne({ email: normalizedEmail }).select('+password +twoFactorEnabled');

  if (!seller) {
    // Production-safe logging
    logger.warn('[Seller Login] 401 - Seller not found', {
      email: normalizedEmail,
      originalEmail: email,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      origin: req.headers.origin,
    });
    
    // In production, also check if seller exists with different casing (for debugging)
    if (process.env.NODE_ENV === 'production') {
      const anySeller = await Seller.findOne({ email: new RegExp(`^${email}$`, 'i') });
      if (anySeller) {
        logger.warn('[Seller Login] ⚠️ Seller exists but email case mismatch', {
          requestedEmail: email,
          normalizedEmail: normalizedEmail,
          foundEmail: anySeller.email,
          timestamp: new Date().toISOString(),
          ip: req.ip,
        });
      }
    }
    
    // Debug logging (only in development)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Seller Login] ❌ Seller not found for email:', normalizedEmail);
      // Check if seller exists with different email casing
      const anySeller = await Seller.findOne({ email: new RegExp(`^${email}$`, 'i') });
      if (anySeller) {
        console.log('[Seller Login] ⚠️ Seller exists but email normalization mismatch. Original:', email, 'Found:', anySeller.email);
      }
    }
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Invalid email or password', 401));
  }

  // Production-safe logging for seller found
  logger.info('[Seller Login] Seller found - checking authorization', {
    sellerId: seller._id.toString(),
    email: seller.email,
    emailVerified: seller.verification?.emailVerified || false,
    status: seller.status,
    active: seller.active,
    hasPassword: !!seller.password,
    timestamp: new Date().toISOString(),
    ip: req.ip,
  });

  // Debug logging (only in development)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Seller Login] ✅ Seller found:', {
      id: seller._id,
      email: seller.email,
      emailVerified: seller.verification?.emailVerified,
      status: seller.status,
      active: seller.active,
      hasPassword: !!seller.password,
    });
  }

  // SECURITY: Check if account is suspended
  if (seller.status === 'suspended' || seller.active === false) {
    logger.warn('[Seller Login] 401 - Account suspended', {
      sellerId: seller._id.toString(),
      email: seller.email,
      status: seller.status,
      active: seller.active,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Seller Login] ❌ Account suspended:', { status: seller.status, active: seller.active });
    }
    return next(new AppError('Your account has been suspended. Please contact support.', 401));
  }

  // SECURITY: Check if account is verified (REQUIRED before login)
  // Treat as verified if: emailVerified flag is set, OR onboarding/verification status is 'verified' (admin-approved or legacy)
  const isEmailVerified = seller.verification?.emailVerified === true;
  const isOnboardingVerified = seller.onboardingStage === 'verified';
  const isVerificationStatusVerified = seller.verificationStatus === 'verified';
  const consideredVerified = isEmailVerified || isOnboardingVerified || isVerificationStatusVerified;

  if (!consideredVerified) {
    // Production-safe logging (no sensitive data)
    logger.warn('[Seller Login] 403 - Account not verified', {
      sellerId: seller._id.toString(),
      email: seller.email,
      emailVerified: seller.verification?.emailVerified || false,
      onboardingStage: seller.onboardingStage,
      verificationStatus: seller.verificationStatus,
      status: seller.status,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Seller Login] ❌ Account not verified:', {
        emailVerified: seller.verification?.emailVerified,
        onboardingStage: seller.onboardingStage,
        verificationStatus: seller.verificationStatus,
      });
    }
    return next(
      new AppError(
        'Account not verified. Please verify your email address first.',
        403
      )
    );
  }

  // SECURITY: Verify password
  if (!seller.password) {
    logger.warn('[Seller Login] 401 - No password set for seller', {
      sellerId: seller._id.toString(),
      email: seller.email,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Seller Login] ❌ No password set for seller');
    }
    return next(new AppError('Invalid email or password', 401));
  }

  // Production-safe logging before password check
  logger.info('[Seller Login] Verifying password', {
    sellerId: seller._id.toString(),
    email: seller.email,
    hasPassword: !!seller.password,
    passwordLength: seller.password?.length || 0,
    timestamp: new Date().toISOString(),
    ip: req.ip,
  });

  const passwordValid = await seller.correctPassword(password, seller.password);
  
  // Production-safe logging after password check
  logger.info('[Seller Login] Password verification result', {
    sellerId: seller._id.toString(),
    email: seller.email,
    passwordValid: passwordValid,
    timestamp: new Date().toISOString(),
    ip: req.ip,
  });
  
  if (!passwordValid) {
    logger.warn('[Seller Login] 401 - Password mismatch', {
      sellerId: seller._id.toString(),
      email: seller.email,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Seller Login] ❌ Password mismatch for seller:', seller.email);
    }
    // SECURITY: Increment failed login attempts (if field exists)
    if (seller.failedLoginAttempts !== undefined) {
      seller.failedLoginAttempts = (seller.failedLoginAttempts || 0) + 1;
      // Lock account after 5 failed attempts (15 minutes)
      if (seller.failedLoginAttempts >= 5) {
        seller.accountLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await seller.save({ validateBeforeSave: false });
        return next(new AppError('Too many failed login attempts. Account locked for 15 minutes.', 429));
      }
      await seller.save({ validateBeforeSave: false });
    }
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Invalid email or password', 401));
  }

  // SECURITY: Check if account is locked
  if (seller.accountLockedUntil && new Date(seller.accountLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(seller.accountLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    return next(
      new AppError(
        `Account is temporarily locked. Please try again in ${minutesRemaining} minute(s).`,
        429
      )
    );
  }

  // Reset failed login attempts on successful password verification
  if (seller.failedLoginAttempts !== undefined && seller.failedLoginAttempts > 0) {
    seller.failedLoginAttempts = 0;
    seller.accountLockedUntil = null;
    await seller.save({ validateBeforeSave: false });
  }

  // Check 2FA status
  if (seller.twoFactorEnabled) {
    // 2FA is enabled - require Google Authenticator code
    // Generate temporary session ID for 2FA verification
    const loginSessionId = crypto.randomBytes(32).toString('hex');
    
    // Store session in shared cache (5 minutes TTL)
    loginSessionCache.set(loginSessionId, {
      userId: seller._id.toString(),
      email: seller.email,
      timestamp: Date.now(),
    });

    return res.status(200).json({
      status: '2fa_required',
      message: 'Two-factor authentication is enabled. Please provide your 2FA code.',
      requires2FA: true,
      loginSessionId: loginSessionId,
      data: {
        userId: seller._id,
        email: seller.email,
      },
    });
  }

  // 2FA is disabled - issue token immediately
  // Use standardized login helper
  try {
    const response = await handleSuccessfulLogin(req, res, seller, 'seller');
    
    // Production-safe logging for successful login
    logger.info('[Seller Login] ✅ Login successful', {
      sellerId: seller._id.toString(),
      email: seller.email,
      status: seller.status,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      origin: req.headers.origin,
      cookieDomain: process.env.COOKIE_DOMAIN || 'not set',
      nodeEnv: process.env.NODE_ENV,
    });
    
    // Log cookie setting in production for debugging
    if (process.env.NODE_ENV === 'production') {
      logger.info('[Seller Login] Cookie configuration', {
        cookieName: 'seller_jwt',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
        domain: process.env.COOKIE_DOMAIN || 'not set',
        hasSetCookieHeader: !!res.getHeader('Set-Cookie'),
      });
    }
    
    res.status(200).json(response);
  } catch (deviceError) {
    if (process.env.NODE_ENV === 'production' && 
        (deviceError.message?.includes('Too many devices') || 
         deviceError.message?.includes('Device limit exceeded'))) {
      // Production-safe logging for device limit
      logger.warn('[Seller Login] 403 - Device limit exceeded', {
        sellerId: seller._id.toString(),
        email: seller.email,
        deviceLimit: deviceError.deviceLimit,
        timestamp: new Date().toISOString(),
        ip: req.ip,
      });
      
      // Return user-friendly error with device limit details
      const errorMessage = deviceError.message || 
        `Device limit exceeded. You have reached the maximum number of devices. Please log out from another device or contact support.`;
      
      return next(new AppError(errorMessage, 403));
    }
    // In dev, continue without device session
    logger.warn('[Seller Login] ⚠️ Device session creation failed, continuing without it', {
      sellerId: seller._id.toString(),
      error: deviceError.message,
    });
    const response = await handleSuccessfulLogin(req, res, seller, 'seller', { skipDeviceSession: true });
    res.status(200).json(response);
  }
});

/**
 * POST /seller/verify-2fa-login
 * Verify 2FA code and issue JWT token
 * Requires loginSessionId from /seller/login response
 * MATCHES BUYER VERIFY-2FA-LOGIN EXACTLY
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

  // Find seller with 2FA secret
  const seller = await Seller.findById(session.userId).select('+twoFactorSecret +twoFactorBackupCodes');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  if (!seller.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is not enabled for this account', 400));
  }

  // Verify 2FA code
  const verified = speakeasy.totp.verify({
    secret: seller.twoFactorSecret,
    encoding: 'base32',
    token: twoFactorCode,
    window: 2,
  });

  // Check backup codes if TOTP fails
  let backupCodeUsed = false;
  if (!verified && seller.twoFactorBackupCodes && seller.twoFactorBackupCodes.length > 0) {
    const backupCodeIndex = seller.twoFactorBackupCodes.findIndex(
      (code) => code === twoFactorCode.toUpperCase()
    );
    
    if (backupCodeIndex !== -1) {
      seller.twoFactorBackupCodes.splice(backupCodeIndex, 1);
      await seller.save({ validateBeforeSave: false });
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

  // Use standardized login helper
  try {
    const response = await handleSuccessfulLogin(req, res, seller, 'seller');
    res.status(200).json(response);
  } catch (deviceError) {
    if (process.env.NODE_ENV === 'production' && 
        (deviceError.message?.includes('Too many devices') || 
         deviceError.message?.includes('Device limit exceeded'))) {
      logger.warn('[Seller 2FA Login] 403 - Device limit exceeded', {
        sellerId: seller._id.toString(),
        email: seller.email,
        deviceLimit: deviceError.deviceLimit,
        timestamp: new Date().toISOString(),
        ip: req.ip,
      });
      
      const errorMessage = deviceError.message || 
        `Device limit exceeded. You have reached the maximum number of devices. Please log out from another device or contact support.`;
      
      return next(new AppError(errorMessage, 403));
    }
    // In dev, continue without device session
    logger.warn('[Seller 2FA Login] ⚠️ Device session creation failed, continuing without it', {
      sellerId: seller._id.toString(),
      error: deviceError.message,
    });
    const response = await handleSuccessfulLogin(req, res, seller, 'seller', { skipDeviceSession: true });
    res.status(200).json(response);
  }
});

/**
 * POST /seller/send-otp
 * Send OTP for login (legacy OTP-based login)
 */
exports.sendOtp = catchAsync(async (req, res, next) => {
  const { loginId } = req.body;

  if (!loginId) {
    return next(new AppError('Please provide email or phone number', 400));
  }

  let seller;

  if (validator.isEmail(loginId)) {
    const normalizedEmail = normalizeEmail(loginId);
    if (!normalizedEmail) {
      return next(new AppError('Please provide a valid email address', 400));
    }
    seller = await Seller.findOne({ email: normalizedEmail });
  } else {
    return next(
      new AppError('Please provide a valid email address', 400),
    );
  }

  if (!seller) {
    return next(
      new AppError('No seller account found with that email address. Please sign up first or check your email.', 404),
    );
  }

  const otp = generateOtp(seller, OTP_TYPES.LOGIN);
  await seller.save({ validateBeforeSave: false });

  // SECURITY FIX #2: Secure logging (masks sensitive data, never logs OTP)
  const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
  logOtpGeneration(seller._id, loginId, 'login');
  secureLog.debug('Login OTP generated', {
    userId: seller._id,
    loginId,
    // OTP value is NEVER logged, even in development
  });

  // Send OTP via email
  if (validator.isEmail(loginId)) {
    try {
      await sendLoginOtpEmail(seller.email, otp, seller.name || seller.shopName);
      secureLog.debug('Login OTP email sent', {
        userId: seller._id,
        email: seller.email,
      });
    } catch (error) {
      secureLog.error('Failed to send login OTP email', {
        userId: seller._id,
        error: error.message,
      });
      // Don't fail the request if email fails, OTP is still generated
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'OTP sent to your email!',
    // SECURITY: Don't send OTP in response
  });
});

/**
 * POST /seller/verify-otp
 * Verify OTP for login (legacy OTP-based login)
 */
exports.verifyOtp = catchAsync(async (req, res, next) => {
  try {
    const { loginId, otp, password, redirectTo } = req.body;

    if (!loginId || !otp || !password) {
      return next(
        new AppError('Please provide loginId, OTP, and password', 400),
      );
    }

    let seller;
    const query = Seller.findOne();

    if (validator.isEmail(loginId)) {
      const normalizedEmail = normalizeEmail(loginId);
      if (!normalizedEmail) {
        return next(new AppError('Please provide a valid email address', 400));
      }
      query.where({ email: normalizedEmail });
    } else {
      return next(
        new AppError('Please provide a valid email address', 400),
      );
    }

    query.select('+password +otp +otpExpires +otpAttempts +otpLockedUntil +otpType');
    seller = await query;

    if (!seller) {
      return next(
        new AppError('No seller found with that email address', 404),
      );
    }

    // Verify OTP using shared helper
    const otpResult = verifyOtp(seller, otp, OTP_TYPES.LOGIN);

    // Handle account lockout
    if (otpResult.locked) {
      await seller.save({ validateBeforeSave: false });
      return next(
        new AppError(
          `Your account is locked for ${otpResult.minutesRemaining} minute(s) due to multiple failed attempts. Please try again later.`,
          429
        )
      );
    }

    // Handle failed OTP verification
    if (!otpResult.valid) {
      await seller.save({ validateBeforeSave: false });
      const attemptsRemaining = 5 - (seller.otpAttempts || 0);
      let errorMessage = 'Invalid verification code.';
      
      if (otpResult.reason === 'expired') {
        errorMessage = `Verification code expired ${otpResult.minutesExpired || 0} minute(s) ago. Request a new one.`;
      } else if (otpResult.reason === 'no_otp') {
        errorMessage = 'No verification code found. Please request a new one.';
      } else if (otpResult.reason === 'type_mismatch') {
        errorMessage = 'This verification code is not valid for login.';
      } else if (otpResult.reason === 'mismatch') {
        errorMessage = `Wrong code. You have ${attemptsRemaining} attempt(s) remaining.`;
      }
      
      return next(new AppError(errorMessage, 401));
    }

    // Verify password
    if (!(await seller.correctPassword(password, seller.password))) {
      // SECURITY: Generic error message to prevent information leakage
      return next(new AppError('Invalid credentials', 401));
    }

    // Clear OTP and update last login
    clearOtp(seller);
    seller.lastLogin = Date.now();

    // Ensure role is ALWAYS 'seller'
    if (!seller.role || seller.role !== 'seller') {
      seller.role = 'seller';
    }

    // Mark email as verified when OTP is verified (since OTP is sent to email)
    if (!seller.verification?.emailVerified) {
      seller.verification = seller.verification || {};
      seller.verification.emailVerified = true;
    }

    await seller.save({ validateBeforeSave: false });

    // Use standardized login helper
    try {
      const response = await handleSuccessfulLogin(req, res, seller, 'seller');
      response.redirectTo = redirectTo || '/';
      res.status(200).json(response);
    } catch (deviceError) {
      if (process.env.NODE_ENV === 'production' && 
          (deviceError.message?.includes('Too many devices') || 
           deviceError.message?.includes('Device limit exceeded'))) {
        logger.warn('[Seller OTP Login] 403 - Device limit exceeded', {
          sellerId: seller._id.toString(),
          email: seller.email,
          deviceLimit: deviceError.deviceLimit,
          timestamp: new Date().toISOString(),
          ip: req.ip,
        });
        
        const errorMessage = deviceError.message || 
          `Device limit exceeded. You have reached the maximum number of devices. Please log out from another device or contact support.`;
        
        return next(new AppError(errorMessage, 403));
      }
      // In dev, continue without device session
      logger.warn('[Seller OTP Login] ⚠️ Device session creation failed, continuing without it', {
        sellerId: seller._id.toString(),
        error: deviceError.message,
      });
      const response = await handleSuccessfulLogin(req, res, seller, 'seller', { skipDeviceSession: true });
      response.redirectTo = redirectTo || '/';
      res.status(200).json(response);
    }
  } catch (error) {
    logger.error('[Seller Auth] OTP verification error:', error);
    return next(new AppError('Failed to verify OTP. Please try again.', 500));
  }
});

/**
 * POST /seller/verify-account
 * Verify email with OTP (for new signups)
 */
exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { otp, email } = req.body;

  if (!otp) {
    return next(new AppError('Please provide OTP', 400));
  }

  // SECURITY: Normalize email
  const normalizedEmail = normalizeEmail(email);

  let seller;
  
  // Support both authenticated (req.user.id) and unauthenticated (email) verification
  if (req.user && req.user.id) {
    // Authenticated seller verifying their own email
    seller = await Seller.findById(req.user.id).select('+otp +otpExpires +otpAttempts +otpLockedUntil +otpType');
  } else if (normalizedEmail) {
    // Unauthenticated seller verifying during signup (using email)
    seller = await Seller.findOne({ email: normalizedEmail }).select('+otp +otpExpires +otpAttempts +otpLockedUntil +otpType');
  } else {
    return next(new AppError('Please provide email address or be logged in', 400));
  }

  if (!seller) {
    return next(new AppError('No seller found', 404));
  }

  // If already verified, return success
  if (seller.verification?.emailVerified) {
    return res.status(200).json({
      status: 'success',
      message: 'Email is already verified',
      data: {
        seller: {
          id: seller._id,
          email: seller.email,
          verification: seller.verification,
        },
      },
    });
  }

  // Verify OTP using shared helper with type checking
  const otpResult = verifyOtp(seller, otp, OTP_TYPES.SIGNUP);

  // Handle account lockout
  if (otpResult.locked) {
    await seller.save({ validateBeforeSave: false });
    return next(
      new AppError(
        `Your account is locked for ${otpResult.minutesRemaining} minute(s) due to multiple failed attempts. Please try again later.`,
        429
      )
    );
  }

  // Handle failed OTP verification
  if (!otpResult.valid) {
    await seller.save({ validateBeforeSave: false });
    const attemptsRemaining = 5 - (seller.otpAttempts || 0);
    let errorMessage = 'Invalid verification code.';
    
    if (otpResult.reason === 'expired') {
      errorMessage = `Verification code expired ${otpResult.minutesExpired || 0} minute(s) ago. Request a new one.`;
    } else if (otpResult.reason === 'no_otp') {
      errorMessage = 'No verification code found. Please request a new one.';
    } else if (otpResult.reason === 'type_mismatch') {
      errorMessage = 'This verification code is not valid for account verification.';
    } else if (otpResult.reason === 'mismatch') {
      errorMessage = `Wrong code. You have ${attemptsRemaining} attempt(s) remaining.`;
    }
    
    return next(new AppError(errorMessage, 401));
  }

  // OTP is valid - mark email as verified
  seller.verification = seller.verification || {};
  seller.verification.emailVerified = true;
  
  // If seller status is pending (or not set), activate the account on email verification
  if (!seller.status || seller.status === 'pending') {
    seller.status = 'active';
  }
  
  // Clear OTP fields using shared helper
  clearOtp(seller);
  await seller.save({ validateBeforeSave: false });

  if (process.env.NODE_ENV !== 'production') {
    console.log(`✅ [Seller Verification] Email verified for: ${seller.email}`);
  }

  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully!',
    data: {
      seller: {
        id: seller._id,
        email: seller.email,
        verification: seller.verification,
      },
    },
  });
});

/**
 * POST /seller/resend-otp
 * Resend OTP for email verification
 */
exports.resendOtp = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // SECURITY: Normalize email
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // SECURITY FIX #3: Prevent account enumeration - always return generic message
  const seller = await Seller.findOne({ email: normalizedEmail });

  // Always return generic success message (prevent account enumeration)
  const genericResponse = {
    status: 'success',
    message: 'If an account exists, a verification code has been sent.',
  };

  if (!seller) {
    return res.status(200).json(genericResponse); // ✅ Generic message, no enumeration
  }

  // Check if account is locked
  if (seller.otpLockedUntil && new Date(seller.otpLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(seller.otpLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    return next(
      new AppError(
        `Account locked. Please try again in ${minutesRemaining} minute(s).`,
        429
      )
    );
  }

  // Generate new OTP
  const otp = generateOtp(seller, OTP_TYPES.SIGNUP);
  await seller.save({ validateBeforeSave: false });

  // SECURITY FIX #2: Secure logging (masks sensitive data, never logs OTP)
  const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
  logOtpGeneration(seller._id, seller.email, 'resend');
  secureLog.debug('Resend OTP generated', {
    userId: seller._id?.toString?.() ?? String(seller._id),
    email: seller.email,
    // OTP value is NEVER logged, even in development
  });

  // Send OTP via email
  const sellerIdStr = seller._id?.toString?.() ?? String(seller._id);
  try {
    await sendLoginOtpEmail(seller.email, otp, seller.name || seller.shopName);
    secureLog.debug('Resend OTP email sent', {
      userId: sellerIdStr,
      email: seller.email,
    });
  } catch (error) {
    const errMsg = error?.message || String(error);
    secureLog.error('Failed to send resend OTP email', {
      userId: sellerIdStr,
      error: errMsg,
      ...(errMsg.includes('domain is not verified') && {
        hint: 'Verify the sending domain at https://resend.com/domains (e.g. saiisai.com)',
      }),
    });
  }

  // SECURITY FIX #1 & #3: NEVER include OTP in response, always return generic message
  res.status(200).json(genericResponse);
});

/**
 * POST /seller/send-verification-email
 * Send verification OTP for email (for existing sellers)
 */
exports.sendEmailVerificationOtp = catchAsync(async (req, res, next) => {
  // Seller is already authenticated via protect middleware
  const seller = await Seller.findById(req.user.id);

  if (!seller) {
    return next(new AppError('No seller found', 404));
  }

  // Check if account is locked
  if (seller.otpLockedUntil && new Date(seller.otpLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(seller.otpLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    return next(
      new AppError(
        `Account locked. Please try again in ${minutesRemaining} minute(s).`,
        429
      )
    );
  }

  // If already verified, return success
  if (seller.verification?.emailVerified) {
    return res.status(200).json({
      status: 'success',
      message: 'Email is already verified',
    });
  }

  // Generate new OTP (clears old one and resets attempts)
  const otp = generateOtp(seller, OTP_TYPES.SIGNUP);
  await seller.save({ validateBeforeSave: false });

  // SECURITY FIX #2: Secure logging (masks sensitive data, never logs OTP)
  const { secureLog, logOtpGeneration } = require('../../utils/helpers/secureLogger');
  logOtpGeneration(seller._id, seller.email, 'emailVerification');
  secureLog.debug('Email verification OTP generated', {
    userId: seller._id,
    email: seller.email,
    // OTP value is NEVER logged, even in development
  });

  // Send OTP via email
  try {
    await sendLoginOtpEmail(seller.email, otp, seller.name || seller.shopName);
    secureLog.debug('Email verification OTP sent', {
      userId: seller._id,
      email: seller.email,
    });
  } catch (error) {
    secureLog.error('Failed to send email verification OTP', {
      userId: seller._id,
      error: error.message,
    });
    // Don't fail the request if email fails, OTP is still generated
  }

  // SECURITY FIX #1: NEVER include OTP in API response, even in development
  res.status(200).json({
    status: 'success',
    message: 'Verification code sent to your email!',
    // OTP is NEVER included in response (security best practice)
  });
});

/**
 * ==================================================
 * UNIFIED EMAIL-ONLY PASSWORD RESET FLOW (SELLER)
 * ==================================================
 * 
 * STEP 1: Request Password Reset (Email Only)
 * POST /api/v1/seller/forgot-password
 * Body: { email: "seller@example.com" }
 * 
 * STEP 2: Reset Password with Token
 * POST /api/v1/seller/reset-password
 * Body: { token: "reset_token", newPassword: "newpass123", confirmPassword: "newpass123" }
 */

/**
 * Request Password Reset (Email Only) - Seller
 * - Accepts email address
 * - Silently handles (no account enumeration)
 * - Generates secure reset token
 * - Sends reset link via email
 * - Rate limited (prevents multiple requests if token still valid)
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

  // Find seller by email (silently - don't reveal if seller exists)
  const seller = await Seller.findOne({ email: normalizedEmail }).select('+passwordResetToken +passwordResetExpires');

  // SECURITY: Always return success message (prevent account enumeration)
  // Even if seller doesn't exist, return the same message
  if (!seller) {
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Check rate limiting - if seller has a recent reset token that hasn't expired yet, don't send another
  if (seller.passwordResetExpires && seller.passwordResetExpires > Date.now()) {
    // Token still valid, don't send another email (rate limiting)
    // Still return success to prevent information leakage
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Generate reset token using seller model method
  const resetToken = seller.createPasswordResetToken();
  await seller.save({ validateBeforeSave: false });

  try {
    // Send password reset email
    await sendPasswordResetEmail(seller.email, resetToken, seller.name || 'Seller');
    
    console.log(`[Seller Password Reset] Reset email sent to ${seller.email}`);
  } catch (err) {
    // If email fails, clear the reset token
    seller.passwordResetToken = undefined;
    seller.passwordResetExpires = undefined;
    await seller.save({ validateBeforeSave: false });

    // Still return success to prevent information leakage
    console.error('[Seller Password Reset] Failed to send reset email:', err);
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
 * Reset Password with Token - Seller
 * - Validates reset token
 * - Ensures token is not expired or used
 * - Hashes password using bcrypt (12 rounds)
 * - Updates seller password
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

  // Find seller with valid reset token
  const seller = await Seller.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires +password');

  if (!seller) {
    return next(new AppError('Invalid or expired reset token', 400));
  }

  // Update seller password and clear reset fields
  seller.password = newPassword;
  seller.passwordConfirm = confirmPassword;
  seller.passwordResetToken = undefined;
  seller.passwordResetExpires = undefined;
  seller.passwordChangedAt = Date.now();

  await seller.save();

  // SECURITY: Invalidate all active sessions
  const DeviceSession = require('../../models/user/deviceSessionModel');
  const TokenBlacklist = require('../../models/user/tokenBlackListModal');
  await DeviceSession.deactivateAll(seller._id);
  await TokenBlacklist.invalidateAllSessions(seller._id);

  try {
    // Send confirmation email
    await sendEmail({
      to: seller.email,
      subject: 'Password Reset Successful',
      html: `
        <h2>Password Reset Successful</h2>
        <p>Your seller account password has been successfully reset.</p>
        <p>If you did not perform this action, please contact support immediately.</p>
        <p><strong>Security Notice:</strong> All active sessions have been invalidated. Please log in again.</p>
      `,
    });
  } catch (err) {
    // Don't fail the request if email fails
    console.error('[Seller Password Reset] Failed to send confirmation email:', err);
  }

  // Log seller in with new password (create new session)
  try {
    await createSendToken(seller, 200, res, null, 'seller_jwt', req, 'eazseller');
  } catch (error) {
    // Fallback to old method if device session creation fails
    logger.error('[Seller Auth] Error creating device session on password reset:', error);
    createSendToken(seller, 200, res, null, 'seller_jwt');
  }
});

// Legacy endpoints (kept for backward compatibility)
/**
 * POST /seller/forgotPassword
 * @deprecated Use requestPasswordReset instead
 */
exports.forgotPassword = exports.requestPasswordReset;

/**
 * PATCH /seller/resetPassword/:token
 * @deprecated Use resetPasswordWithToken instead
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  // Legacy endpoint - extract token from URL params
  const token = req.params.token;
  const { password, passwordConfirm } = req.body;

  if (!token) {
    return next(new AppError('Reset token is required', 400));
  }

  if (!password || !passwordConfirm) {
    return next(new AppError('Please provide both password and confirmation', 400));
  }

  if (password !== passwordConfirm) {
    return next(new AppError('Passwords do not match', 400));
  }

  if (password.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Hash the token to compare with stored hash
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const seller = await Seller.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires +password');

  if (!seller) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  seller.password = password;
  seller.passwordConfirm = passwordConfirm;
  seller.passwordResetToken = undefined;
  seller.passwordResetExpires = undefined;
  seller.passwordChangedAt = Date.now();
  await seller.save();

  // Invalidate all sessions on password reset
  const DeviceSession = require('../../models/user/deviceSessionModel');
  await DeviceSession.deactivateAll(seller._id);
  await TokenBlacklist.invalidateAllSessions(seller._id);

  // Log seller in with new password
  try {
    await createSendToken(seller, 200, res, null, 'seller_jwt', req, 'eazseller');
  } catch (error) {
    console.error('[Seller Auth] Error creating device session on password reset:', error);
    createSendToken(seller, 200, res, null, 'seller_jwt');
  }
});

/**
 * POST /seller/logout
 * Logout seller and revoke device session
 */
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
    console.error('[Seller Auth] Error logging out device session:', error.message);
    // Continue with cookie clearing even if device session logout fails or times out
  }

  // Log activity if seller is authenticated (non-blocking)
  if (req.user) {
    try {
      logActivityAsync({
        userId: req.user._id || req.user.id,
        role: 'seller',
        action: 'LOGOUT',
        description: `Seller logged out`,
        req,
      });
    } catch (error) {
      console.error('[Seller Auth] Error logging activity:', error.message);
      // Don't block logout if activity logging fails
    }
  }

  // SECURITY: Clear JWT cookie using standardized helper
  // DO NOT reference Authorization header - cookie is the source of truth
  clearAuthCookie(res, 'seller');
  
  res.status(200).json({ 
    status: 'success', 
    message: 'Logged out successfully' 
  });
});

// ==================== TWO-FACTOR AUTHENTICATION ====================

/**
 * Enable Two-Factor Authentication
 * POST /api/v1/seller/enable-2fa
 * Generates a secret and QR code for 2FA setup
 */
exports.enableTwoFactor = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id);

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Generate a secret using speakeasy (properly base32 encoded)
  const secretData = speakeasy.generateSecret({
    name: `Saiisai Seller (${seller.email || seller.phone?.toString() || 'Seller'})`,
    issuer: 'Saiisai',
    length: 32,
  });

  // Get base32 secret (this is what we store and use)
  const base32Secret = secretData.base32;
  
  // Store temporary secret (will be moved to twoFactorSecret after verification)
  // IMPORTANT: Do NOT set twoFactorEnabled = true here (only after verification)
  seller.twoFactorTempSecret = base32Secret;
  // Ensure twoFactorEnabled remains false until verification
  seller.twoFactorEnabled = false;
  await seller.save({ validateBeforeSave: false });

  // Generate backup codes (10 codes, 8 characters each)
  const backupCodes = [];
  for (let i = 0; i < 10; i++) {
    backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  seller.twoFactorBackupCodes = backupCodes;
  await seller.save({ validateBeforeSave: false });

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
      // Nested structure for web compatibility
      twoFactor: {
        otpAuthUrl,
        base32: base32SecretMasked, // Masked secret for display (last 4 chars visible)
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
 * GET /api/v1/seller/2fa/setup
 * Returns setup data if seller hasn't completed 2FA setup yet
 */
exports.getTwoFactorSetup = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id).select('+twoFactorTempSecret +twoFactorBackupCodes');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  if (seller.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is already enabled', 400));
  }

  if (!seller.twoFactorTempSecret) {
    return next(new AppError('No setup in progress. Please enable 2FA first.', 400));
  }

  // Generate otpauth URL from the stored base32 secret
  const serviceName = 'Saiisai';
  const accountName = seller.email || seller.phone?.toString() || 'Seller';
  const otpAuthUrl = speakeasy.otpauthURL({
    secret: seller.twoFactorTempSecret,
    label: accountName,
    issuer: serviceName,
    encoding: 'base32',
  });

  // Mask secret for response
  const base32SecretMasked = seller.twoFactorTempSecret.length > 4 
    ? `${'*'.repeat(seller.twoFactorTempSecret.length - 4)}${seller.twoFactorTempSecret.slice(-4)}`
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
      backupCodes: seller.twoFactorBackupCodes || [],
    },
  });
});

/**
 * Verify Two-Factor Authentication Code
 * POST /api/v1/seller/verify-2fa
 * Verifies the code from authenticator app and completes 2FA setup
 */
exports.verifyTwoFactor = catchAsync(async (req, res, next) => {
  const { code } = req.body;

  if (!code || code.length !== 6) {
    return next(new AppError('Please provide a valid 6-digit verification code', 400));
  }

  const seller = await Seller.findById(req.user.id).select('+twoFactorTempSecret');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  if (!seller.twoFactorTempSecret) {
    return next(new AppError('No 2FA setup in progress. Please enable 2FA first.', 400));
  }

  // Verify TOTP using speakeasy (proper implementation)
  const verified = speakeasy.totp.verify({
    secret: seller.twoFactorTempSecret,
    encoding: 'base32',
    token: code,
    window: 2, // Allow ±1 time step (60 seconds total window)
  });

  if (!verified) {
    return next(new AppError('Invalid verification code. Please try again.', 401));
  }

  // Move temp secret to permanent secret and enable 2FA
  seller.twoFactorSecret = seller.twoFactorTempSecret;
  seller.twoFactorTempSecret = undefined;
  seller.twoFactorEnabled = true;
  await seller.save({ validateBeforeSave: false });

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
 * POST /api/v1/seller/disable-2fa
 * Disables 2FA for the seller
 */
exports.disableTwoFactor = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id);

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  if (!seller.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is not enabled', 400));
  }

  // Clear 2FA data
  seller.twoFactorEnabled = false;
  seller.twoFactorSecret = undefined;
  seller.twoFactorTempSecret = undefined;
  seller.twoFactorBackupCodes = [];
  await seller.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Two-factor authentication has been disabled',
    data: {
      is2FAEnabled: false,
      twoFactorEnabled: false,
    },
  });
});

/**
 * Get Backup Codes
 * GET /api/v1/seller/2fa/backup-codes
 * Returns backup codes for 2FA (only if 2FA is enabled)
 */
exports.getBackupCodes = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id).select('+twoFactorBackupCodes');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  if (!seller.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is not enabled', 400));
  }

  res.status(200).json({
    status: 'success',
    data: {
      backupCodes: seller.twoFactorBackupCodes || [],
    },
  });
});

/**
 * Regenerate Backup Codes
 * POST /api/v1/seller/2fa/regenerate-backup-codes
 * Generates new backup codes (invalidates old ones)
 */
exports.regenerateBackupCodes = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id).select('+twoFactorBackupCodes');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  if (!seller.twoFactorEnabled) {
    return next(new AppError('Two-factor authentication is not enabled', 400));
  }

  // Generate new backup codes (10 codes, 8 characters each)
  const backupCodes = [];
  for (let i = 0; i < 10; i++) {
    backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  seller.twoFactorBackupCodes = backupCodes;
  await seller.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Backup codes regenerated successfully',
    data: {
      backupCodes,
    },
  });
});

// ==================== PASSWORD MANAGEMENT ====================

/**
 * Update Password
 * PATCH /api/v1/seller/me/update-password
 * Change seller password (requires current password)
 */
exports.updatePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword, passwordConfirm } = req.body;

  if (!currentPassword || !newPassword || !passwordConfirm) {
    return next(new AppError('Please provide current password, new password, and password confirmation', 400));
  }

  if (newPassword !== passwordConfirm) {
    return next(new AppError('New password and password confirmation do not match', 400));
  }

  if (newPassword.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Get seller with password field
  const seller = await Seller.findById(req.user.id).select('+password');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Verify current password
  const isCurrentPasswordValid = await seller.correctPassword(currentPassword, seller.password);
  if (!isCurrentPasswordValid) {
    return next(new AppError('Current password is incorrect', 401));
  }

  // Update password
  seller.password = newPassword;
  seller.passwordChangedAt = Date.now();
  await seller.save();

  // Log activity
  logActivityAsync({
    userId: seller._id,
    role: 'seller',
    action: 'PASSWORD_CHANGED',
    description: 'Seller changed password',
    req,
  });

  res.status(200).json({
    status: 'success',
    message: 'Password updated successfully',
  });
});

// ==================== SESSION MANAGEMENT ====================

/**
 * Get Active Sessions
 * GET /api/v1/seller/me/sessions
 * List all active device sessions for the seller
 */
exports.getSessions = catchAsync(async (req, res, next) => {
  const DeviceSession = require('../../models/user/deviceSessionModel');
  const { parseUserAgent } = require('../../utils/helpers/deviceUtils');
  
  const userId = req.user._id || req.user.id;
  const currentDeviceId = req.user.deviceId;

  // Get all active sessions for this seller
  const sessions = await DeviceSession.find({
    userId,
    isActive: true,
  }).sort({ lastActivity: -1 });

  const devices = sessions.map((session) => {
    const uaInfo = parseUserAgent(session.userAgent || '');
    return {
      sessionId: session._id,
      deviceId: session.deviceId,
      deviceType: session.deviceType || 'unknown',
      browser: uaInfo.browser || 'Unknown',
      os: uaInfo.os || 'Unknown',
      device: uaInfo.device || 'Unknown',
      ipAddress: session.ipAddress || 'Unknown',
      location: session.location || 'Unknown',
      loginTime: session.loginTime,
      lastActivity: session.lastActivity,
      isActive: session.isActive,
      isCurrentDevice: session.deviceId === currentDeviceId,
      platform: session.platform || 'unknown',
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      sessions: devices,
      count: devices.length,
    },
  });
});

/**
 * Revoke Session
 * DELETE /api/v1/seller/me/sessions/:sessionId
 * Revoke a specific device session
 */
exports.revokeSession = catchAsync(async (req, res, next) => {
  const DeviceSession = require('../../models/user/deviceSessionModel');
  const { sessionId } = req.params;
  const userId = req.user._id || req.user.id;

  if (!sessionId) {
    return next(new AppError('Session ID is required', 400));
  }

  const session = await DeviceSession.findOne({
    _id: sessionId,
    userId,
  });

  if (!session) {
    return next(new AppError('Session not found', 404));
  }

  // Deactivate session
  session.isActive = false;
  await session.save();

  // Log activity
  logActivityAsync({
    userId,
    role: 'seller',
    action: 'SESSION_REVOKED',
    description: `Seller revoked session: ${session.deviceId}`,
    req,
  });

  res.status(200).json({
    status: 'success',
    message: 'Session revoked successfully',
  });
});

/**
 * Revoke All Other Sessions
 * DELETE /api/v1/seller/me/sessions
 * Revoke all sessions except the current one
 */
exports.revokeAllOtherSessions = catchAsync(async (req, res, next) => {
  const DeviceSession = require('../../models/user/deviceSessionModel');
  const { logoutOtherDevices } = require('../../utils/helpers/createDeviceSession');
  
  const userId = req.user._id || req.user.id;
  const currentDeviceId = req.user.deviceId;

  if (!currentDeviceId) {
    return next(new AppError('Current device ID not found', 400));
  }

  // Use existing helper function
  const count = await logoutOtherDevices(req);

  // Log activity
  logActivityAsync({
    userId,
    role: 'seller',
    action: 'ALL_OTHER_SESSIONS_REVOKED',
    description: `Seller revoked ${count} other session(s)`,
    req,
  });

  res.status(200).json({
    status: 'success',
    message: `Revoked ${count} other session(s)`,
    data: {
      revokedCount: count,
    },
  });
});

// ==================== NOTIFICATION PREFERENCES ====================

/**
 * Get Notification Settings
 * GET /api/v1/seller/me/notification-settings
 * Get seller notification preferences
 */
exports.getNotificationSettings = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id);

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Return notification settings with defaults if not set
  const settings = seller.notificationSettings || {
    email: {
      orderUpdates: true,
      paymentNotifications: true,
      productAlerts: true,
      accountSecurity: true,
      marketingEmails: false,
    },
    push: {
      orderUpdates: true,
      newMessages: true,
      systemAlerts: true,
    },
    sms: {
      criticalAlerts: true,
      securityNotifications: true,
    },
  };

  res.status(200).json({
    status: 'success',
    data: {
      settings,
    },
  });
});

/**
 * Update Notification Settings
 * PATCH /api/v1/seller/me/notification-settings
 * Update seller notification preferences
 */
exports.updateNotificationSettings = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id);

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const { settings } = req.body;

  if (!settings) {
    return next(new AppError('Notification settings are required', 400));
  }

  // Merge with existing settings (partial update)
  if (!seller.notificationSettings) {
    seller.notificationSettings = {
      email: {
        orderUpdates: true,
        paymentNotifications: true,
        productAlerts: true,
        accountSecurity: true,
        marketingEmails: false,
      },
      push: {
        orderUpdates: true,
        newMessages: true,
        systemAlerts: true,
      },
      sms: {
        criticalAlerts: true,
        securityNotifications: true,
      },
    };
  }

  // Update email settings
  if (settings.email) {
    seller.notificationSettings.email = {
      ...seller.notificationSettings.email,
      ...settings.email,
    };
  }

  // Update push settings
  if (settings.push) {
    seller.notificationSettings.push = {
      ...seller.notificationSettings.push,
      ...settings.push,
    };
  }

  // Update SMS settings
  if (settings.sms) {
    seller.notificationSettings.sms = {
      ...seller.notificationSettings.sms,
      ...settings.sms,
    };
  }

  await seller.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Notification settings updated successfully',
    data: {
      settings: seller.notificationSettings,
    },
  });
});

/**
 * Seller Authentication Middleware
 * Protects seller routes using seller_jwt cookie
 * 
 * This is SEPARATE from buyer/authController.protect to ensure
 * seller routes NEVER go through buyer authentication logic.
 * 
 * @route   All /api/v1/seller/* routes
 * @cookie  seller_jwt (HTTP-only cookie)
 */
exports.protectSeller = catchAsync(async (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();
  
  // 🛡️ HARD SAFETY GUARD: Prevent buyer routes from using seller auth
  if (fullPath.startsWith('/api/v1/users') || fullPath.startsWith('/api/v1/buyer') || fullPath.startsWith('/users') || fullPath.startsWith('/buyer')) {
    console.error('═══════════════════════════════════════════════════════════');
    console.error('[AUTH TRACE] ❌ CRITICAL ERROR: BUYER route passed to SELLER auth middleware');
    console.error('[AUTH TRACE] Route:', method, fullPath);
    console.error('[AUTH TRACE] This is a CONFIGURATION ERROR');
    console.error('═══════════════════════════════════════════════════════════');
    return next(new AppError('Configuration error: Buyer route using seller auth', 500));
  }
  
  // 🔍 AUTH TRACE LOGGING
  console.log('[AUTH TRACE]', {
    path: fullPath,
    method: method,
    middleware: 'protectSeller (seller/authSellerController.js)',
    cookies: req.cookies ? Object.keys(req.cookies) : 'none',
    hasSellerJwt: req.cookies?.seller_jwt ? 'YES' : 'NO',
    hasMainJwt: req.cookies?.main_jwt ? 'YES' : 'NO',
    timestamp: new Date().toISOString(),
  });
  
  // Extract token from seller_jwt cookie ONLY
  let token = null;
  if (req.cookies && req.cookies.seller_jwt) {
    token = req.cookies.seller_jwt;
    console.log(`[protectSeller] ✅ Token found in seller_jwt cookie for ${method} ${fullPath}`);
  }
  
  if (!token) {
    console.error('═══════════════════════════════════════════════════════════');
    console.error(`[protectSeller] ❌ CRITICAL: No seller_jwt token found for seller route`);
    console.error(`[protectSeller] Route: ${method} ${fullPath}`);
    console.error(`[protectSeller] Expected cookie: seller_jwt`);
    console.error(`[protectSeller] Available cookies:`, req.cookies ? Object.keys(req.cookies).join(', ') : 'none');
    console.error('═══════════════════════════════════════════════════════════');
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401),
    );
  }
  
  // Check token blacklist
  const isBlacklisted = await TokenBlacklist.isBlacklisted(token);
  if (isBlacklisted) {
    return next(
      new AppError('Your session has expired. Please log in again.', 401),
    );
  }
  
  // Verify token
  const { verifyToken } = require('../../utils/helpers/routeUtils');
  const { decoded, error } = await verifyToken(token, fullPath);
  
  if (error || !decoded) {
    console.error('[protectSeller] Token verification failed:', error?.message || 'Invalid token');
    return next(new AppError('Session expired', 401));
  }
  
  // Find seller user
  const { findUserByToken } = require('../../utils/helpers/routeUtils');
  const currentUser = await findUserByToken(decoded);
  if (!currentUser) {
    // Clear invalid seller_jwt cookie so frontend stops sending a broken session
    try {
      const { clearAuthCookie } = require('../../utils/helpers/authHelpers');
      clearAuthCookie(res, 'seller');
    } catch (e) {
      console.error('[protectSeller] Error clearing invalid seller cookie:', e.message);
    }

    return next(
      new AppError('Your session is no longer valid. Please log in again.', 401),
    );
  }
  
  // CRITICAL: Verify user is actually a seller
  if (currentUser.role !== 'seller') {
    console.error(`[protectSeller] ❌ SECURITY: Non-seller user detected in seller route:`, {
      userId: currentUser.id,
      role: currentUser.role,
      email: currentUser.email || currentUser.phone,
      route: fullPath,
    });
    return next(
      new AppError(`You do not have permission to perform this action. Required role: seller, Your role: ${currentUser.role}`, 403)
    );
  }
  
  // Check password change timestamp
  if (currentUser.changedPasswordAfter && currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again', 401),
    );
  }
  
  // Attach seller to request
  req.user = currentUser;
  if (decoded.deviceId) {
    req.user.deviceId = decoded.deviceId;
  }
  
  console.log(`[protectSeller] ✅ Authentication successful for seller:`, {
    userId: currentUser.id,
    email: currentUser.email || currentUser.phone,
    route: fullPath,
  });
  
  next();
});
