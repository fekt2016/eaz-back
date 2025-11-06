const catchAsync = require('../../utils/helpers/catchAsync');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const Seller = require('../../models/user/sellerModel');
const AppError = require('../../utils/errors/appError');
const { sendPaymentNotification } = require('../../utils/helpers/notificationService');

// @desc    Create a new payment request
// @route   POST /api/payment-requests
// @access  Protected (Seller)
exports.createPaymentRequest = catchAsync(async (req, res, next) => {
  console.log('req.body', req.body);
  const seller = req.user;
  console.log('seller', seller);
  const { amount, paymentMethod, paymentDetails } = req.body;

  // Validate amount
  if (amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  // Get current seller balance
  const currentSeller = await Seller.findById(seller.id);
  if (!currentSeller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check available balance
  if (amount > currentSeller.balance) {
    return next(new AppError('Insufficient balance', 400));
  }

  // Create payment request
  const paymentRequest = await PaymentRequest.create({
    seller: seller.id,
    amount,
    currency: 'GHS',
    paymentMethod,
    paymentDetails,
    status: 'pending',
  });

  // Lock funds in seller account
  currentSeller.balance -= amount;
  currentSeller.lockedBalance += amount;
  await currentSeller.save();
  console.log('currentSeller', currentSeller);
  // Send confirmation to seller
  await sendPaymentNotification(seller, 'request_created', paymentRequest);

  res.status(201).json({
    status: 'success',
    data: {
      paymentRequest,
    },
  });
});

exports.getSellerRequests = catchAsync(async (req, res, next) => {
  const seller = req.user;
  const requests = await PaymentRequest.find({ seller: seller.id }).sort(
    '-createdAt',
  );

  res.status(200).json({
    status: 'success',
    results: requests.length,
    data: {
      requests,
    },
  });
});
exports.getRequestById = catchAsync(async (req, res, next) => {
  const request = await PaymentRequest.findOne({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!request) {
    return next(new AppError('Payment request not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      request,
    },
  });
});

exports.getPendingRequests = catchAsync(async (req, res, next) => {
  const requests = await PaymentRequest.find({ status: 'pending' })
    .populate('seller', 'name email phone')
    .sort('createdAt');

  res.status(200).json({
    status: 'success',
    results: requests.length,
    data: {
      requests,
    },
  });
});

exports.processPaymentRequest = catchAsync(async (req, res, next) => {
  const { status, transactionId, rejectionReason } = req.body;

  // Validate status
  if (!['paid', 'rejected'].includes(status)) {
    return next(
      new AppError('Invalid status. Must be "paid" or "rejected"', 400),
    );
  }

  // Find payment request
  const paymentRequest = await PaymentRequest.findById(req.params.id).populate(
    'seller',
  );
  if (!paymentRequest) {
    return next(new AppError('Payment request not found', 404));
  }

  // Only pending requests can be processed
  if (paymentRequest.status !== 'pending') {
    return next(
      new AppError('This payment request has already been processed', 400),
    );
  }

  // Update payment request
  paymentRequest.status = status;
  paymentRequest.transactionId = transactionId || null;
  paymentRequest.rejectionReason = rejectionReason || null;
  paymentRequest.processedAt = new Date();

  const seller = paymentRequest.seller;

  // Handle funds based on status
  if (status === 'paid') {
    // Calculate fees (1.5%)
    const feeAmount = paymentRequest.amount * 0.015;
    const netAmount = paymentRequest.amount - feeAmount;

    // Update seller account
    seller.lockedBalance -= paymentRequest.amount;
    seller.paymentHistory.push({
      amount: netAmount,
      method: paymentRequest.paymentMethod,
      transactionId,
    });

    // Simulate payment processing (in production, call payment gateway)
    await processPayment(
      paymentRequest.paymentMethod,
      paymentRequest.paymentDetails,
      netAmount,
    );
  } else if (status === 'rejected') {
    // Return funds to seller
    seller.balance += paymentRequest.amount;
    seller.lockedBalance -= paymentRequest.amount;
  }

  await seller.save();
  const updatedRequest = await paymentRequest.save();

  // Send notification to seller
  await sendPaymentNotification(seller, status, updatedRequest);

  res.status(200).json({
    status: 'success',
    data: {
      paymentRequest: updatedRequest,
    },
  });
});

async function processPayment(method, details, amount) {
  // In production, integrate with actual payment gateways
  if (method.includes('momo')) {
    // Simulate mobile money payment
    return simulateMobileMoneyPayment(details.mobileMoney.phone, amount);
  } else if (method === 'bank') {
    // Simulate bank transfer
    return simulateBankTransfer(details.bank.accountNumber, amount);
  }

  // For cash payments, just log
  console.log(`Processing cash payment of GHS ${amount.toFixed(2)}`);
  return { success: true };
}
async function simulateMobileMoneyPayment(phone, amount) {
  console.log(`Sending GHS ${amount.toFixed(2)} to ${phone} via mobile money`);
  // Actual integration would use something like:
  // const result = await momoProvider.sendPayment(phone, amount);
  return { success: true, transactionId: `MM_${Date.now()}` };
}

// Simulate bank transfer
async function simulateBankTransfer(accountNumber, amount) {
  console.log(
    `Transferring GHS ${amount.toFixed(2)} to account ${accountNumber}`,
  );
  // Actual integration would use bank API
  return { success: true, transactionId: `BANK_${Date.now()}` };
}
