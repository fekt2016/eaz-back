const { promisify } = require('util');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const NodeCache = require('node-cache');
const User = require('../Models/userModel');
const Admin = require('../Models/adminModel');
const Seller = require('../Models/sellerModel');
const TokenBlacklist = require('../Models/tokenBlackListModal');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { sendCustomEmail } = require('../utils/emailService');
const { createSendToken } = require('../utils/createSendToken');
const { validateGhanaPhone } = require('../utils/helper');
const {
  isPublicRoute,
  isTokenBlacklisted,
  matchRoutePattern,
  escapeRegex,
  findUserByToken,
  extractToken,
  verifyToken,
} = require('../utils/routeUtils');

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
];

// Controller methods ===========================================================

exports.signup = catchAsync(async (req, res, next) => {
  // Phone validation
  if (req.body.phone && !validateGhanaPhone(req.body.phone)) {
    return next(new AppError('Please provide a valid Ghana phone number', 400));
  }

  // // Email validation
  if (req.body.email && !validator.isEmail(req.body.email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  // // Require either email or phone
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

  // // Create new user
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone ? req.body.phone.replace(/\D/g, '') : undefined,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    // passwordChangedAt: req.body.passwordChangedAt,
    emailVerified: req.body.emailVerified || false,
  });
  console.log('user', newUser);
  const verificationToken = newUser.createEmailVerificationToken();
  console.log('verificationToken', verificationToken);
  await newUser.save({ validateBeforeSave: false });
  const verificationURL = `${req.protocol}://${req.get('host')}/api/v1/users/email-verification/${verificationToken}`;

  const message = `Welcome to YourBrand! Please verify your email by clicking on this link: ${verificationURL}. This link is valid for 10 minutes.`;
  try {
    await sendCustomEmail({
      email: newUser.email,
      subject: 'Verify Your Email Address',
      message,
    });

    // Respond without sending sensitive data
    res.status(201).json({
      status: 'success',
      requiresVerification: true,
      message:
        'Account created! Please check your email to verify your account.',
      data: {
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
        },
      },
    });
  } catch (err) {
    // If email fails, remove the unverified user
    await User.findByIdAndDelete(newUser._id);

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
  console.log(loginId);

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

  // Send OTP
  if (validator.isEmail(loginId)) {
    const message = `Your verification code is: ${otp}\nThis code will expire in 10 minutes.`;
    await sendCustomEmail({
      email: user.email,
      subject: 'Your OTP for login',
      message,
    });
  } else {
    // In production: Integrate with SMS gateway
    console.log(`OTP for ${user.phone}: ${otp}`);
  }

  res.status(200).json({
    status: 'success',
    message: 'OTP sent to your email or phone!',
    otp,
  });
});

exports.verifyOtp = catchAsync(async (req, res, next) => {
  const { loginId, otp, password } = req.body;

  if (!loginId || !otp || !password) {
    return next(new AppError('Please provide loginId, OTP, and password', 400));
  }

  let user;
  const query = User.findOne();

  if (validator.isEmail(loginId)) {
    query.where({ email: loginId });
  } else if (validator.isMobilePhone(loginId)) {
    query.where({ phone: loginId.replace(/\D/g, '') });
  } else {
    return next(
      new AppError('Please provide a valid email or phone number', 400),
    );
  }

  query.select('+password +otp +otpExpires');
  user = await query;

  if (!user) {
    return next(
      new AppError('No user found with that email or phone number', 404),
    );
  }

  // Verify OTP
  if (!user.verifyOtp(otp)) {
    return next(new AppError('OTP is invalid or has expired', 401));
  }

  // Verify password
  if (!(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect password', 401));
  }

  // Clear OTP and update last login
  user.otp = undefined;
  user.otpExpires = undefined;
  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  createSendToken(user, 200, res);
});

exports.logout = catchAsync(async (req, res, next) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
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
  // Extract token
  const token = extractToken(req.headers.authorization);

  if (!token) {
    console.log(`No token found for protected route: ${method} ${fullPath}`);
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401),
    );
  }
  const blacklisted = await TokenBlacklist.findOne({ token });
  // Check token blacklist
  if (blacklisted) {
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

  // Attach user to request
  req.user = currentUser;
  console.log(
    `Authenticated as ${currentUser.role}: ${currentUser.email || currentUser.phone}`,
  );
  next();
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    console.log(req.user.role);
    if (!req.user?.role || !roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403),
      );
    }
    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('No user found with that email address', 404));
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get(
    'host',
  )}/api/v1/users/resetPassword/${resetToken}`;

  const message = `Forgot your password? Submit a PATCH request with your new password to: ${resetURL}.\nIf you didn't request this, please ignore this email!`;

  try {
    await sendCustomEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10 min)',
      message,
    });

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

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
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }

  user.password = req.body.newPassword;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  createSendToken(user, 200, res);
});

exports.emailVerification = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }

  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError('No user found with that email address', 404));
  }

  const verificationToken = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  const verificationURL = `${req.protocol}://${req.get(
    'host',
  )}/api/v1/users/verify-email/${verificationToken}`;

  const message = `Verify your email by clicking on this link: ${verificationURL}. This link is valid for 10 minutes.`;

  try {
    await sendCustomEmail({
      email: user.email,
      subject: 'Email Verification',
      message,
    });

    res.status(200).json({
      status: 'success',
      message: 'Verification email sent',
    });
  } catch (err) {
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError('There was an error sending the verification email', 500),
    );
  }
});
