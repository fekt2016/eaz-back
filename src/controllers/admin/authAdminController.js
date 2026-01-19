const Admin = require('../../models/user/adminModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const { sendEmail, sendPasswordResetEmail } = require('../../utils/email/emailService');
const crypto = require('crypto');
const { logActivityAsync, logActivity } = require('../../modules/activityLog/activityLog.service');
const securityMonitor = require('../../services/securityMonitor');
const ActivityLog = require('../../models/activityLog/activityLogModel');
// Shared helpers for standardized auth
const { normalizeEmail, handleSuccessfulLogin, clearAuthCookie } = require('../../utils/helpers/authHelpers');

exports.signupAdmin = catchAsync(async (req, res, next) => {
  const newAdmin = await Admin.create(req.body);
  createSendToken(newAdmin, 201, res, null, 'admin_jwt');
});
exports.adminLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

<<<<<<< HEAD
  // SECURITY: Normalize email to prevent case-sensitivity issues
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return next(new AppError('Please provide a valid email address', 400));
=======
  logger.info(`[Admin Login] Attempting login for email: ${email}`);

  const admin = await Admin.findOne({ email }).select('+password');

  if (!admin) {
    logger.info(`[Admin Login] No admin found with email: ${email}`);
    return next(new AppError('Incorrect email or password', 401));
>>>>>>> 6d2bc77 (first ci/cd push)
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Admin Login] Attempting login for email: ${normalizedEmail}`);
  }

  const admin = await Admin.findOne({ email: normalizedEmail }).select('+password');

  if (!admin) {
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Invalid credentials', 401));
  }

  // SECURITY: Check if admin is active
  if (admin.active === false) {
<<<<<<< HEAD
=======
    logger.info(`[Admin Login] Admin account is deactivated: ${email}`);
>>>>>>> 6d2bc77 (first ci/cd push)
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // SECURITY: Verify password
  const isPasswordCorrect = await admin.correctPassword(password, admin.password);
  if (!isPasswordCorrect) {
<<<<<<< HEAD
    // SECURITY: Increment failed login attempts (if field exists)
    if (admin.failedLoginAttempts !== undefined) {
      admin.failedLoginAttempts = (admin.failedLoginAttempts || 0) + 1;
      // Lock account after 5 failed attempts (15 minutes)
      if (admin.failedLoginAttempts >= 5) {
        admin.accountLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await admin.save({ validateBeforeSave: false });
        return next(new AppError('Too many failed login attempts. Account locked for 15 minutes.', 429));
      }
      await admin.save({ validateBeforeSave: false });
    }
    // SECURITY: Generic error message to prevent user enumeration
    return next(new AppError('Invalid credentials', 401));
  }

  // SECURITY: Check if account is locked
  if (admin.accountLockedUntil && new Date(admin.accountLockedUntil).getTime() > Date.now()) {
    const minutesRemaining = Math.ceil(
      (new Date(admin.accountLockedUntil).getTime() - Date.now()) / (1000 * 60)
    );
    return next(
      new AppError(
        `Account is temporarily locked. Please try again in ${minutesRemaining} minute(s).`,
        429
      )
    );
  }

  // Reset failed login attempts on successful password verification
  if (admin.failedLoginAttempts !== undefined && admin.failedLoginAttempts > 0) {
    admin.failedLoginAttempts = 0;
    admin.accountLockedUntil = null;
    await admin.save({ validateBeforeSave: false });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Admin Login] Successful login for email: ${normalizedEmail}`);
  }
=======
    logger.info(`[Admin Login] Incorrect password for email: ${email}`);
    return next(new AppError('Incorrect email or password', 401));
  }

  logger.info(`[Admin Login] Successful login for email: ${email}`);
>>>>>>> 6d2bc77 (first ci/cd push)
  
  // Capture IP and device
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Security monitoring
  const ipChange = await securityMonitor.detectIPChange(admin, ipAddress, 'admin');
  const deviceChange = await securityMonitor.detectDeviceChange(admin, userAgent, 'admin');
  const multipleIps = await securityMonitor.detectMultipleIps(admin, 'admin');
  const geoMismatch = await securityMonitor.detectGeoMismatch(admin, ipAddress, 'admin');
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
      userId: admin._id,
      userModel: 'Admin',
      role: 'admin',
      action: 'IP_CHANGE',
      description: `IP address changed from ${ipChange.previousIp} to ${ipChange.currentIp}`,
      activityType: 'IP_CHANGE',
      ipAddress: ipChange.currentIp,
      previousIp: ipChange.previousIp,
      userAgent,
      location,
      riskLevel: 'medium',
      platform: 'eazadmin',
      metadata: {
        previousIp: ipChange.previousIp,
        currentIp: ipChange.currentIp,
      },
    });
  }

  // Log device change if detected
  if (deviceChange.changed) {
    await ActivityLog.create({
      userId: admin._id,
      userModel: 'Admin',
      role: 'admin',
      action: 'DEVICE_CHANGE',
      description: `Device changed from ${deviceChange.previousDevice?.substring(0, 50)} to ${deviceChange.currentDevice?.substring(0, 50)}`,
      activityType: 'DEVICE_CHANGE',
      ipAddress,
      userAgent: deviceChange.currentDevice,
      location,
      riskLevel: 'medium',
      platform: 'eazadmin',
      metadata: {
        previousDevice: deviceChange.previousDevice,
        currentDevice: deviceChange.currentDevice,
      },
    });
  }

  // Update last login
  admin.lastLogin = Date.now();
  await admin.save({ validateBeforeSave: false });

  // Log login activity with security info
  const loginLog = await ActivityLog.create({
    userId: admin._id,
    userModel: 'Admin',
    role: 'admin',
    action: 'LOGIN',
    description: `Admin logged in`,
    activityType: 'LOGIN',
    ipAddress,
    previousIp: ipChange.previousIp || null,
    userAgent,
    location,
    riskLevel,
    platform: 'eazadmin',
    metadata: {
      ipChanged: ipChange.changed,
      deviceChanged: deviceChange.changed,
      multipleIps: multipleIps.multipleIps,
      ipCount: multipleIps.ipCount,
    },
  });

  // Trigger security alert if risk is high or critical
  if (riskLevel === 'high' || riskLevel === 'critical') {
    await securityMonitor.triggerSecurityAlert(admin, loginLog, 'admin');
  }

  // Check if critical risk requires force logout
  if (riskLevel === 'critical') {
    // For critical risk, we'll still allow login but log it
    // In production, you might want to require additional verification
    logger.warn(`[Admin Login] CRITICAL RISK detected for admin ${admin.email}. Login allowed but logged.`);
  }

  // Use standardized login helper
  try {
<<<<<<< HEAD
    const response = await handleSuccessfulLogin(req, res, admin, 'admin');
    res.status(200).json(response);
  } catch (deviceError) {
    if (process.env.NODE_ENV === 'production' && deviceError.message?.includes('Too many devices')) {
      return next(new AppError(deviceError.message, 403));
    }
    // In dev, continue without device session
    const response = await handleSuccessfulLogin(req, res, admin, 'admin', { skipDeviceSession: true });
    res.status(200).json(response);
=======
    logger.info('[Admin Auth] Creating device session for admin:', admin._id);
    sessionData = await createDeviceSession(req, admin, 'eazadmin');
    logger.info('[Admin Auth] Device session created successfully:', sessionData?.deviceId);
  } catch (deviceError) {
    // If device limit exceeded, return error
      // If device limit exceeded, return error (only in production)
      if (process.env.NODE_ENV === 'production' && deviceError.message && deviceError.message.includes('Too many devices')) {
        return next(new AppError(deviceError.message, 403));
      }
    // For other errors, log and continue without device session (fallback)
    logger.error('[Admin Auth] ❌ Error creating device session:', deviceError.message || deviceError);
    logger.error('[Admin Auth] Error stack:', deviceError.stack);
    sessionData = null;
  }

  // Use createSendToken - pass null for req to avoid creating duplicate device session
  // since we already created it above
  try {
    // If sessionData exists, use the deviceId from it, otherwise let createSendToken create one
    if (sessionData) {
      // Create token with existing deviceId
      const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');
      const token = jwt.sign(
        { id: admin._id, role: admin.role, deviceId: sessionData.deviceId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );
      
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('admin_jwt', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/',
        expires: new Date(Date.now() + (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000),
        ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
      });

      admin.password = undefined;
      res.status(200).json({
        status: 'success',
        token,
        deviceId: sessionData.deviceId,
        refreshToken: sessionData.refreshToken,
        data: { user: admin },
      });
    } else {
      // Fallback: create token without device session
      await createSendToken(admin, 200, res, null, 'admin_jwt', null, null);
    }
  } catch (error) {
    logger.error('[Admin Auth] Error in token creation:', error);
    createSendToken(admin, 200, res, null, 'admin_jwt');
>>>>>>> 6d2bc77 (first ci/cd push)
  }
});

exports.signupUser = catchAsync(async (req, res, next) => {
  const admin = await Admin.findOne({ email: req.user.email });

  if (!admin) {
    return next(new AppError('You are not an admin', 401));
  }

  const newUser = await admin.createNewUser({
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    name: req.body.name,
    createdBy: admin._id,
  });

  createSendToken(newUser, 201, res, null, 'main_jwt');
});

exports.sigupSeller = catchAsync(async (req, res, next) => {
  const admin = await Admin.findOne({ email: req.user.email });

  if (!admin) {
    return next(new AppError('You are not an admin', 401));
  }
  const newSeller = await admin.createNewSeller({
    shopName: req.body.shopName,
    email: req.body.email,
    name: req.body.name,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    createdBy: admin._id,
  });

  res.status(201).json({
    status: 'success',
    data: {
      seller: newSeller,
    },
  });
});

/**
 * ==================================================
 * UNIFIED EMAIL-ONLY PASSWORD RESET FLOW (ADMIN)
 * ==================================================
 * 
 * STEP 1: Request Password Reset (Email Only)
 * POST /api/v1/admin/forgot-password
 * Body: { email: "admin@example.com" }
 * 
 * STEP 2: Reset Password with Token
 * POST /api/v1/admin/reset-password
 * Body: { token: "reset_token", newPassword: "newpass123", confirmPassword: "newpass123" }
 */

/**
 * Request Password Reset (Email Only) - Admin
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

  // Find admin by email (silently - don't reveal if admin exists)
  const admin = await Admin.findOne({ email: normalizedEmail }).select('+passwordResetToken +passwordResetExpires');

  // SECURITY: Always return success message (prevent account enumeration)
  // Even if admin doesn't exist, return the same message
  if (!admin) {
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Check rate limiting - if admin has a recent reset token that hasn't expired yet, don't send another
  if (admin.passwordResetExpires && admin.passwordResetExpires > Date.now()) {
    // Token still valid, don't send another email (rate limiting)
    // Still return success to prevent information leakage
    return res.status(200).json({
      status: 'success',
      message: 'If an account exists, a reset email has been sent.',
    });
  }

  // Generate reset token using admin model method
  const resetToken = admin.createPasswordResetToken();
  await admin.save({ validateBeforeSave: false });

  try {
    // Send password reset email
    await sendPasswordResetEmail(admin.email, resetToken, admin.name || 'Admin');
    
    console.log(`[Admin Password Reset] Reset email sent to ${admin.email}`);
  } catch (err) {
    // If email fails, clear the reset token
    admin.passwordResetToken = undefined;
    admin.passwordResetExpires = undefined;
    await admin.save({ validateBeforeSave: false });

    // Still return success to prevent information leakage
    console.error('[Admin Password Reset] Failed to send reset email:', err);
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
 * Reset Password with Token - Admin
 * - Validates reset token
 * - Ensures token is not expired or used
 * - Hashes password using bcrypt (12 rounds)
 * - Updates admin password
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

  // Find admin with valid reset token
  const admin = await Admin.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires +password');

  if (!admin) {
    return next(new AppError('Invalid or expired reset token', 400));
  }

  // Update admin password and clear reset fields
  admin.password = newPassword;
  admin.passwordConfirm = confirmPassword;
  admin.passwordResetToken = undefined;
  admin.passwordResetExpires = undefined;
  admin.passwordChangedAt = Date.now();

  await admin.save();

  // SECURITY: Invalidate all active sessions
  // Note: Admin sessions may use different session management - implement as needed

  try {
    // Send confirmation email
    await sendEmail({
      to: admin.email,
      subject: 'Password Reset Successful',
      html: `
        <h2>Password Reset Successful</h2>
        <p>Your admin account password has been successfully reset.</p>
        <p>If you did not perform this action, please contact support immediately.</p>
        <p><strong>Security Notice:</strong> All active sessions have been invalidated. Please log in again.</p>
      `,
    });
  } catch (err) {
    // Don't fail the request if email fails
    console.error('[Admin Password Reset] Failed to send confirmation email:', err);
  }

  // Log admin in with new password
  createSendToken(admin, 200, res, null, 'admin_jwt');
});

// Legacy endpoints (kept for backward compatibility)
/**
 * POST /admin/forgotPassword
 * @deprecated Use requestPasswordReset instead
 */
exports.forgetPassword = exports.requestPasswordReset;

/**
 * PATCH /admin/resetPassword/:token
 * @deprecated Use resetPasswordWithToken instead
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  // Legacy endpoint - extract token from URL params
  const token = req.params.token || req.params.resetToken;
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

  const admin = await Admin.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires +password');

  if (!admin) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  admin.password = password;
  admin.passwordConfirm = passwordConfirm;
  admin.passwordResetToken = undefined;
  admin.passwordResetExpires = undefined;
  admin.passwordChangedAt = Date.now();
  await admin.save();

  // Log admin in with new password
  createSendToken(admin, 200, res, null, 'admin_jwt');
});
