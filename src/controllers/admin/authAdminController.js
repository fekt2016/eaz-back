const Admin = require('../../models/user/adminModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { createSendToken } = require('../../utils/helpers/createSendToken');
const sendEmail = require('../../utils/email/emailService');
const crypto = require('crypto');

exports.signupAdmin = catchAsync(async (req, res, next) => {
  const newAdmin = await Admin.create(req.body);
  createSendToken(newAdmin, 201, res);
});
exports.adminLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  const admin = await Admin.findOne({ email }).select('+password');

  //   //2) Check if email and password exist
  if (!admin || !(await admin.correctPassword(password, admin.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  createSendToken(admin, 200, res);
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

  createSendToken(newUser, 201, res);
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
  createSendToken(admin, 200, res);
});
