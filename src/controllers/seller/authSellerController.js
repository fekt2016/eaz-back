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

exports.signupSeller = catchAsync(async (req, res, next) => {
  const newSeller = await Seller.create(req.body);
  if (!newSeller) {
    return next(new AppError('check your cred and register again', 401));
  }
  await sellerCustomerModel.create({
    myId: newSeller.id,
  });

  createSendToken(newSeller, 201, res);
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

  seller.lastLogin = Date.now();

  createSendToken(seller, 200, res);
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
  //3) Update changedPasswordAt property for the seller
  //4) Log the seller in, send JWT
  createSendToken(seller, 200, res);
});

exports.logout = catchAsync(async (req, res, next) => {
  // 1. Extract token from Authorization header
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2. Always clear cookies as a security measure
  res.cookie('jwt', 'loggedout', {
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
    // 6. Add token to blacklist
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);
    console.log('Adding token to blacklist:', token); // Add logging

    // Use create instead of findOneAndUpdate for simplicity
    await TokenBlacklist.create({
      token,
      user: decoded?.id || null,
      userType: 'seller',
      expiresAt,
      reason: 'logout',
    });

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
