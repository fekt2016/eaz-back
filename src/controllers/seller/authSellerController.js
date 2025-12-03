const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const AppError = require('../../utils/errors/appError');
const sendEmail = require('../../utils/email/emailService');
const crypto = require('crypto');
const sellerCustomerModel = require('../../models/notification/chat/sellerCustomerModel');
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const SecurityLog = require('../../models/user/securityModal');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const { sendLoginOtpEmail } = require('../../utils/email/emailService');
const { logActivityAsync, logActivity } = require('../../modules/activityLog/activityLog.service');
const securityMonitor = require('../../services/securityMonitor');
const ActivityLog = require('../../models/activityLog/activityLogModel');

exports.signupSeller = catchAsync(async (req, res, next) => {
  // ✅ FIX: Remove auto-verification - require OTP verification
  // Set verification status to false (requires OTP verification)
  req.body.verification = {
    emailVerified: false, // ✅ Changed from true to false
    businessVerified: false,
  };
  
  // Ensure role is ALWAYS 'seller' (never 'user' or any other value)
  req.body.role = 'seller';
  
  const newSeller = await Seller.create(req.body);
  if (!newSeller) {
    return next(new AppError('check your cred and register again', 401));
  }
  
  // Double-check: Ensure role is ALWAYS 'seller' after creation
  if (!newSeller.role || newSeller.role !== 'seller') {
    console.log(`[Seller Auth] Correcting role from "${newSeller.role}" to "seller" for new seller: ${newSeller.email}`);
    newSeller.role = 'seller';
    await newSeller.save({ validateBeforeSave: false });
  }
  
  // ✅ Generate OTP for email verification
  const otp = newSeller.createOtp();
  await newSeller.save({ validateBeforeSave: false });
  
  // Send OTP via email
  try {
    await sendLoginOtpEmail(newSeller.email, otp, newSeller.name || newSeller.shopName);
    console.log(`[Seller Signup] OTP sent to ${newSeller.email}`);
  } catch (emailError) {
    console.error('[Seller Signup] Failed to send OTP email:', emailError.message);
    // Don't fail signup if email fails - OTP is still generated
  }
  
  await sellerCustomerModel.create({
    myId: newSeller.id,
  });

  // Log activity
  logActivityAsync({
    userId: newSeller._id,
    role: 'seller',
    action: 'SIGNUP',
    description: `New seller registered: ${newSeller.email}`,
    req,
  });

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

exports.loginSeller = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  //1) check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }
  const seller = await Seller.findOne({ email }).select('+password');

  //2) check if seller exist and password is correct
  if (!seller || !(await seller.correctPassword(password, seller.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  // ✅ CRITICAL: Check if email is verified before allowing login
  if (!seller.verification?.emailVerified) {
    return next(
      new AppError(
        'Email not verified. Please verify your email address to access your seller account.',
        401
      )
    );
  }

  // Ensure role is ALWAYS 'seller' (never 'user' or any other value)
  // This is critical for proper authorization
  if (!seller.role || seller.role !== 'seller') {
    console.log(`[Seller Auth] Correcting role from "${seller.role}" to "seller" for: ${seller.email}`);
    seller.role = 'seller';
  }

  // Capture IP and device
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Security monitoring
  const ipChange = await securityMonitor.detectIPChange(seller, ipAddress, 'seller');
  const deviceChange = await securityMonitor.detectDeviceChange(seller, userAgent, 'seller');
  const multipleIps = await securityMonitor.detectMultipleIps(seller, 'seller');
  const geoMismatch = await securityMonitor.detectGeoMismatch(seller, ipAddress, 'seller');
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
      userId: seller._id,
      userModel: 'Seller',
      role: 'seller',
      action: 'IP_CHANGE',
      description: `IP address changed from ${ipChange.previousIp} to ${ipChange.currentIp}`,
      activityType: 'IP_CHANGE',
      ipAddress: ipChange.currentIp,
      previousIp: ipChange.previousIp,
      userAgent,
      location,
      riskLevel: 'medium',
      platform: 'eazseller',
      metadata: {
        previousIp: ipChange.previousIp,
        currentIp: ipChange.currentIp,
      },
    });
  }

  // Log device change if detected
  if (deviceChange.changed) {
    await ActivityLog.create({
      userId: seller._id,
      userModel: 'Seller',
      role: 'seller',
      action: 'DEVICE_CHANGE',
      description: `Device changed from ${deviceChange.previousDevice?.substring(0, 50)} to ${deviceChange.currentDevice?.substring(0, 50)}`,
      activityType: 'DEVICE_CHANGE',
      ipAddress,
      userAgent: deviceChange.currentDevice,
      location,
      riskLevel: 'medium',
      platform: 'eazseller',
      metadata: {
        previousDevice: deviceChange.previousDevice,
        currentDevice: deviceChange.currentDevice,
      },
    });
  }

  seller.lastLogin = Date.now();
  
  // Save seller to persist lastLogin and role
  await seller.save({ validateBeforeSave: false });

  // Log login activity with security info
  const loginLog = await ActivityLog.create({
    userId: seller._id,
    userModel: 'Seller',
    role: 'seller',
    action: 'LOGIN',
    description: `Seller logged in via email/password`,
    activityType: 'LOGIN',
    ipAddress,
    previousIp: ipChange.previousIp || null,
    userAgent,
    location,
    riskLevel,
    platform: 'eazseller',
    metadata: {
      ipChanged: ipChange.changed,
      deviceChanged: deviceChange.changed,
      multipleIps: multipleIps.multipleIps,
      ipCount: multipleIps.ipCount,
    },
  });

  // Trigger security alert if risk is high or critical
  if (riskLevel === 'high' || riskLevel === 'critical') {
    await securityMonitor.triggerSecurityAlert(seller, loginLog, 'seller');
  }

  // Check if critical risk requires force logout
  if (riskLevel === 'critical') {
    console.warn(`[Seller Login] CRITICAL RISK detected for seller ${seller.email}. Login allowed but logged.`);
  }

  createSendToken(seller, 200, res, null, 'eazseller_jwt');
});

exports.sendOtp = catchAsync(async (req, res, next) => {
  const { loginId } = req.body;

  if (!loginId) {
    return next(new AppError('Please provide email or phone number', 400));
  }

  let seller;

  if (validator.isEmail(loginId)) {
    seller = await Seller.findOne({ email: loginId });
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

  const otp = seller.createOtp();
  await seller.save({ validateBeforeSave: false });
  
  // Console log OTP for development/testing
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔐 [SELLER AUTH] OTP GENERATED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📧 Email: ${seller.email}`);
  console.log(`🏪 Shop: ${seller.shopName || seller.name}`);
  console.log(`🔑 OTP Code: ${otp}`);
  console.log(`⏰ Expires: ${new Date(seller.otpExpires).toLocaleString()}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Send OTP via email using SendGrid
  if (validator.isEmail(loginId)) {
    try {
      await sendLoginOtpEmail(seller.email, otp, seller.name || seller.shopName);
      console.log(`✅ [Seller Auth] Login OTP email sent to ${seller.email}`);
    } catch (error) {
      console.error('❌ [Seller Auth] Failed to send login OTP email:', error.message);
      // Don't fail the request if email fails, OTP is still generated
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'OTP sent to your email!',
    otp, // Remove in production - only for development
  });
});

exports.verifyOtp = catchAsync(async (req, res, next) => {
  try {
    const { loginId, otp, password, redirectTo } = req.body;
    console.log('[Seller Auth] Verifying OTP:', { loginId, otp: otp ? '***' : 'missing', password: password ? '***' : 'missing' });

    if (!loginId || !otp || !password) {
      return next(
        new AppError('Please provide loginId, OTP, and password', 400),
      );
    }

    let seller;
    const query = Seller.findOne();

    if (validator.isEmail(loginId)) {
      query.where({ email: loginId });
    } else {
      return next(
        new AppError('Please provide a valid email address', 400),
      );
    }

    query.select('+password +otp +otpExpires');
    seller = await query;

    if (!seller) {
      return next(
        new AppError('No seller found with that email address', 404),
      );
    }

    // Verify OTP
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 [SELLER AUTH] OTP VERIFICATION ATTEMPT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📧 Email: ${seller.email}`);
    console.log(`🔑 Provided OTP: ${otp}`);
    console.log(`💾 Stored OTP: ${seller.otp}`);
    console.log(`⏰ OTP Expires: ${seller.otpExpires ? new Date(seller.otpExpires).toLocaleString() : 'N/A'}`);
    console.log(`⏰ Current Time: ${new Date().toLocaleString()}`);
    console.log(`✅ Valid: ${seller.verifyOtp(otp) ? 'YES' : 'NO'}`);
    console.log('═══════════════════════════════════════════════════════════');
    
    if (!seller.verifyOtp(otp)) {
      return next(new AppError('OTP is invalid or has expired', 401));
    }

    // Verify password
    if (!(await seller.correctPassword(password, seller.password))) {
      console.log('[Seller Auth] Incorrect password');
      return next(new AppError('Incorrect password', 401));
    }

    // Clear OTP and update last login
    seller.otp = undefined;
    seller.otpExpires = undefined;
    seller.lastLogin = Date.now();
    
    // Ensure role is ALWAYS 'seller' (never 'user' or any other value)
    // This is critical for proper authorization
    if (!seller.role || seller.role !== 'seller') {
      console.log(`[Seller Auth] Correcting role from "${seller.role}" to "seller" for: ${seller.email}`);
      seller.role = 'seller';
    }
    
    // Mark email as verified when OTP is verified (since OTP is sent to email)
    if (!seller.verification?.emailVerified) {
      seller.verification = seller.verification || {};
      seller.verification.emailVerified = true;
      console.log('[Seller Auth] Email marked as verified for:', seller.email);
    }
    
    await seller.save({ validateBeforeSave: false });
    console.log('[Seller Auth] OTP verified successfully for:', seller.email);
    console.log('[Seller Auth] Seller role:', seller.role);

    // Create device session and generate tokens
    const { createDeviceSession } = require('../../utils/helpers/createDeviceSession');
    let sessionData;
    try {
      console.log('[Seller Auth] Creating device session for seller:', seller._id);
      sessionData = await createDeviceSession(req, seller, 'eazseller');
      console.log('[Seller Auth] Device session created successfully:', sessionData?.deviceId);
    } catch (deviceError) {
      // If device limit exceeded, return error
      // If device limit exceeded, return error (only in production)
      if (process.env.NODE_ENV === 'production' && deviceError.message && deviceError.message.includes('Too many devices')) {
        return next(new AppError(deviceError.message, 403));
      }
      // For other errors, log and continue without device session (fallback)
      console.error('[Seller Auth] ❌ Error creating device session:', deviceError.message || deviceError);
      console.error('[Seller Auth] Error stack:', deviceError.stack);
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

    const token = signToken(seller._id, seller.role, sessionData?.deviceId);
    
    // Set cookie (same as createSendToken)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      expires: new Date(
        Date.now() +
          (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000, // 90 days default
      ),
      // Set domain for production to allow cookie sharing across subdomains
      // Only set in production, leave undefined in development (localhost)
      ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
    };

    res.cookie('eazseller_jwt', token, cookieOptions);
    console.log(`[Seller Auth] JWT cookie set (eazseller_jwt): httpOnly=true, secure=${cookieOptions.secure}, sameSite=${cookieOptions.sameSite}`);

    // Remove sensitive data
    seller.password = undefined;
    seller.otp = undefined;
    seller.otpExpires = undefined;

    // Sanitize redirect path if needed
    const sanitizedRedirectTo = redirectTo || '/';

    // Log activity
    logActivityAsync({
      userId: seller._id,
      role: 'seller',
      action: 'LOGIN',
      description: `Seller logged in via OTP verification`,
      req,
    });

    // Return JSON with token, deviceId, refreshToken and redirectTo
    const response = {
      status: 'success',
      message: 'OTP verified',
      token,
      data: {
        seller: {
          id: seller._id,
          name: seller.name,
          email: seller.email,
          shopName: seller.shopName,
          role: seller.role,
          status: seller.status,
          lastLogin: seller.lastLogin,
        },
      },
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
    console.error('[Seller Auth] OTP verification error:', error);
    return next(new AppError('Failed to verify OTP. Please try again.', 500));
  }
});
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const seller = await Seller.findOne({ email: req.body.email });
  if (!seller) {
    return next(new AppError('There is no seller with email address', 404));
  }
  const resetToken = seller.createPasswordResetToken();
  await seller.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/sellers/resetPassword/${resetToken}`;
  const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;
  try {
    await sendEmail({
      email: seller.email,
      subject: 'Your password reset token (valid for 10 min)',
      message,
    });
    res
      .status(200)
      .json({ status: 'success', message: 'Token sent to email!' });
  } catch (err) {
    seller.passwordResetToken = undefined;
    seller.passwordResetExpires = undefined;
    await seller.save({ validateBeforeSave: false });

    return next(
      new AppError(
        'There was an error sending the email. Try again later!',
        500,
      ),
    );
  }
});
// Send verification OTP for email (for existing sellers and resend)
exports.sendEmailVerificationOtp = catchAsync(async (req, res, next) => {
  // Seller is already authenticated via protect middleware (or email provided for resend)
  let seller;
  if (req.body.email) {
    seller = await Seller.findOne({ email: req.body.email });
  } else {
    seller = await Seller.findById(req.user.id);
  }
  
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
  const otp = seller.createOtp();
  await seller.save({ validateBeforeSave: false });
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔐 [SELLER VERIFICATION] EMAIL OTP GENERATED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📧 Email: ${seller.email}`);
  console.log(`⏰ Expires: ${new Date(seller.otpExpires).toLocaleString()}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Send OTP via email
  try {
    await sendLoginOtpEmail(seller.email, otp, seller.name || seller.shopName);
    console.log(`✅ [Seller Verification] Email OTP sent to ${seller.email}`);
  } catch (error) {
    console.error('❌ [Seller Verification] Failed to send email OTP:', error.message);
    // Don't fail the request if email fails, OTP is still generated
  }

  res.status(200).json({
    status: 'success',
    message: 'Verification code sent to your email!',
    otp: process.env.NODE_ENV !== 'production' ? otp : undefined, // Only in dev
  });
});

// Resend OTP endpoint for sellers
exports.resendOtp = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  const seller = await Seller.findOne({ email });

  if (!seller) {
    return next(new AppError('No seller found with that email', 404));
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
  const otp = seller.createOtp();
  await seller.save({ validateBeforeSave: false });

  // Log OTP to console for development
  console.log('========================================');
  console.log(`[Resend OTP - Seller] 🔐 OTP PIN: ${otp}`);
  console.log(`[Resend OTP - Seller] User: ${seller.email}`);
  console.log(`[Resend OTP - Seller] OTP expires in 10 minutes`);
  console.log('========================================');

  // Send OTP via email
  try {
    await sendLoginOtpEmail(seller.email, otp, seller.name || seller.shopName);
    console.log(`[Resend OTP] OTP sent to ${seller.email}`);
  } catch (error) {
    console.error('[Resend OTP] Failed to send email:', error.message);
  }

  res.status(200).json({
    status: 'success',
    message: 'Verification code sent to your email!',
    otp: process.env.NODE_ENV !== 'production' ? otp : undefined, // Only in dev
  });
});

// Verify email with OTP (for existing sellers)
exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { otp } = req.body;

  if (!otp) {
    return next(new AppError('Please provide OTP', 400));
  }

  const seller = await Seller.findById(req.user.id).select('+otp +otpExpires');

  if (!seller) {
    return next(new AppError('No seller found', 404));
  }

  // If already verified, return success
  if (seller.verification?.emailVerified) {
    return res.status(200).json({
      status: 'success',
      message: 'Email is already verified',
    });
  }

  // Verify OTP
  if (!seller.verifyOtp(otp)) {
    return next(new AppError('OTP is invalid or has expired', 401));
  }

  // Mark email as verified
  seller.verification = seller.verification || {};
  seller.verification.emailVerified = true;
  seller.otp = undefined;
  seller.otpExpires = undefined;
  await seller.save({ validateBeforeSave: false });

  console.log(`✅ [Seller Verification] Email verified for: ${seller.email}`);

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

exports.resetPassword = catchAsync(async (req, res, next) => {
  //1) Get seller based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  const seller = await Seller.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  //2) If token has not expired, and there is seller, set the new password
  if (!seller) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  seller.password = req.body.password;
  seller.passwordConfirm = req.body.passwordConfirm;
  seller.passwordResetToken = undefined;
  seller.passwordResetExpires = undefined;
  await seller.save();
  
  // Invalidate all sessions on password reset
  const DeviceSession = require('../../models/user/deviceSessionModel');
  const TokenBlacklist = require('../../models/user/tokenBlackListModal');
  await DeviceSession.deactivateAll(seller._id);
  await TokenBlacklist.invalidateAllSessions(seller._id);
  
  //3) Update changedPasswordAt property for the seller
  //4) Log the seller in, send JWT (with new device session)
  try {
    await createSendToken(seller, 200, res, null, 'eazseller_jwt', req, 'eazseller');
  } catch (error) {
    // Fallback to old method if device session creation fails
    console.error('[Seller Auth] Error creating device session on password reset:', error);
    createSendToken(seller, 200, res, null, 'eazseller_jwt');
  }
});

exports.logout = catchAsync(async (req, res, next) => {
  // Logout device session
  const { logoutDevice } = require('../../utils/helpers/createDeviceSession');
  try {
    await logoutDevice(req);
  } catch (error) {
    console.error('[Seller Auth] Error logging out device session:', error);
    // Continue with cookie clearing even if device session logout fails
  }

  // 1. Extract token from Authorization header
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2. Always clear cookies as a security measure
  res.cookie('eazseller_jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
  });

  // 3. Prepare response
  const successResponse = {
    status: 'success',
    message: 'Logged out successfully',
    action: 'clearLocalStorage',
  };

  // 4. Handle cases without token
  if (!token) {
    await SecurityLog.create({
      eventType: 'logout_attempt',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { reason: 'No token provided' },
    }).catch((logError) => console.error('Security log error:', logError));

    return res.status(200).json(successResponse);
  }

  let decoded;
  try {
    // 5. Attempt to decode token
    decoded = jwt.decode(token);
    // Add logging
  } catch (decodeError) {
    console.error('Token decode error:', decodeError); // Add logging

    await SecurityLog.create({
      eventType: 'logout_attempt',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { error: 'Invalid token format' },
    }).catch((logError) => console.error('Security log error:', logError));

    return res.status(200).json(successResponse);
  }

  try {
    // 6. Add token to blacklist using the proper method (handles hashing)
    console.log('[Seller Logout] Adding token to blacklist');
    await TokenBlacklist.blacklistToken(
      token,
      decoded?.id || null,
      'seller',
      'logout',
    );

    // 7. Create security log
    await SecurityLog.create({
      user: decoded?.id || null,
      userTypeModel: decoded?.id ? 'Seller' : null,
      eventType: 'logout',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      shopName: seller?.shopName || 'N/A',
      metadata: { tokenExpiration: expiresAt },
    });

    return res.status(200).json(successResponse);
  } catch (err) {
    console.error('Logout processing error:', err);

    // Handle duplicate key error separately
    if (err.code === 11000) {
      return res.status(200).json(successResponse);
    }

    await SecurityLog.create({
      user: decoded?.id || null,
      userTypeModel: decoded?.id ? 'Seller' : null,
      eventType: 'logout_error',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { error: err.message },
    }).catch((logError) => console.error('Security log error:', logError));

    return res.status(200).json({
      ...successResponse,
      message: 'Logged out with minor issues',
    });
  }
});
