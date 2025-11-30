/**
 * Seller Payout Controller
 * Handles seller withdrawal requests
 */

const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Seller = require('../../models/user/sellerModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const Transaction = require('../../models/transaction/transactionModel');
const PaymentMethod = require('../../models/payment/PaymentMethodModel');
const User = require('../../models/user/userModel');
const payoutService = require('../../services/payoutService');
const mongoose = require('mongoose');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

/**
 * Create a withdrawal request
 * POST /api/v1/seller/payout/request
 */
exports.createWithdrawalRequest = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const { amount, payoutMethod, paymentDetails } = req.body;
  // Map payoutMethod to paymentMethod for PaymentRequest model
  const paymentMethod = payoutMethod;

  // Validate input
  if (!amount || amount <= 0) {
    return next(new AppError('Invalid withdrawal amount', 400));
  }

  if (!payoutMethod || !paymentMethod) {
    return next(new AppError('Payout method is required', 400));
  }

  // Get seller with balance
  const seller = await Seller.findById(sellerId);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Calculate withdrawable balance
  seller.calculateWithdrawableBalance();

  // Check if seller has sufficient balance (use balance directly, not withdrawableBalance)
  if (amount > seller.balance) {
    return next(
      new AppError(
        `Insufficient balance. Available: GH₵${seller.balance.toFixed(2)}`,
        400
      )
    );
  }

  // Prevent negative balance
  if (seller.balance - amount < 0) {
    return next(
      new AppError(
        `Insufficient balance. Available: GH₵${seller.balance.toFixed(2)}`,
        400
      )
    );
  }

  // Check for existing pending request
  const existingPending = await PaymentRequest.findOne({
    seller: sellerId,
    status: { $in: ['pending', 'paid', 'success'] },
  });

  if (existingPending) {
    return next(
      new AppError('You have a pending withdrawal request. Please wait for it to be processed.', 400)
    );
  }

  // Validate payment details based on payout method
  let finalPaymentDetails = paymentDetails || {};

  if (payoutMethod === 'bank') {
    if (!finalPaymentDetails.accountNumber || !finalPaymentDetails.bankCode) {
      return next(new AppError('Bank account number and bank code are required', 400));
    }
    // Use saved payment method if available
    if (seller.paymentMethods?.bankAccount && Object.keys(finalPaymentDetails).length === 0) {
      finalPaymentDetails = { ...seller.paymentMethods.bankAccount };
    }
  } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(payoutMethod)) {
    // Map payoutMethod to PaymentMethod provider
    const providerMap = {
      'mtn_momo': 'MTN',
      'vodafone_cash': 'Vodafone',
      'airtel_tigo_money': 'AirtelTigo',
    };
    const provider = providerMap[payoutMethod];

    // If paymentDetails are not provided, fetch from PaymentMethod model
    if (!finalPaymentDetails.phone && !finalPaymentDetails.mobileNumber) {
      // Find the user associated with this seller (by email)
      const user = await User.findOne({ email: seller.email });
      
      if (user) {
        // Try to find default payment method first, then any matching provider
        let paymentMethod = await PaymentMethod.findOne({
          user: user._id,
          type: 'mobile_money',
          provider: provider,
          isDefault: true,
        });

        // If no default found, get any payment method with matching provider
        if (!paymentMethod) {
          paymentMethod = await PaymentMethod.findOne({
            user: user._id,
            type: 'mobile_money',
            provider: provider,
          });
        }

        if (paymentMethod) {
          // Extract payment details from PaymentMethod model
          finalPaymentDetails = {
            phone: paymentMethod.mobileNumber,
            network: paymentMethod.provider,
            accountName: paymentMethod.name || seller.name || seller.shopName,
          };
          console.log('[createWithdrawalRequest] Fetched payment method from PaymentMethod model:', {
            provider,
            phone: paymentMethod.mobileNumber,
            accountName: finalPaymentDetails.accountName,
            isDefault: paymentMethod.isDefault,
          });
        } else {
          // Fallback to seller's saved payment methods
          if (seller.paymentMethods?.mobileMoney && Object.keys(finalPaymentDetails).length === 0) {
            const sellerMobileMoney = seller.paymentMethods.mobileMoney;
            // Check if seller's saved network matches the selected provider
            const sellerNetwork = sellerMobileMoney.network?.toUpperCase();
            if (sellerNetwork === provider || 
                (provider === 'MTN' && sellerNetwork === 'MTN') ||
                (provider === 'Vodafone' && (sellerNetwork === 'VODAFONE' || sellerNetwork === 'VOD')) ||
                (provider === 'AirtelTigo' && (sellerNetwork === 'AIRTELTIGO' || sellerNetwork === 'ATL'))) {
              finalPaymentDetails = {
                phone: sellerMobileMoney.phone,
                network: sellerMobileMoney.network,
                accountName: sellerMobileMoney.accountName || seller.name || seller.shopName,
              };
            } else {
              return next(new AppError(`No ${provider} mobile money payment method found. Please add a payment method first.`, 400));
            }
          } else {
            return next(new AppError(`No ${provider} mobile money payment method found. Please add a payment method first.`, 400));
          }
        }
      } else {
        // No user account found, fallback to seller's saved payment methods
        if (seller.paymentMethods?.mobileMoney && Object.keys(finalPaymentDetails).length === 0) {
          const sellerMobileMoney = seller.paymentMethods.mobileMoney;
          const sellerNetwork = sellerMobileMoney.network?.toUpperCase();
          if (sellerNetwork === provider || 
              (provider === 'MTN' && sellerNetwork === 'MTN') ||
              (provider === 'Vodafone' && (sellerNetwork === 'VODAFONE' || sellerNetwork === 'VOD')) ||
              (provider === 'AirtelTigo' && (sellerNetwork === 'AIRTELTIGO' || sellerNetwork === 'ATL'))) {
            finalPaymentDetails = {
              phone: sellerMobileMoney.phone,
              network: sellerMobileMoney.network,
              accountName: sellerMobileMoney.accountName || seller.name || seller.shopName,
            };
          } else {
            return next(new AppError(`No ${provider} mobile money payment method found. Please add a payment method first.`, 400));
          }
        } else {
          return next(new AppError(`No ${provider} mobile money payment method found. Please add a payment method first.`, 400));
        }
      }
    } else {
      // Payment details were provided, use them but ensure network/provider is set
      if (!finalPaymentDetails.network && provider) {
        finalPaymentDetails.network = provider;
      }
    }

    // Validate that phone number exists
    if (!finalPaymentDetails.phone && !finalPaymentDetails.mobileNumber) {
      return next(new AppError('Mobile money phone number is required', 400));
    }
  }

  // Deduct the withdrawal amount immediately from seller's balance
  seller.balance -= amount;
  seller.calculateWithdrawableBalance();
  await seller.save();

  // Create payment request (using PaymentRequest model)
  const paymentRequest = await PaymentRequest.create({
    seller: sellerId,
    amount,
    paymentMethod: paymentMethod, // Use paymentMethod instead of payoutMethod
    paymentDetails: finalPaymentDetails,
    status: 'pending',
    currency: 'GHS',
  });

  // Log activity
  logActivityAsync({
    userId: sellerId,
    role: 'seller',
    action: 'WITHDRAWAL_REQUEST',
    description: `Seller requested withdrawal of GH₵${amount.toFixed(2)} via ${payoutMethod}`,
    req,
    metadata: {
      withdrawalRequestId: paymentRequest._id,
      amount,
      payoutMethod,
    },
  });

  res.status(201).json({
    status: 'success',
    message: 'Withdrawal request created successfully',
    data: {
      withdrawalRequest: paymentRequest, // Return as withdrawalRequest for compatibility
      paymentRequest, // Also include as paymentRequest
    },
  });
});

/**
 * Get seller's withdrawal requests
 * GET /api/v1/seller/payout/requests
 * Query params:
 *   - status: Filter by status (pending, approved, processing, paid, failed, rejected, cancelled)
 *   - limit: Number of results per page (default: 20, use 0 or 'all' to get all)
 *   - page: Page number (default: 1, ignored if limit is 0 or 'all')
 */
exports.getSellerWithdrawalRequests = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const { status, limit = 20, page = 1 } = req.query;

  const query = { 
    seller: sellerId,
    isActive: true, // Only show active withdrawals to seller
  };
  if (status) {
    query.status = status;
  }

  // Check if user wants all records (no pagination)
  const getAll = limit === '0' || limit === 'all' || limit === 0;
  const limitNum = getAll ? null : parseInt(limit);
  const skip = getAll ? 0 : (parseInt(page) - 1) * limitNum;

  // Build query
  let withdrawalQuery = PaymentRequest.find(query).sort('-createdAt');
  
  if (!getAll) {
    withdrawalQuery = withdrawalQuery.limit(limitNum).skip(skip);
  }

  const withdrawalRequests = await withdrawalQuery.lean();
  const total = await PaymentRequest.countDocuments(query);
  
  // Transform PaymentRequest to include payoutMethod for compatibility
  const transformedRequests = withdrawalRequests.map((req) => ({
    ...req,
    payoutMethod: req.paymentMethod, // Map paymentMethod to payoutMethod
  }));

  res.status(200).json({
    status: 'success',
    results: transformedRequests.length,
    total,
    page: getAll ? 1 : parseInt(page),
    limit: getAll ? total : limitNum,
    hasMore: getAll ? false : skip + transformedRequests.length < total,
    data: {
      withdrawalRequests: transformedRequests,
    },
  });
});

/**
 * Get seller's wallet balance
 * GET /api/v1/seller/payout/balance
 */
exports.getSellerBalance = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;

  const seller = await Seller.findById(sellerId).select('balance lockedBalance pendingBalance lockedReason lockedBy lockedAt paystackRecipientCode withdrawableBalance');
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Calculate total withdrawals (sum of all paid/approved withdrawal requests)
  const totalWithdrawals = await PaymentRequest.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['paid', 'approved', 'success'] }, // Only count successful withdrawals
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
      },
    },
  ]);

  const totalWithdrawn = totalWithdrawals.length > 0 ? totalWithdrawals[0].total : 0;

  // Ensure withdrawableBalance is calculated correctly
  seller.calculateWithdrawableBalance();
  
  // Explicitly ensure withdrawableBalance is set correctly (double-check)
  const calculatedWithdrawable = Math.max(0, (seller.balance || 0) - (seller.lockedBalance || 0) - (seller.pendingBalance || 0));
  if (Math.abs((seller.withdrawableBalance || 0) - calculatedWithdrawable) > 0.01) {
    // Only save if there's a significant discrepancy (more than 1 cent)
    seller.withdrawableBalance = calculatedWithdrawable;
    await seller.save({ validateBeforeSave: false }); // Save without full validation to prevent loops
    console.log(`[getSellerBalance] Corrected withdrawableBalance for seller ${sellerId}: ${seller.withdrawableBalance}`);
  }

  console.log(`[getSellerBalance] Seller ${sellerId} balance data:`, {
    balance: seller.balance,
    lockedBalance: seller.lockedBalance, // Funds locked by admin due to disputes/issues
    pendingBalance: seller.pendingBalance, // Funds in withdrawal requests awaiting approval/OTP
    withdrawableBalance: seller.withdrawableBalance,
    totalWithdrawn, // Total amount withdrawn by seller
    calculatedWithdrawable,
  });

  res.status(200).json({
    status: 'success',
    data: {
      balance: seller.balance || 0, // Total balance from seller model
      lockedBalance: seller.lockedBalance || 0, // Funds locked by admin due to disputes/issues
      pendingBalance: seller.pendingBalance || 0, // Funds in withdrawal requests awaiting approval/OTP
      withdrawableBalance: seller.withdrawableBalance || 0, // Available balance
      availableBalance: seller.withdrawableBalance || 0, // Alias for backward compatibility
      totalWithdrawn: totalWithdrawn || 0, // Total amount withdrawn by seller (all time)
      lockedReason: seller.lockedReason, // Reason for admin lock (dispute/issue)
      lockedBy: seller.lockedBy, // Admin who locked the funds
      lockedAt: seller.lockedAt, // When funds were locked
      paystackRecipientCode: seller.paystackRecipientCode,
      // Verification: lockedBalance + pendingBalance + withdrawableBalance = balance
    },
  });
});

/**
 * Cancel a withdrawal request
 * Only allows canceling if status is "pending"
 * PATCH /api/v1/seller/payout/request/:id/cancel
 */
exports.cancelWithdrawalRequest = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const { id } = req.params;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const withdrawalRequest = await PaymentRequest.findOne({
      _id: id,
      seller: sellerId,
    }).session(session);

    if (!withdrawalRequest) {
      await session.abortTransaction();
      return next(new AppError('Withdrawal request not found', 404));
    }

    // Only allow canceling if status is "pending"
    if (withdrawalRequest.status !== 'pending') {
      await session.abortTransaction();
      return next(
        new AppError('You cannot cancel this withdrawal after admin approval.', 400)
      );
    }

    // Get seller
    const seller = await Seller.findById(sellerId).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // Deduct amount from pendingBalance when withdrawal is cancelled
    const amount = withdrawalRequest.amount || 0;
    const oldPendingBalance = seller.pendingBalance || 0;
    
    if (amount > oldPendingBalance) {
      await session.abortTransaction();
      return next(new AppError('Insufficient pending balance. Please contact support.', 400));
    }
    
    seller.pendingBalance = Math.max(0, oldPendingBalance - amount);
    seller.calculateWithdrawableBalance();
    await seller.save({ session });
    
    console.log(`[cancelWithdrawalRequest] Pending balance deduction for seller ${sellerId}:`);
    console.log(`  Pending Balance: ${oldPendingBalance} - ${amount} = ${seller.pendingBalance}`);
    console.log(`  Withdrawable Balance: ${seller.withdrawableBalance}`);

    // Update payment request status (PaymentRequest doesn't have 'cancelled', use 'rejected')
    withdrawalRequest.status = 'rejected';
    withdrawalRequest.rejectionReason = 'Cancelled by seller';
    await withdrawalRequest.save({ session });

    // Create a "refund" transaction record
    const transaction = await Transaction.create(
      [
        {
          seller: sellerId,
          amount: withdrawalRequest.amount,
          type: 'credit',
          description: `Withdrawal Request Cancelled - Refund for Request #${withdrawalRequest._id}`,
          status: 'completed',
          metadata: {
            withdrawalRequestId: withdrawalRequest._id,
            action: 'cancellation_refund',
            cancelledAt: new Date(),
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Withdrawal request cancelled successfully',
      data: {
        withdrawalRequest,
        transaction: transaction[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[cancelWithdrawalRequest] Error:', error);
    
    if (error instanceof AppError) {
      return next(error);
    }
    
    return next(new AppError('Failed to cancel withdrawal request', 500));
  } finally {
    session.endSession();
  }
});

/**
 * Delete a withdrawal request
 * Only allows deletion if status is "pending", "cancelled", or "rejected"
 * DELETE /api/v1/seller/payout/request/:id
 */
exports.deleteWithdrawalRequest = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const { id } = req.params;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const withdrawalRequest = await PaymentRequest.findOne({
      _id: id,
      seller: sellerId,
    }).session(session);

    if (!withdrawalRequest) {
      await session.abortTransaction();
      return next(new AppError('Withdrawal request not found', 404));
    }

    // Only allow deletion if status is "pending" (not approved/rejected/paid)
    if (withdrawalRequest.status !== 'pending') {
      await session.abortTransaction();
      return next(
        new AppError(
          'Withdrawal cannot be deleted after admin approval.',
          400
        )
      );
    }

    // Get seller
    const seller = await Seller.findById(sellerId).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // Refund the amount back to seller balance (only for pending withdrawals)
    // When creating request: balance -= amount, lockedBalance += amount
    // When cancelling: balance += amount, lockedBalance -= amount
    seller.balance += withdrawalRequest.amount;
    seller.lockedBalance = Math.max(0, seller.lockedBalance - withdrawalRequest.amount); // Prevent negative lockedBalance
    seller.calculateWithdrawableBalance();
    await seller.save({ session });

    // Create a "refund" transaction record
    await Transaction.create(
      [
        {
          seller: sellerId,
          amount: withdrawalRequest.amount,
          type: 'credit',
          description: `Withdrawal Request Deactivated - Refund for Request #${withdrawalRequest._id}`,
          status: 'completed',
          metadata: {
            withdrawalRequestId: withdrawalRequest._id,
            action: 'deactivation_refund',
            deactivatedAt: new Date(),
          },
        },
      ],
      { session }
    );

    // Deactivate the payment request instead of deleting it
    withdrawalRequest.isActive = false;
    withdrawalRequest.deactivatedAt = new Date();
    await withdrawalRequest.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Withdrawal request deactivated successfully',
      data: null,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[deleteWithdrawalRequest] Error:', error);
    
    if (error instanceof AppError) {
      return next(error);
    }
    
    return next(new AppError('Failed to delete withdrawal request', 500));
  } finally {
    session.endSession();
  }
});

/**
 * Submit PIN for mobile money transfer
 * POST /api/v1/seller/payout/request/:id/submit-pin
 */
exports.submitTransferPin = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const { id } = req.params;
  const { pin } = req.body;

  // Validate input
  if (!pin) {
    return next(new AppError('PIN is required', 400));
  }

  // Validate PIN format (should be numeric, typically 4-6 digits)
  if (!/^\d{4,6}$/.test(pin)) {
    return next(new AppError('PIN must be 4-6 digits', 400));
  }

  // Find payment request
  const withdrawalRequest = await PaymentRequest.findOne({
    _id: id,
    seller: sellerId,
  });

  if (!withdrawalRequest) {
    return next(new AppError('Withdrawal request not found', 404));
  }

  // Check if PIN is required (for mobile money transfers)
  const isMobileMoney = ['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(
    withdrawalRequest.paymentMethod
  );
  
  // Check if PIN is required - use requiresPin field or check if it's mobile money
  const requiresPin = withdrawalRequest.requiresPin !== undefined 
    ? withdrawalRequest.requiresPin 
    : (isMobileMoney ? true : false);
  
  if (!requiresPin) {
    return next(new AppError('This withdrawal request does not require a PIN', 400));
  }

  // Check if PIN has already been submitted
  if (withdrawalRequest.pinSubmitted) {
    return next(new AppError('PIN has already been submitted for this withdrawal', 400));
  }

  // Check if payment request has transfer code
  if (!withdrawalRequest.paystackTransferCode) {
    return next(new AppError('Transfer code not found. Please contact support.', 400));
  }

  // Check if payment request is in processing status (or pending for mobile money)
  if (withdrawalRequest.status !== 'processing' && withdrawalRequest.status !== 'pending') {
    return next(new AppError('This withdrawal request is not awaiting PIN submission', 400));
  }

  try {
    // Submit PIN to Paystack
    const result = await payoutService.submitTransferPin(
      withdrawalRequest.paystackTransferCode,
      pin
    );

    // Update payment request
    withdrawalRequest.pinSubmitted = true;
    
    // Update status based on result
    if (result.status === 'success') {
      withdrawalRequest.status = 'paid';
    } else if (result.status === 'failed') {
      withdrawalRequest.status = 'failed';
    }
    
    // Update metadata with PIN submission details
    withdrawalRequest.metadata = {
      ...(withdrawalRequest.metadata || {}),
      pinSubmittedAt: new Date(),
      pinSubmissionResult: result.status,
    };

    await withdrawalRequest.save();

    // If transfer is successful, update transaction status
    if (result.status === 'success' && withdrawalRequest.transaction) {
      const transaction = await Transaction.findById(withdrawalRequest.transaction);
      if (transaction) {
        transaction.status = 'completed';
        await transaction.save();
      }
    }

    res.status(200).json({
      status: 'success',
      message: result.status === 'success' 
        ? 'PIN submitted successfully. Transfer completed.' 
        : 'PIN submitted. Transfer is being processed.',
      data: {
        withdrawalRequest,
        transferStatus: result.status,
      },
    });
  } catch (error) {
    console.error('[submitTransferPin] Error:', error);
    
    if (error instanceof AppError) {
      return next(error);
    }
    
    return next(new AppError(error.message || 'Failed to submit PIN', 500));
  }
});

/**
 * Verify OTP for Paystack transfer
 * POST /api/v1/seller/payout/request/:id/verify-otp
 */
exports.verifyOtp = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { otp } = req.body;
  const sellerId = req.user.id;

  // Validate input
  if (!otp || otp.length !== 6) {
    return next(new AppError('Please provide a valid 6-digit OTP', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find withdrawal request (try PaymentRequest first, then WithdrawalRequest)
    let withdrawalRequest = await PaymentRequest.findById(id).session(session);
    let isPaymentRequest = true;

    if (!withdrawalRequest) {
      const WithdrawalRequest = require('../../models/payout/withdrawalRequestModel');
      withdrawalRequest = await WithdrawalRequest.findById(id).session(session);
      isPaymentRequest = false;
    }

    if (!withdrawalRequest) {
      await session.abortTransaction();
      return next(new AppError('Withdrawal request not found', 404));
    }

    // Security: Verify seller owns this withdrawal
    const requestSellerId = withdrawalRequest.seller?._id 
      ? withdrawalRequest.seller._id.toString() 
      : withdrawalRequest.seller?.toString() || String(withdrawalRequest.seller);
    
    if (requestSellerId !== sellerId.toString()) {
      await session.abortTransaction();
      return next(new AppError('You are not authorized to verify this withdrawal', 403));
    }

    // Check if withdrawal is in correct status
    if (withdrawalRequest.status !== 'awaiting_paystack_otp' && withdrawalRequest.status !== 'processing') {
      await session.abortTransaction();
      return next(
        new AppError(
          `This withdrawal is not awaiting OTP verification. Current status: ${withdrawalRequest.status}`,
          400
        )
      );
    }

    // Check if transfer code exists
    const transferCode = withdrawalRequest.paystackTransferCode;
    if (!transferCode) {
      await session.abortTransaction();
      return next(new AppError('Transfer code not found. Please contact support.', 400));
    }

    // Get Paystack secret key
    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      await session.abortTransaction();
      return next(new AppError('Paystack is not configured. Please contact support.', 500));
    }

    // Call Paystack to finalize transfer with OTP
    const axios = require('axios');
    let paystackResponse;
    try {
      paystackResponse = await axios.post(
        'https://api.paystack.co/transfer/finalize_transfer',
        {
          transfer_code: transferCode,
          otp: otp,
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (paystackError) {
      await session.abortTransaction();
      const paystackMessage = paystackError.response?.data?.message || paystackError.message || 'Failed to verify OTP with Paystack';
      const paystackData = paystackError.response?.data;
      
      console.error('[verifyOtp] Paystack error:', {
        message: paystackMessage,
        status: paystackError.response?.status,
        data: paystackData,
      });

      // Check if OTP is expired
      const isExpired = paystackMessage.toLowerCase().includes('expired') || 
                       paystackMessage.toLowerCase().includes('expire') ||
                       paystackData?.message?.toLowerCase().includes('expired') ||
                       paystackData?.message?.toLowerCase().includes('expire');
      
      // Check if OTP is invalid
      const isInvalid = paystackMessage.toLowerCase().includes('invalid') || 
                       paystackMessage.toLowerCase().includes('incorrect') ||
                       paystackData?.message?.toLowerCase().includes('invalid') ||
                       paystackData?.message?.toLowerCase().includes('incorrect');

      let errorMessage = paystackMessage;
      let errorCode = 'OTP_ERROR';
      
      if (isExpired) {
        errorMessage = 'OTP has expired. Please click "Resend PIN" to receive a new OTP.';
        errorCode = 'OTP_EXPIRED';
      } else if (isInvalid) {
        errorMessage = 'Invalid OTP. Please check and try again, or click "Resend PIN" to receive a new OTP.';
        errorCode = 'OTP_INVALID';
      }

      const error = new AppError(errorMessage, paystackError.response?.status || 400);
      error.code = errorCode;
      error.isExpired = isExpired;
      error.isInvalid = isInvalid;
      return next(error);
    }

    // Check Paystack response
    if (!paystackResponse.data || paystackResponse.data.status !== true) {
      await session.abortTransaction();
      const errorMessage = paystackResponse.data?.message || 'OTP verification failed';
      return next(new AppError(errorMessage, 400));
    }

    const transferData = paystackResponse.data.data;

    // Get seller to update pendingBalance
    const seller = await Seller.findById(sellerId).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // Deduct amount from pendingBalance AND balance when OTP is verified
    // This is when the withdrawal is actually finalized and money leaves the account
    const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
    const withholdingTax = withdrawalRequest.withholdingTax || 0;
    const amountPaidToSeller = withdrawalRequest.amountPaidToSeller || (amountRequested - withholdingTax);
    
    const oldBalance = seller.balance || 0;
    const oldPendingBalance = seller.pendingBalance || 0;
    const oldLockedBalance = seller.lockedBalance || 0;
    
    // Validate pending balance has the full requested amount (before withholding tax)
    if (amountRequested > oldPendingBalance) {
      await session.abortTransaction();
      return next(new AppError('Insufficient pending balance. Please contact support.', 400));
    }
    
    // Deduct full requested amount from pendingBalance (funds no longer pending)
    seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
    
    // Deduct full requested amount from balance (total revenue) - money actually leaves the account
    // Note: Withholding tax is already tracked in TaxCollection, so we deduct the full amount
    seller.balance = Math.max(0, oldBalance - amountRequested);
    
    // Update withdrawal request with final balance information
    withdrawalRequest.sellerBalanceAfter = seller.balance;
    
    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    await seller.save({ session });
    
    console.log(`[verifyOtp] Withdrawal finalized for seller ${sellerId}:`);
    console.log(`  Amount Requested: ${amountRequested}`);
    console.log(`  Withholding Tax: ${withholdingTax} (${(withdrawalRequest.withholdingTaxRate || 0) * 100}%)`);
    console.log(`  Amount Paid to Seller: ${amountPaidToSeller}`);
    console.log(`  Total Revenue (Balance): ${oldBalance} - ${amountRequested} = ${seller.balance} (deducted)`);
    console.log(`  Pending Balance: ${oldPendingBalance} - ${amountRequested} = ${seller.pendingBalance} (deducted)`);
    console.log(`  Locked Balance: ${oldLockedBalance} (unchanged)`);
    console.log(`  Available Balance: ${seller.withdrawableBalance} (recalculated)`);

    // Update withdrawal request status
    withdrawalRequest.status = 'approved';
    withdrawalRequest.pinSubmitted = true;
    withdrawalRequest.paidAt = new Date();
    
    // Update Paystack metadata
    if (!withdrawalRequest.metadata) {
      withdrawalRequest.metadata = {};
    }
    withdrawalRequest.metadata.otpVerifiedAt = new Date();
    withdrawalRequest.metadata.paystackFinalizeResponse = transferData;

    await withdrawalRequest.save({ session });

    // Update transaction status if exists
    if (withdrawalRequest.transaction) {
      const transaction = await Transaction.findById(withdrawalRequest.transaction).session(session);
      if (transaction) {
        transaction.status = 'completed';
        await transaction.save({ session });
      }
    }

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId: sellerId,
      role: 'seller',
      action: 'WITHDRAWAL_OTP_VERIFIED',
      description: `Seller verified OTP for withdrawal request #${withdrawalRequest._id} - Amount: GH₵${withdrawalRequest.amount}`,
      req,
      metadata: {
        withdrawalRequestId: withdrawalRequest._id,
        amount: withdrawalRequest.amount,
        transferCode: transferCode,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully. Your withdrawal is being processed.',
      data: {
        withdrawalRequest,
        transferStatus: transferData.status,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[verifyOtp] Error:', error);
    
    if (error instanceof AppError) {
      return next(error);
    }
    
    return next(new AppError(error.message || 'Failed to verify OTP', 500));
  } finally {
    session.endSession();
  }
});

/**
 * Resend OTP for Paystack transfer
 * POST /api/v1/seller/payout/request/:id/resend-otp
 * 
 * Paystack API only accepts these reasons:
 * 1. 'transfer' - Resend OTP for transfer (default, most common)
 * 2. 'disable_otp' - Disable OTP requirement (not used for resending)
 * 
 * Note: We map our internal reasons to Paystack's 'transfer' reason
 * Internal reasons tracked: 'expired', 'not_received', 'incorrect', 'resend_otp'
 * 
 * Body (optional): { reason: 'transfer' | 'disable_otp' }
 */
exports.resendOtp = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const sellerId = req.user.id;

  try {
    // Find withdrawal request (try PaymentRequest first, then WithdrawalRequest)
    let withdrawalRequest = await PaymentRequest.findById(id);
    let isPaymentRequest = true;

    if (!withdrawalRequest) {
      const WithdrawalRequest = require('../../models/payout/withdrawalRequestModel');
      withdrawalRequest = await WithdrawalRequest.findById(id);
      isPaymentRequest = false;
    }

    if (!withdrawalRequest) {
      return next(new AppError('Withdrawal request not found', 404));
    }

    // Security: Verify seller owns this withdrawal
    const requestSellerId = withdrawalRequest.seller?._id 
      ? withdrawalRequest.seller._id.toString() 
      : withdrawalRequest.seller?.toString() || String(withdrawalRequest.seller);
    
    if (requestSellerId !== sellerId.toString()) {
      return next(new AppError('You are not authorized to resend OTP for this withdrawal', 403));
    }

    // Check if withdrawal is in correct status
    if (withdrawalRequest.status !== 'awaiting_paystack_otp' && withdrawalRequest.status !== 'processing') {
      return next(
        new AppError(
          `Cannot resend OTP. Current status: ${withdrawalRequest.status}`,
          400
        )
      );
    }

    // Check if transfer code exists
    const transferCode = withdrawalRequest.paystackTransferCode;
    if (!transferCode) {
      return next(new AppError('Transfer code not found. Please contact support.', 400));
    }

    // Get Paystack secret key
    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      return next(new AppError('Paystack is not configured. Please contact support.', 500));
    }

    // Get reason from request body (optional, defaults to 'transfer')
    // Paystack API only accepts: 'disable_otp' or 'transfer'
    // We use 'transfer' for resending OTP (most common case)
    // 'disable_otp' would disable OTP requirement (not used for resending)
    const { reason = 'transfer' } = req.body;
    
    // Validate reason - Paystack only accepts 'disable_otp' or 'transfer'
    const validReasons = ['disable_otp', 'transfer'];
    const finalReason = validReasons.includes(reason) ? reason : 'transfer';

    // Call Paystack to resend OTP
    const axios = require('axios');
    let paystackResponse;
    try {
      paystackResponse = await axios.post(
        'https://api.paystack.co/transfer/resend_otp',
        {
          transfer_code: transferCode,
          reason: finalReason,
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (paystackError) {
      const errorMessage = paystackError.response?.data?.message || paystackError.message || 'Failed to resend OTP';
      console.error('[resendOtp] Paystack error:', {
        message: errorMessage,
        status: paystackError.response?.status,
        data: paystackError.response?.data,
      });
      return next(new AppError(errorMessage, paystackError.response?.status || 400));
    }

    // Check Paystack response
    if (!paystackResponse.data || paystackResponse.data.status !== true) {
      const errorMessage = paystackResponse.data?.message || 'Failed to resend OTP';
      return next(new AppError(errorMessage, 400));
    }

    // Update metadata (don't change status)
    if (!withdrawalRequest.metadata) {
      withdrawalRequest.metadata = {};
    }
    const resendHistory = withdrawalRequest.metadata.otpResendHistory || [];
    
    // Store internal reason (from request body) for tracking, even though Paystack uses 'transfer'
    const internalReason = req.body.reason || 'transfer';
    
    resendHistory.push({
      paystackReason: finalReason, // 'transfer' or 'disable_otp' (what we sent to Paystack)
      internalReason: internalReason, // Original reason from request (for our tracking)
      resentAt: new Date(),
      requestedBy: sellerId,
    });
    withdrawalRequest.metadata.lastOtpResentAt = new Date();
    withdrawalRequest.metadata.otpResendHistory = resendHistory;
    withdrawalRequest.metadata.lastResendReason = finalReason;
    withdrawalRequest.metadata.lastInternalReason = internalReason;
    await withdrawalRequest.save();

    // Log activity
    logActivityAsync({
      userId: sellerId,
      role: 'seller',
      action: 'WITHDRAWAL_OTP_RESENT',
      description: `Seller requested OTP resend for withdrawal request #${withdrawalRequest._id}`,
      req,
      metadata: {
        withdrawalRequestId: withdrawalRequest._id,
        amount: withdrawalRequest.amount,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'OTP has been resent to your phone/email.',
      data: {
        withdrawalRequest,
      },
    });
  } catch (error) {
    console.error('[resendOtp] Error:', error);
    
    if (error instanceof AppError) {
      return next(error);
    }
    
    return next(new AppError(error.message || 'Failed to resend OTP', 500));
  }
});

