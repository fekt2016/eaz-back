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
const { sendCustomEmail, sendLoginEmail, sendLoginOtpEmail } = require('../../utils/email/emailService');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const { validateGhanaPhone } = require('../../utils/helpers/helper');
const bcrypt = require('bcryptjs');
const sanitizePath = require('../../utils/helpers/sanitizePath');
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

// Initialize route cache (5 minutes TTL)

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
];

// Controller methods ===========================================================

// Controllers/authController.js (signup part)
exports.signup = catchAsync(async (req, res, next) => {
  // Phone validation
  if (req.body.phone && !validateGhanaPhone(req.body.phone)) {
    return next(new AppError('Please provide a valid Ghana phone number', 400));
  }

  // Email validation
  if (req.body.email && !validator.isEmail(req.body.email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // Require either email or phone
  if (!req.body.email && !req.body.phone) {
    return next(
      new AppError('Please provide either email or phone number', 400),
    );
  }

  if (!req.body.password || !req.body.passwordConfirm) {
    return next(
      new AppError(
        'Please provide both password and password confirmation',
        400,
      ),
    );
  }

  try {
    const newUser = await User.create({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone ? req.body.phone.replace(/\D/g, '') : undefined,
      password: req.body.password,
      passwordConfirm: req.body.passwordConfirm,
      passwordChangedAt: req.body.passwordChangedAt,
      emailVerified: false, // Always false on signup - requires OTP verification
      phoneVerified: false,
    });

    // Generate OTP for email verification
    const { sendLoginOtpEmail } = require('../../utils/email/emailService');
    const otp = newUser.createOtp();
    await newUser.save({ validateBeforeSave: false });

    // Log OTP to console for development
    console.log('========================================');
    console.log(`[Buyer Signup] 🔐 OTP PIN: ${otp}`);
    console.log(`[Buyer Signup] User: ${newUser.email || newUser.phone}`);
    console.log(`[Buyer Signup] OTP expires in 10 minutes`);
    console.log('========================================');

    // Send OTP via email
    try {
      await sendLoginOtpEmail(newUser.email, otp, newUser.name);
      console.log(`[Buyer Signup] OTP sent to ${newUser.email}`);
    } catch (emailError) {
      console.error('[Buyer Signup] Failed to send OTP email:', emailError.message);
      // Don't fail signup if email fails - OTP is still generated
    }

    // If phone is provided, also send SMS OTP
    if (newUser.phone) {
      try {
        const { sendSMS } = require('../../utils/email/emailService');
        await sendSMS({
          to: newUser.phone,
          message: `Your EazShop verification code is: ${otp}. Valid for 10 minutes.`,
        });
        console.log(`[Buyer Signup] OTP sent to phone ${newUser.phone}`);
      } catch (smsError) {
        console.error('[Buyer Signup] Failed to send SMS:', smsError.message);
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
    // If email fails, delete unverified user
    if (err.code === 11000) {
      return next(
        new AppError(
          'This email or phone is already registered. Please log in.',
          400,
        ),
      );
    }

    await User.findOneAndDelete({ email: req.body.email });
    console.error('Signup Error:', err);

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
  console.log('otp', otp);

  // Send OTP via email using SendGrid
  if (validator.isEmail(loginId)) {
    try {
      await sendLoginOtpEmail(user.email, otp, user.name);
      console.log(`[Auth] Login OTP email sent to ${user.email}`);
    } catch (error) {
      console.error('[Auth] Failed to send login OTP email:', error.message);
      // Don't fail the request if email fails, OTP is still generated
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'OTP sent to your email or phone!',
    otp, // Remove in production - only for development
  });
});

exports.verifyOtp = catchAsync(async (req, res, next) => {
  console.log('req.body', req.body);
  try {
    const { loginId, otp, password, redirectTo } = req.body;
 

    if (!loginId || !otp || !password) {
      return next(
        new AppError('Please provide loginId, OTP, and password', 400),
      );
    }

    let user;
    const query = User.findOne();
    console.log('query', query);


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
    console.log('user', user);

    if (!user) {
      console.log('[verifyOtp] User not found for:', loginId);
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
    
    console.log('[verifyOtp] User found:', { 
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
    console.log('[verifyOtp] Password verification result:', passwordValid);
    
    if (!passwordValid) {
      console.log('[verifyOtp] Password validation failed');
      return next(new AppError('Incorrect password', 401));
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
    await user.save({ validateBeforeSave: false });
    console.log('2', user);

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
      console.warn(`[User Login] CRITICAL RISK detected for user ${user.email || user.phone}. Login allowed but logged.`);
    }

    // Send login notification email using SendGrid
    if (user.email) {
      try {
        const loginInfo = {
          ip: ipAddress,
          device: userAgent,
          location: location || 'Unknown location',
        };
        await sendLoginEmail(user.email, user.name, loginInfo);
        console.log(`[Auth] Login notification email sent to ${user.email}`);
      } catch (error) {
        console.error('[Auth] Failed to send login notification email:', error.message);
        // Don't fail the login if email fails
      }
    }

    // Sanitize redirect path
    const sanitizedRedirectTo = sanitizePath(redirectTo, '/');
    console.log(`[Auth] Redirect path: ${redirectTo} -> ${sanitizedRedirectTo}`);

    // Create device session and generate tokens
    const { createDeviceSession } = require('../../utils/helpers/createDeviceSession');
    let sessionData;
    try {
      console.log('[Auth] Creating device session for user:', user._id);
      sessionData = await createDeviceSession(req, user, 'eazmain');
      console.log('[Auth] Device session created successfully:', sessionData.deviceId);
    } catch (deviceError) {
      // If device limit exceeded, return error (only in production)
      if (process.env.NODE_ENV === 'production' && deviceError.message && deviceError.message.includes('Too many devices')) {
        return next(new AppError(deviceError.message, 403));
      }
      // For other errors, log full error details and continue without device session (fallback)
      console.error('[Auth] ❌ Error creating device session:', deviceError.message || deviceError);
      console.error('[Auth] Error stack:', deviceError.stack);
      console.error('[Auth] Full error object:', JSON.stringify(deviceError, Object.getOwnPropertyNames(deviceError)));
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

    res.cookie('eazmain_jwt', token, cookieOptions);
    console.log(`[Auth] JWT cookie set (eazmain_jwt): httpOnly=true, secure=${cookieOptions.secure}, sameSite=${cookieOptions.sameSite}, path=${cookieOptions.path}`);

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

    // Return JSON with token, deviceId, refreshToken and redirectTo
    const response = {
      status: 'success',
      message: 'OTP verified',
      token,
      user: safeUserPayload,
      redirectTo: sanitizedRedirectTo,
    };

    // Add device session info if created
    if (sessionData) {
      response.deviceId = sessionData.deviceId;
      response.refreshToken = sessionData.refreshToken;
      if (sessionData.suspicious) {
        response.warning = 'New device detected. Please verify this is you.';
      }
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Verify OTP error:', error);
  }
});

exports.logout = catchAsync(async (req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
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
    console.error('[Auth] Error logging out device session:', error.message);
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
      console.error('[Auth] Error logging activity:', error.message);
      // Don't block logout if activity logging fails
    }
  }
  
  // Clear JWT cookie with same settings as creation
  res.cookie('eazmain_jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000), // Expire immediately (10 seconds)
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  });
  res.status(200).json({ status: 'success' });
});
//protect auth
exports.protect = catchAsync(async (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();

  // Check public routes with caching
  if (isPublicRoute(fullPath, method)) {
    console.log(`Allowing ${method} access to ${fullPath} (public route)`);
    return next();
  }
  // Extract token from Authorization header or cookie
  // Priority: 1) Authorization header, 2) Cookie
  let token = extractToken(req.headers.authorization);
  
  // Fallback to cookie if Authorization header is missing
  // Check for app-specific cookie based on route path
  // IMPORTANT: Each app (eazmain, eazseller, eazadmin) uses its own cookie
  // Note: /api/v1/paymentrequest is used by sellers, so it should use eazseller_jwt
  const cookieName = fullPath.startsWith('/api/v1/seller') ? 'eazseller_jwt' :
                     fullPath.startsWith('/api/v1/admin') ? 'eazadmin_jwt' :
                     fullPath.startsWith('/api/v1/paymentrequest') ? 'eazseller_jwt' : // Payment requests are seller routes
                     'eazmain_jwt'; // Default to buyer/eazmain
  
  // Security: For seller routes, ONLY accept eazseller_jwt, never eazmain_jwt
  if (fullPath.startsWith('/api/v1/seller') || fullPath.startsWith('/api/v1/paymentrequest')) {
    // Explicitly check for eazseller_jwt only
    if (req.cookies && req.cookies.eazmain_jwt) {
      console.warn(`[Auth] ⚠️ SECURITY: Seller route detected eazmain_jwt cookie - ignoring it. Route: ${fullPath}`);
      // Don't use eazmain_jwt for seller routes - this prevents cross-app authentication
    }
  }
  
  if (!token) {
    if (req.cookies && req.cookies[cookieName]) {
      token = req.cookies[cookieName];
      console.log(`[Auth] ✅ Token found in cookie (${cookieName}) for ${method} ${fullPath}`);
    } else {
      // Debug: Log cookie information
      console.log(`[Auth] ❌ No token found for protected route: ${method} ${fullPath}`);
      console.log(`[Auth] Authorization header: ${req.headers.authorization ? 'present' : 'missing'}`);
      console.log(`[Auth] Cookies object:`, req.cookies ? Object.keys(req.cookies) : 'undefined');
      console.log(`[Auth] Cookie ${cookieName}: ${req.cookies?.[cookieName] ? 'present' : 'missing'}`);
      // Log all cookies for debugging (but don't log values for security)
      console.log(`[Auth] Available cookie names:`, req.cookies ? Object.keys(req.cookies) : 'none');
      return next(
        new AppError('You are not logged in! Please log in to get access.', 401),
      );
    }
  } else {
    console.log(`[Auth] ✅ Token found in Authorization header for ${method} ${fullPath}`);
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
    console.error(
      'Token verification failed:',
      error?.message || 'Invalid token',
    );
    return next(new AppError('Session expired', 401));
  }

  // Find user
  const currentUser = await findUserByToken(decoded);
  if (!currentUser) {
    return next(
      new AppError('The user belonging to this token no longer exists', 401),
    );
  }

  // Check password change timestamp
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again', 401),
    );
  }

  // Attach user to request with deviceId from token
  req.user = currentUser;
  if (decoded.deviceId) {
    req.user.deviceId = decoded.deviceId;
  }
  console.log(
    `Authenticated as ${currentUser.role}: ${currentUser.email || currentUser.phone}`,
  );
  next();
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // Ensure req.user exists
    if (!req.user) {
      console.error(`[restrictTo] ❌ No user found in request. Path: ${req.path}, Method: ${req.method}`);
      return next(
        new AppError('You are not authenticated. Please log in to get access.', 401),
      );
    }
    
    // Get role from user object, fallback to 'user' if not set
    const userRole = req.user.role || 'user';
    
    console.log(`[restrictTo] Checking permissions - User role: ${userRole}, Required roles:`, roles, `Path: ${req.path}`);
    
    if (!roles.includes(userRole)) {
      console.error(`[restrictTo] ❌ Permission denied - User role: ${userRole}, Required: ${roles.join(' or ')}, Path: ${req.path}, User ID: ${req.user.id}`);
      return next(
        new AppError(`You do not have permission to perform this action. Required role: ${roles.join(' or ')}, Your role: ${userRole}`, 403),
      );
    }
    
    console.log(`[restrictTo] ✅ Permission granted - User role: ${userRole} matches required roles`);
    next();
  };
};

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

    // Check if user exists
    const user = await User.findOne(query);
    // console.log('user', user);
    if (!user)
      return next(new AppError('User not found, check your credential', 403));

    // Generate OTP (6-digit code)
    const otp = crypto.randomInt(100000, 999999).toString();
    console.log('otp', otp);

    // Set OTP and expiration (10 minutes)
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000;
    user.otpType = 'passwordReset'; // Differentiate from login OTP

    await user.save();

    // Send OTP via email or SMS using SendGrid
    if (isEmail) {
      await sendLoginOtpEmail(user.email, otp, user.name);
      console.log(`[Auth] Password reset OTP email sent to ${user.email}`);
    } else {
      await sendSMS({
        to: user.phone,
        message: `Your password reset code is: ${otp}. It will expire in 10 minutes.`,
      });
    }

    res.status(200).json({
      message: 'If the account exists, a reset code has been sent.',
      method: isEmail ? 'email' : 'phone',
    });
  } catch (error) {
    console.error('Password reset initiation error:', error);
    res
      .status(500)
      .json({ error: 'Failed to initiate password reset. Please try again.' });
  }
});
exports.verifyResetOtp = catchAsync(async (req, res, next) => {
  try {
    const { loginId, otp } = req.body;

    //   // Validate input
    if (!loginId || !otp)
      return next(new AppError('Please provide loginId and OTP', 400));

    //   // Determine if loginId is email or phone
    const isEmail = loginId.includes('@');
    const query = isEmail ? { email: loginId } : { phone: loginId };
    // Find user with valid OTP
    const user = await User.findOne({
      ...query,
      otpType: 'passwordReset',
      otpExpires: { $gt: Date.now() }, // Check if OTP is not expired
    }).select('+otp +otpExpires');

    if (!user)
      return next(new AppError('User not found, check your credential', 403));
    const isValidOtp = user.verifyOtp(otp);
    if (!isValidOtp) {
      return next(new AppError('Invalid or expired OTP', 400));
    }

    user.otpVerified = true;
    //   // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    // Save reset token to user document
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    res.status(200).json({
      message: 'OTP verified successfully',
      resetToken,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
  }
});
// Reset password
exports.resetPassword = catchAsync(async (req, res, next) => {
  try {
    const { loginId, newPassword, resetToken } = req.body;

    console.log('reset', loginId, newPassword, resetToken);

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

    // Build search criteria
    const searchCriteria = { ...query, otpType: 'passwordReset' };

    // If resetToken is provided, add it to search criteria
    if (resetToken) {
      console.log('with token');
      searchCriteria.resetToken = resetToken;
      searchCriteria.resetTokenExpires = { $gt: Date.now() };
    } else {
      // If no resetToken, require OTP to be verified
      searchCriteria.otpVerified = true;
      searchCriteria.otpExpires = { $gt: Date.now() };
    }
    console.log('resetToken', resetToken, searchCriteria);
    // Find user with valid reset credentials
    const user = await User.findOne({ email: loginId }).select(
      '+otp +otpExpires +otpVerified +resetToken +resetTokenExpires +password',
    );

    if (!user) {
      return next(new AppError('Invalid or expired reset credentials', 400));
    }
    if (!user.otpVerified) {
      return next(new AppError('OTP not verified', 400));
    }
    if (user.otpExpires < Date.now()) {
      return next(new AppError('OTP expired, please request a new one', 400));
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password and clear reset fields
    user.password = hashedPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpType = undefined;
    user.otpVerified = undefined;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;

    await user.save();

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
    console.error('Password reset error:', error);
    res
      .status(500)
      .json({ error: 'Failed to reset password. Please try again.' });
  }
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }

  user.password = req.body.newPassword;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  createSendToken(user, 200, res, null, 'eazmain_jwt');
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

  // Log OTP to console for development
  console.log('========================================');
  console.log(`[Resend OTP] 🔐 OTP PIN: ${otp}`);
  console.log(`[Resend OTP] User: ${user.email || user.phone}`);
  console.log(`[Resend OTP] OTP expires in 10 minutes`);
  console.log('========================================');

  // Send OTP via email
  if (user.email) {
    try {
      await sendLoginOtpEmail(user.email, otp, user.name);
      console.log(`[Resend OTP] OTP sent to ${user.email}`);
    } catch (error) {
      console.error('[Resend OTP] Failed to send email:', error.message);
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
      console.log(`[Resend OTP] OTP sent to phone ${user.phone}`);
    } catch (error) {
      console.error('[Resend OTP] Failed to send SMS:', error.message);
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Verification code sent to your email or phone!',
    otp: process.env.NODE_ENV !== 'production' ? otp : undefined, // Only in dev
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

  let user;
  if (email && validator.isEmail(email)) {
    user = await User.findOne({ email }).select('+otp +otpExpires +otpAttempts +otpLockedUntil');
  } else if (phone) {
    user = await User.findOne({ phone: phone.replace(/\D/g, '') })
      .select('+otp +otpExpires +otpAttempts +otpLockedUntil');
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

  // Verify OTP
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
    let errorMessage = 'Invalid verification code.';
    
    if (otpResult.reason === 'expired') {
      errorMessage = `Verification code expired ${otpResult.minutesExpired || 0} minute(s) ago. Request a new one.`;
    } else if (otpResult.reason === 'no_otp') {
      errorMessage = 'No verification code found. Please request a new one.';
    } else if (otpResult.reason === 'mismatch') {
      errorMessage = `Wrong code. You have ${attemptsRemaining} attempt(s) remaining.`;
    } else {
      errorMessage = `Invalid code. You have ${attemptsRemaining} attempt(s) remaining.`;
    }
    
    return next(new AppError(errorMessage, 401));
  }

  // OTP is valid - mark as verified
  if (email && validator.isEmail(email)) {
    user.emailVerified = true;
  }
  if (phone) {
    user.phoneVerified = true;
  }
  
  // Clear OTP fields
  user.otp = undefined;
  user.otpExpires = undefined;
  user.otpAttempts = 0;
  user.otpLockedUntil = null;
  
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
    console.log(`[Email Verification] OTP sent to ${user.email}`);

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
