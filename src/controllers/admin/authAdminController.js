const Admin = require('../../models/user/adminModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const sendEmail = require('../../utils/email/emailService');
const crypto = require('crypto');
const { logActivityAsync, logActivity } = require('../../modules/activityLog/activityLog.service');
const securityMonitor = require('../../services/securityMonitor');
const ActivityLog = require('../../models/activityLog/activityLogModel');

exports.signupAdmin = catchAsync(async (req, res, next) => {
  const newAdmin = await Admin.create(req.body);
  createSendToken(newAdmin, 201, res, null, 'eazadmin_jwt');
});
exports.adminLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  console.log(`[Admin Login] Attempting login for email: ${email}`);

  const admin = await Admin.findOne({ email }).select('+password');

  if (!admin) {
    console.log(`[Admin Login] No admin found with email: ${email}`);
    return next(new AppError('Incorrect email or password', 401));
  }

  // Check if admin is active
  if (admin.active === false) {
    console.log(`[Admin Login] Admin account is deactivated: ${email}`);
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // Verify password
  const isPasswordCorrect = await admin.correctPassword(password, admin.password);
  if (!isPasswordCorrect) {
    console.log(`[Admin Login] Incorrect password for email: ${email}`);
    return next(new AppError('Incorrect email or password', 401));
  }

  console.log(`[Admin Login] Successful login for email: ${email}`);
  
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
    console.warn(`[Admin Login] CRITICAL RISK detected for admin ${admin.email}. Login allowed but logged.`);
  }

  // Create device session and generate tokens
  const { createDeviceSession } = require('../../utils/helpers/createDeviceSession');
  let sessionData;
  try {
    console.log('[Admin Auth] Creating device session for admin:', admin._id);
    sessionData = await createDeviceSession(req, admin, 'eazadmin');
    console.log('[Admin Auth] Device session created successfully:', sessionData?.deviceId);
  } catch (deviceError) {
    // If device limit exceeded, return error
      // If device limit exceeded, return error (only in production)
      if (process.env.NODE_ENV === 'production' && deviceError.message && deviceError.message.includes('Too many devices')) {
        return next(new AppError(deviceError.message, 403));
      }
    // For other errors, log and continue without device session (fallback)
    console.error('[Admin Auth] ❌ Error creating device session:', deviceError.message || deviceError);
    console.error('[Admin Auth] Error stack:', deviceError.stack);
    sessionData = null;
  }

  // Use createSendToken - pass null for req to avoid creating duplicate device session
  // since we already created it above
  try {
    // If sessionData exists, use the deviceId from it, otherwise let createSendToken create one
    if (sessionData) {
      // Create token with existing deviceId
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        { id: admin._id, role: admin.role, deviceId: sessionData.deviceId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );
      
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('eazadmin_jwt', token, {
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
      await createSendToken(admin, 200, res, null, 'eazadmin_jwt', null, null);
    }
  } catch (error) {
    console.error('[Admin Auth] Error in token creation:', error);
    createSendToken(admin, 200, res, null, 'eazadmin_jwt');
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

  createSendToken(newUser, 201, res, null, 'eazmain_jwt');
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

exports.forgetPassword = catchAsync(async (req, res, next) => {
  const admin = await Admin.findOne({ email: req.body.email });

  if (!admin) {
    return next(new AppError('There is no user with that email', 404));
  }

  const resetToken = admin.createPasswordResetToken();
  await admin.save({ validateBeforeSave: false });
  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/admin/resetPassword/${resetToken}`;
  const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;
  try {
    await sendEmail({
      email: admin.email,
      subject: 'Your password reset token (valid for 10 min)',
      message,
    });

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email!',
    });
  } catch (err) {
    admin.passwordResetToken = undefined;
    admin.passwordResetExpires = undefined;
    await admin.save({ validateBeforeSave: false });
    return next(
      new AppError(
        'There was an error sending the email. Try again later!',
        500,
      ),
    );
  }
});
exports.resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createhash('sha256')
    .update(req.params.resetToken)
    .digest('hex');
  const admin = await Admin.findOne({
    resetToken: hashedToken,
    resetExpires: { $gt: Date.now() },
  });

  if (!admin) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  const { password, passwordConfirm } = req.body;

  admin.password = password;
  admin.passwordConfirm = passwordConfirm;
  admin.passwordResetToken = undefined;
  admin.passwordResetExpires = undefined;
  await admin.save();
  createSendToken(admin, 200, res, null, 'eazadmin_jwt');
});
