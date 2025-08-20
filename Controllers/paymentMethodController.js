const PaymentMethod = require('../Models/paymentMethodModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const mongoose = require('mongoose');

exports.createPaymentMethod = catchAsync(async (req, res, next) => {
  const user = req.user.id;
  const {
    type,
    provider,
    mobileName,
    isDefault,
    mobileNumber,
    bankName,
    accountNumber,
    accountName,
    branch,
  } = req.body;

  const paymentData =
    type === 'mobile_money'
      ? {
          type,
          name: mobileName,
          mobileNumber,
          isDefault,
          user,
          provider,
        }
      : {
          type,
          bankName,
          accountNumber,
          accountName,
          branch,
          user,
        };
  const paymentMethod = await PaymentMethod.create(paymentData);
  res.status(201).json({
    status: 'success',
    data: {
      paymentMethod,
    },
  });
});

exports.getAllPaymentMethods = catchAsync(async (req, res, next) => {
  const paymentMethods = await PaymentMethod.find();
  res.status(200).json({
    status: 'success',
    results: paymentMethods.length,
    data: {
      paymentMethods,
    },
  });
});

exports.getPaymentMethod = catchAsync(async (req, res, next) => {
  const paymentMethod = await PaymentMethod.findById(req.params.id);
  if (!paymentMethod) {
    return next(new AppError('Payment method not found', 404));
  }
  res.status(200).json({
    status: 'success',
    data: {
      paymentMethod,
    },
  });
});

exports.updatePaymentMethod = catchAsync(async (req, res, next) => {
  const paymentMethod = await PaymentMethod.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true,
    },
  );
  if (!paymentMethod) {
    return next(new AppError('Payment method not found', 404));
  }
  res.status(200).json({
    status: 'success',
    data: {
      paymentMethod,
    },
  });
});

exports.deletePaymentMethod = catchAsync(async (req, res, next) => {
  const paymentMethod = await PaymentMethod.findByIdAndDelete(req.params.id);
  if (!paymentMethod) {
    return next(new AppError('Payment method not found', 404));
  }
  res.status(204).json({
    status: 'success',
    data: null,
  });
});
exports.getAllPaymentMethods = catchAsync(async (req, res, next) => {
  const paymentMethods = await PaymentMethod.find();
  res.status(200).json({
    status: 'success',
    results: paymentMethods.length,
    data: {
      paymentMethods,
    },
  });
});
exports.setDefaultPaymentMethod = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id; // Assuming user is attached to request
    const paymentMethodId = req.params.id;

    // 1. Clear existing default payment method
    await PaymentMethod.updateMany(
      { user: userId, isDefault: true },
      { $set: { isDefault: false } },
      { session },
    );

    // 2. Set the new payment method as default
    const paymentMethod = await PaymentMethod.findByIdAndUpdate(
      paymentMethodId,
      { $set: { isDefault: true } },
      {
        new: true,
        runValidators: true,
        session,
      },
    );

    if (!paymentMethod) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Payment method not found', 404));
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: 'success',
      data: {
        paymentMethod,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
});
