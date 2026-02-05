/**
 * Seller Payout Controller
 * Handles seller withdrawal requests
 */

const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const Seller = require('../../models/user/sellerModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const Transaction = require('../../models/transaction/transactionModel');
const PaymentMethod = require('../../models/payment/PaymentMethodModel');
const User = require('../../models/user/userModel');
const payoutService = require('../../services/payoutService');
const mongoose = require('mongoose');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const { logSellerRevenue } = require('../../services/historyLogger');
const { sendPaymentNotification } = require('../../utils/helpers/notificationService');

// createWithdrawalRequest has been removed - use createPaymentRequest from paymentController instead
// Both endpoints now use the same service function (paymentRequestService.createPaymentRequest)

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

  const seller = await Seller.findById(sellerId).select('balance lockedBalance pendingBalance lockedReason lockedBy lockedAt paystackRecipientCode withdrawableBalance paymentMethods');
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Calculate total withdrawals (sum of all paid/approved withdrawal requests)
  // Use amountRequested if available (the actual amount that left the account), otherwise use amount
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
        total: {
          $sum: {
            $ifNull: ['$amountRequested', '$amount'] // Use amountRequested if available, fallback to amount
          }
        },
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
    logger.info(`[getSellerBalance] Corrected withdrawableBalance for seller ${sellerId}: ${seller.withdrawableBalance}`);
  }

  // Calculate total revenue: balance (current) + totalWithdrawn (all time)
  // This represents all earnings from delivered orders
  const totalRevenue = (seller.balance || 0) + (totalWithdrawn || 0);

  // Calculate available balance for verification
  const calculatedAvailableBalance = seller.withdrawableBalance || 0;

  // Verification checks
  const balanceCheck = Math.abs((seller.balance || 0) - ((seller.withdrawableBalance || 0) + (seller.lockedBalance || 0) + (seller.pendingBalance || 0)));
  const revenueCheck = totalRevenue >= calculatedAvailableBalance; // Available balance should never exceed total revenue

  logger.info(`[getSellerBalance] Seller ${sellerId} balance data:`, {
    balance: seller.balance,
    lockedBalance: seller.lockedBalance, // Funds locked by admin due to disputes/issues
    pendingBalance: seller.pendingBalance, // Funds in withdrawal requests awaiting approval/OTP
    withdrawableBalance: seller.withdrawableBalance,
    availableBalance: calculatedAvailableBalance,
    totalWithdrawn, // Total amount withdrawn by seller
    totalRevenue, // Total revenue (balance + totalWithdrawn)
    calculatedWithdrawable,
    // Verification checks
    balanceCheck: balanceCheck < 0.01 ? '✅ PASS' : `❌ FAIL (diff: ${balanceCheck.toFixed(2)})`,
    revenueCheck: revenueCheck ? '✅ PASS' : `❌ FAIL (available: ${calculatedAvailableBalance}, revenue: ${totalRevenue})`,
    // Verification: totalRevenue = balance + totalWithdrawn
    // Verification: balance = withdrawableBalance + lockedBalance + pendingBalance
    // Verification: availableBalance <= totalRevenue (available should never exceed total revenue)
  });

  // Warn if available balance exceeds total revenue (should never happen)
  if (!revenueCheck) {
    logger.warn(`[getSellerBalance] ⚠️ WARNING: Available balance (${calculatedAvailableBalance}); exceeds total revenue (${totalRevenue}) for seller ${sellerId}`);
    logger.warn(`[getSellerBalance] This indicates a data inconsistency. Balance: ${seller.balance}, Total Withdrawn: ${totalWithdrawn}`);
  }

  res.status(200).json({
    status: 'success',
    data: {
      balance: seller.balance || 0, // Total balance from seller model (current available + locked + pending)
      lockedBalance: seller.lockedBalance || 0, // Funds locked by admin due to disputes/issues
      pendingBalance: seller.pendingBalance || 0, // Funds in withdrawal requests awaiting approval/OTP
      withdrawableBalance: seller.withdrawableBalance || 0, // Available balance (can be withdrawn)
      availableBalance: seller.withdrawableBalance || 0, // Alias for backward compatibility
      totalWithdrawn: totalWithdrawn || 0, // Total amount withdrawn by seller (all time)
      totalRevenue: totalRevenue || 0, // Total revenue = balance + totalWithdrawn (all earnings from delivered orders)
      lockedReason: seller.lockedReason, // Reason for admin lock (dispute/issue)
      lockedBy: seller.lockedBy, // Admin who locked the funds
      lockedAt: seller.lockedAt, // When funds were locked
      paystackRecipientCode: seller.paystackRecipientCode,
      payoutStatus: (() => {
        const { hasVerifiedPayoutMethod } = require('../../utils/helpers/paymentMethodHelpers');
        const payoutCheck = hasVerifiedPayoutMethod(seller);
        return payoutCheck.hasVerified ? 'verified' : (payoutCheck.allRejected ? 'rejected' : 'pending');
      })(), // Payout verification status (computed from individual payment methods)
      payoutRejectionReason: seller.payoutRejectionReason || null, // Reason if payout was rejected
      // Verification: totalRevenue = balance + totalWithdrawn
      // Verification: balance = withdrawableBalance + lockedBalance + pendingBalance
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

    logger.info(`[cancelWithdrawalRequest] Pending balance deduction for seller ${sellerId}:`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${amount} = ${seller.pendingBalance}`);
    logger.info(`  Withdrawable Balance: ${seller.withdrawableBalance}`);

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
    logger.error('[cancelWithdrawalRequest] Error:', error);

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

    // CRITICAL FIX: Refund from pendingBalance, not balance/lockedBalance
    // When withdrawal is created: pendingBalance += amount (balance unchanged)
    // When withdrawal is deleted: pendingBalance -= amount (balance unchanged)
    const amount = withdrawalRequest.amount || 0;
    const oldPendingBalance = seller.pendingBalance || 0;
    const oldBalance = seller.balance || 0;

    // Validate pendingBalance has the amount
    if (amount > oldPendingBalance) {
      logger.warn(`[deleteWithdrawalRequest] Pending balance (${oldPendingBalance}); is less than requested amount (${amount}). Proceeding with refund anyway.`);
    }

    // Refund from pendingBalance (the amount was moved to pendingBalance when request was created)
    seller.pendingBalance = Math.max(0, oldPendingBalance - amount);

    // Balance should NOT be modified - it was never deducted
    // Only pendingBalance is refunded, which increases available balance

    seller.calculateWithdrawableBalance();
    await seller.save({ session });

    logger.info(`[deleteWithdrawalRequest] Pending balance refund for seller ${sellerId}:`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${amount} = ${seller.pendingBalance}`);
    logger.info(`  Total Balance: ${oldBalance} (unchanged);`);
    logger.info(`  Available Balance: ${seller.withdrawableBalance}`);

    // Log finance audit
    try {
      const financeAudit = require('../../services/financeAuditService');
      await financeAudit.logWithdrawalRefunded(
        sellerId,
        amount,
        withdrawalRequest._id,
        oldPendingBalance,
        seller.pendingBalance,
        'Cancelled by seller'
      );
    } catch (auditError) {
      logger.error('[deleteWithdrawalRequest] Failed to log finance audit (non-critical);:', auditError);
    }

    // Log seller revenue history for withdrawal cancellation/refund
    // Note: This is a pendingBalance refund, not a balance refund
    try {
      await logSellerRevenue({
        sellerId: sellerId,
        amount: 0, // No balance change - only pendingBalance refund
        type: 'REVERSAL',
        description: `Withdrawal request cancelled - PendingBalance refund: GH₵${amount.toFixed(2)}`,
        reference: `WITHDRAWAL-CANCEL-${withdrawalRequest._id}-${Date.now()}`,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance, // Balance unchanged
        metadata: {
          withdrawalRequestId: withdrawalRequest._id.toString(),
          action: 'deactivation_refund',
          originalAmount: amount,
          pendingBalanceBefore: oldPendingBalance,
          pendingBalanceAfter: seller.pendingBalance,
          refundType: 'pendingBalance_refund', // Indicates this is a pendingBalance refund
        },
      });
      logger.info(`[deleteWithdrawalRequest] ✅ Seller revenue history logged for withdrawal cancellation - seller ${sellerId}`);
    } catch (historyError) {
      logger.error(`[deleteWithdrawalRequest] Failed to log seller revenue history (non-critical); for seller ${sellerId}:`, {
        error: historyError.message,
        stack: historyError.stack,
      });
    }

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
    logger.error('[deleteWithdrawalRequest] Error:', error);

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
    logger.error('[submitTransferPin] Error:', error);

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
  // Initial diagnostic logging
  logger.info("🚀 VERIFY OTP CONTROLLER HIT:", {
    withdrawalId: req.params.id,
    sellerId: req.user?.id,
    body: req.body
  });

  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('[verifyOtp] 🔍 FULL DEBUG: verifyOtp controller called');
  logger.info('═══════════════════════════════════════════════════════════');

  const { id } = req.params;
  const { otp } = req.body;

  logger.info('[verifyOtp] Request Parameters:', {
    withdrawalId: id,
    otpLength: otp ? otp.length : 0,
    otpPrefix: otp ? otp.substring(0, 2) + '****' : 'missing'
  });

  logger.info('[verifyOtp] Request Headers:', {
    authorization: req.headers.authorization ? 'present (length: ' + req.headers.authorization.length + ')' : 'missing',
    cookie: req.headers.cookie ? 'present (length: ' + req.headers.cookie.length + ')' : 'missing',
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50) + '...'
  });

  logger.info('[verifyOtp] Request Cookies:', {
    hasCookies: !!req.cookies,
    cookieKeys: req.cookies ? Object.keys(req.cookies) : 'none',
    seller_jwt: req.cookies?.seller_jwt ? 'present (length: ' + req.cookies.seller_jwt.length + ')' : 'missing',
    main_jwt: req.cookies?.main_jwt ? 'present' : 'missing',
    admin_jwt: req.cookies?.admin_jwt ? 'present' : 'missing'
  });

  logger.info('[verifyOtp] Request User (req.user);:', {
    hasUser: !!req.user,
    userId: req.user?.id,
    userRole: req.user?.role,
    userEmail: req.user?.email || req.user?.phone,
    userObject: req.user ? {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
      phone: req.user.phone
    } : 'null'
  });

  // CRITICAL: Check if req.user exists (authentication check)
  if (!req.user || !req.user.id) {
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('[verifyOtp] ❌ AUTHENTICATION ERROR: req.user is missing');
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('[verifyOtp] This means protectSeller middleware failed or did not run');
    logger.error('[verifyOtp] Request details:', {
      path: req.path,
      originalUrl: req.originalUrl,
      method: req.method,
      headers: {
        authorization: req.headers.authorization ? 'present' : 'missing',
        cookie: req.headers.cookie ? 'present' : 'missing'
      },
      cookies: req.cookies ? Object.keys(req.cookies) : 'none',
      hasUser: !!req.user
    });
    logger.error('[verifyOtp] 🛑 RETURNING 401 - Authentication failed');
    logger.error('═══════════════════════════════════════════════════════════');
    return next(new AppError('You are not authenticated. Please log in to get access.', 401));
  }

  const sellerId = req.user.id;

  logger.info('[verifyOtp] ✅ Authentication successful:', {
    sellerId: sellerId,
    sellerRole: req.user.role,
    sellerEmail: req.user.email || req.user.phone
  });
  logger.info('[verifyOtp] Request details:', {
    withdrawalId: id,
    otpLength: otp ? otp.length : 0,
    sellerId: sellerId
  });

  // Validate input - return 400 (Bad Request) for validation errors, NOT 401
  if (!otp || String(otp).length !== 6) {
    logger.warn(`[verifyOtp] ⚠️ Validation error - Invalid OTP format: length=${otp ? String(otp).length : 0}`);
    return res.status(400).json({
      success: false,
      message: 'OTP must be 6 digits',
      debugOtp: otp
    });
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
      logger.error("❌ WITHDRAWAL NOT FOUND");
      logger.warn(`[verifyOtp] ⚠️ Withdrawal request not found: ${id}`);
      return next(new AppError('Withdrawal request not found', 404));
    }

    // Log withdrawal object
    logger.info("🧾 WITHDRAWAL OBJECT:", withdrawalRequest);

    // Security: Verify seller owns this withdrawal
    const requestSellerId = withdrawalRequest.seller?._id
      ? withdrawalRequest.seller._id.toString()
      : withdrawalRequest.seller?.toString() || String(withdrawalRequest.seller);

    logger.info(`[verifyOtp] 🔍 Verifying seller ownership:`, {
      requestSellerId,
      currentSellerId: sellerId.toString(),
      match: requestSellerId === sellerId.toString()
    });

    if (requestSellerId !== sellerId.toString()) {
      await session.abortTransaction();
      logger.error(`[verifyOtp] ❌ SECURITY: Seller ${sellerId} attempted to verify withdrawal ${id} owned by ${requestSellerId}`);
      return next(new AppError('You are not authorized to verify this withdrawal', 403));
    }

    logger.info(`[verifyOtp] ✅ Seller ownership verified`);

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

    // Log withdrawal structure before OTP verification
    logger.info('🧾 WITHDRAWAL BEFORE OTP:', {
      _id: withdrawalRequest._id,
      status: withdrawalRequest.status,
      paystackTransferCode: withdrawalRequest.paystackTransferCode,
      transferCode: withdrawalRequest.transferCode,
      amount: withdrawalRequest.amount,
      amountRequested: withdrawalRequest.amountRequested,
      seller: withdrawalRequest.seller,
      metadata: withdrawalRequest.metadata,
      allKeys: Object.keys(withdrawalRequest.toObject ? withdrawalRequest.toObject() : withdrawalRequest)
    });

    // Check if transfer code exists
    // Get seller early for error handling (needed for refunds)
    const seller = await Seller.findById(sellerId).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    const transferCode = withdrawalRequest.paystackTransferCode || withdrawalRequest.transferCode;
    logger.info("🔑 TRANSFER CODE:", transferCode);

    if (!transferCode) {
      await session.abortTransaction();
      logger.error('❌ NO transferCode FOUND — PAYSTACK WILL FAIL');
      logger.error('❌ MISSING TRANSFER CODE FOR PAYSTACK');
      logger.error('❌ This may indicate the transfer was abandoned. Withdrawal status:', withdrawalRequest.status);

      // If status is otp_expired, provide helpful message
      if (withdrawalRequest.status === 'otp_expired') {
        return res.status(400).json({
          success: false,
          message: 'Your OTP session has expired. Click Resend PIN to restart the transfer.',
          errorCode: 'OTP_SESSION_EXPIRED',
          suggestion: 'Click "Resend PIN" to create a new transfer session.'
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Missing transfer code. Please click "Resend PIN" to create a new transfer session.',
        errorCode: 'MISSING_TRANSFER_CODE',
        suggestion: 'Click "Resend PIN" to restart the transfer.'
      });
    }

    // Get Paystack secret key
    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      await session.abortTransaction();
      return next(new AppError('Paystack is not configured. Please contact support.', 500));
    }

    // Call Paystack to finalize transfer with OTP
    const axios = require('axios');
    const { PAYSTACK_ENDPOINTS } = require('../../config/paystack');
    let paystackResponse;

    // Use the endpoint constant from config
    const paystackUrl = `https://api.paystack.co${PAYSTACK_ENDPOINTS.FINALIZE_TRANSFER}`;
    const otpPayload = {
      transfer_code: transferCode,
      otp: String(otp).trim(), // Ensure OTP is string and trimmed
    };
    const paystackHeaders = {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    };

    logger.info('💳 [verifyOtp] Paystack finalize_transfer request details:', {
      url: paystackUrl,
      endpoint: PAYSTACK_ENDPOINTS.FINALIZE_TRANSFER,
      transferCode: transferCode,
      otpLength: otpPayload.otp.length,
      hasSecretKey: !!PAYSTACK_SECRET_KEY
    });

    // First, check the current transfer status from Paystack before verifying
    logger.info('🔍 [verifyOtp] Checking transfer status before verifying OTP...');

    try {
      const statusResponse = await axios.get(
        `https://api.paystack.co/transfer/${transferCode}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('🔍 [verifyOtp] Current transfer status from Paystack:', {
        status: statusResponse.data?.data?.status,
        transferCode: transferCode,
        requiresOtp: statusResponse.data?.data?.status === 'otp',
        requiresApproval: statusResponse.data?.data?.requires_approval,
        fullStatus: JSON.stringify(statusResponse.data?.data, null, 2)
      });

      // If transfer is not in 'otp' status, this will likely fail
      if (statusResponse.data?.data?.status !== 'otp') {
        logger.error('❌ [verifyOtp] Transfer is NOT in OTP status! Current status:', statusResponse.data?.data?.status);
        logger.error('❌ [verifyOtp] Paystack will reject OTP verification. Status must be "otp"');
        logger.error('❌ [verifyOtp] Possible reasons: OTP expired, already verified, or transfer completed');

        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Transfer is not currently awaiting OTP verification. Current status: ${statusResponse.data?.data?.status}. Please try resending the OTP first.`,
          paystack: {
            status: statusResponse.data?.data?.status,
            transferCode: transferCode
          },
          errorCode: 'TRANSFER_NOT_AWAITING_OTP',
          suggestion: 'Click "Resend PIN" to get a new OTP and put the transfer back into OTP status.'
        });
      }
    } catch (statusError) {
      logger.error('❌ [verifyOtp] Error checking transfer status:', statusError.response?.data || statusError.message);
      // Continue anyway - try to verify
    }

    // Log data before calling Paystack
    logger.info("📤 DATA SENT TO PAYSTACK OTP VERIFY:", {
      otp: req.body.otp,
      transferCode: withdrawalRequest?.transferCode || transferCode,
    });

    logger.info("🧾 WITHDRAWAL OBJECT:", withdrawalRequest);

    if (!withdrawalRequest?.transferCode && !transferCode) {
      logger.error("❌ ERROR: transferCode is missing! Paystack will return 400.");
    }

    // Log raw Paystack payload before sending
    logger.info('💳 PAYSTACK OTP REQUEST:', {
      url: paystackUrl,
      payload: otpPayload,
      headers: {
        ...paystackHeaders,
        Authorization: paystackHeaders.Authorization ? `Bearer ${paystackHeaders.Authorization.substring(7, 15)}...` : 'missing'
      }
    });

    try {
      logger.info("📤 SENDING PAYSTACK OTP VERIFY REQUEST:", {
        otp: otpPayload.otp,
        transfer_code: transferCode,
        url: paystackUrl
      });

      // Use the payload we prepared (with trimmed OTP)
      paystackResponse = await axios.post(paystackUrl, otpPayload, {
        headers: paystackHeaders,
        timeout: 30000 // 30 second timeout
      });

      logger.info("💳 PAYSTACK RESPONSE:", paystackResponse.data);

      logger.info(`[verifyOtp] ✅ Paystack finalize_transfer response received:`, {
        status: paystackResponse.data?.status,
        hasData: !!paystackResponse.data?.data,
        dataKeys: paystackResponse.data?.data ? Object.keys(paystackResponse.data.data) : [],
        responseStructure: JSON.stringify(paystackResponse.data, null, 2).substring(0, 1000)
      });

      // Log the full response for debugging
      logger.info(`[verifyOtp] 📋 Full Paystack response:`, JSON.stringify(paystackResponse.data, null, 2));
    } catch (err) {
      await session.abortTransaction();

      logger.info("🔥 PAYSTACK OTP VERIFICATION ERROR RAW RESPONSE:",
        err.response?.data || err.message
      );

      logger.error("❌ PAYSTACK ERROR:", err.response?.data || err.message);

      // Log raw Paystack error response
      logger.error('❌ PAYSTACK ERROR RAW:', err);
      logger.error('❌ PAYSTACK ERROR RESPONSE:', err.response?.data);
      logger.error('❌ PAYSTACK STATUS:', err.response?.status);
      logger.error('❌ PAYSTACK HEADERS:', err.response?.headers);

      const paystackError = err.response?.data;
      const paystackMessage = paystackError?.message || err.message || 'Paystack OTP verification failed';

      // Check for specific Paystack error: "Transfer is not currently awaiting OTP"
      if (paystackMessage.includes('not currently awaiting OTP') ||
        paystackMessage.includes('not awaiting OTP')) {
        logger.error('❌ PAYSTACK ERROR: Transfer is not awaiting OTP - may need to resend OTP or transfer already completed');

        return res.status(400).json({
          success: false,
          message: "This transfer is not currently awaiting OTP verification. The OTP may have expired, been already verified, or the transfer may have been completed. Please try resending the OTP.",
          paystack: paystackError,
          errorCode: 'TRANSFER_NOT_AWAITING_OTP',
          suggestion: 'Try clicking "Resend PIN" to get a new OTP, or check if the transfer was already completed.'
        });
      }

      return res.status(400).json({
        success: false,
        message: "Paystack OTP verification failed",
        paystack: paystackError
      });
    }

    // Check Paystack response structure
    if (!paystackResponse.data) {
      await session.abortTransaction();
      logger.error('❌ [verifyOtp] Paystack returned empty response');
      return next(new AppError('Invalid response from Paystack. Please try again.', 500));
    }

    // Check if Paystack returned an error (status: false)
    if (paystackResponse.data.status === false) {
      await session.abortTransaction();
      const errorMessage = paystackResponse.data?.message || 'OTP verification failed';
      const errorCode = paystackResponse.data?.code || 'unknown';

      logger.error('❌ [verifyOtp] Paystack returned error:', {
        message: errorMessage,
        code: errorCode,
        data: paystackResponse.data
      });

      // Handle specific error codes
      if (errorMessage.includes('not currently awaiting OTP') ||
        errorMessage.includes('not awaiting OTP')) {
        return res.status(400).json({
          success: false,
          message: "This transfer is not currently awaiting OTP verification. The OTP may have expired, been already verified, or the transfer may have been completed. Please try resending the OTP.",
          paystack: paystackResponse.data,
          errorCode: 'TRANSFER_NOT_AWAITING_OTP',
          suggestion: 'Try clicking "Resend PIN" to get a new OTP, or check if the transfer was already completed.'
        });
      }

      if (errorMessage.includes('invalid') || errorMessage.includes('incorrect')) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP. Please check and try again.",
          paystack: paystackResponse.data,
          errorCode: 'INVALID_OTP'
        });
      }

      if (errorMessage.includes('expired')) {
        return res.status(400).json({
          success: false,
          message: "OTP has expired. Please click 'Resend PIN' to receive a new OTP.",
          paystack: paystackResponse.data,
          errorCode: 'OTP_EXPIRED',
          suggestion: 'Click "Resend PIN" to get a new OTP.'
        });
      }

      return res.status(400).json({
        success: false,
        message: errorMessage || 'OTP verification failed',
        paystack: paystackResponse.data,
        errorCode: errorCode
      });
    }

    // Check if response has data
    if (!paystackResponse.data.data) {
      await session.abortTransaction();
      logger.error('❌ [verifyOtp] Paystack response missing data field:', paystackResponse.data);
      return next(new AppError('Invalid response structure from Paystack. Please contact support.', 500));
    }

    const transferData = paystackResponse.data.data;

    // CRITICAL: Paystack's /transfer/finalize_transfer typically does NOT return authorization_url
    // It directly finalizes the transfer after OTP verification
    // The transfer status will be 'success', 'pending', 'failed', or 'otp'
    // authorization_url is only returned for payment initialization, NOT for transfer finalization

    // Check transfer status first
    const transferStatus = transferData.status;
    logger.info(`[verifyOtp] Paystack transfer status after OTP verification: ${transferStatus}`);

    // Handle different transfer statuses
    if (transferStatus === 'failed') {
      // CRITICAL FIX: Refund pendingBalance when transfer fails
      const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
      const oldPendingBalance = seller.pendingBalance || 0;

      // Refund from pendingBalance
      if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
        seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
        seller.calculateWithdrawableBalance();
        await seller.save({ session });

        logger.info(`[verifyOtp] Transfer failed - refunded pendingBalance for seller ${sellerId}:`);
        logger.info(`  Pending Balance: ${oldPendingBalance} - ${amountRequested} = ${seller.pendingBalance}`);
      } else {
        logger.warn(`[verifyOtp] Transfer failed but pendingBalance (${oldPendingBalance}); is less than amount (${amountRequested})`);
      }

      // Update withdrawal request status
      withdrawalRequest.status = 'failed';
      withdrawalRequest.otpSessionStatus = 'failed';
      if (!withdrawalRequest.metadata) {
        withdrawalRequest.metadata = {};
      }
      withdrawalRequest.metadata.failedAt = new Date();
      withdrawalRequest.metadata.failureReason = 'Transfer failed after OTP verification';
      await withdrawalRequest.save({ session });

      await session.commitTransaction();
      session.endSession();

      logger.error('❌ [verifyOtp] Transfer failed after OTP verification');
      return res.status(400).json({
        success: false,
        message: 'Transfer failed after OTP verification. The amount has been refunded to your available balance.',
        paystack: transferData,
        errorCode: 'TRANSFER_FAILED',
        refunded: true
      });
    }

    if (transferStatus === 'abandoned') {
      // CRITICAL FIX: Refund pendingBalance when transfer is abandoned
      const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
      const oldPendingBalance = seller.pendingBalance || 0;

      // Refund from pendingBalance
      if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
        seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
        seller.calculateWithdrawableBalance();
        await seller.save({ session });

        logger.info(`[verifyOtp] Transfer abandoned - refunded pendingBalance for seller ${sellerId}:`);
        logger.info(`  Pending Balance: ${oldPendingBalance} - ${amountRequested} = ${seller.pendingBalance}`);
      } else {
        logger.warn(`[verifyOtp] Transfer abandoned but pendingBalance (${oldPendingBalance}); is less than amount (${amountRequested})`);
      }

      // Mark withdrawal as OTP expired and update session status
      withdrawalRequest.status = 'otp_expired';
      withdrawalRequest.otpSessionStatus = 'abandoned';
      withdrawalRequest.paystackTransferCode = null; // Clear abandoned transfer code

      // Update metadata
      if (!withdrawalRequest.metadata) {
        withdrawalRequest.metadata = {};
      }
      withdrawalRequest.metadata.abandonedAt = new Date();
      withdrawalRequest.metadata.abandonedTransferCode = transferCode; // Keep old code for reference
      withdrawalRequest.metadata.pendingBalanceRefunded = true;
      withdrawalRequest.metadata.pendingBalanceBefore = oldPendingBalance;
      withdrawalRequest.metadata.pendingBalanceAfter = seller.pendingBalance;

      await withdrawalRequest.save({ session });

      // Log finance audit
      try {
        const financeAudit = require('../../services/financeAuditService');
        await financeAudit.logOtpExpired(
          sellerId,
          amountRequested,
          withdrawalRequest._id,
          oldPendingBalance,
          seller.pendingBalance
        );
      } catch (auditError) {
        logger.error('[verifyOtp] Failed to log finance audit (non-critical);:', auditError);
      }

      await session.commitTransaction();
      session.endSession();

      logger.error('❌ [verifyOtp] Transfer was abandoned (OTP expired);:', {
        withdrawalId: withdrawalRequest._id,
        oldTransferCode: transferCode,
        pendingBalanceRefunded: true,
        paystackResponse: JSON.stringify(transferData, null, 2)
      });

      return res.status(400).json({
        success: false,
        message: 'Your OTP session has expired. The amount has been refunded to your available balance. Click Resend PIN to restart the transfer.',
        paystack: transferData,
        errorCode: 'OTP_SESSION_EXPIRED',
        suggestion: 'Click "Resend PIN" to create a new transfer session.',
        refunded: true
      });
    }

    // If status is still 'otp', something went wrong
    if (transferStatus === 'otp') {
      logger.warn('⚠️ [verifyOtp] Transfer status is still "otp" after verification - may need to verify again');
      // Don't fail - might be a timing issue, continue processing
    }

    // Success statuses: 'success', 'pending', 'processing'
    if (!['success', 'pending', 'processing', 'otp'].includes(transferStatus)) {
      logger.warn(`⚠️ [verifyOtp] Unexpected transfer status: ${transferStatus}`);
      // Continue anyway - might still be processing
    }

    // Log all available fields in transferData
    logger.info(`[verifyOtp] Paystack finalize_transfer response keys:`, Object.keys(transferData));
    logger.info(`[verifyOtp] Paystack finalize_transfer full response:`, JSON.stringify(transferData, null, 2));

    // Check for authorization_url (should be null for transfers, but check anyway)
    const authorizationUrl = transferData.authorization_url ||
      transferData.redirect_url ||
      transferData.url ||
      null;

    logger.info(`[verifyOtp] Paystack finalize_transfer response summary:`, {
      status: transferData.status,
      transfer_code: transferData.transfer_code,
      reference: transferData.reference,
      hasAuthorizationUrl: !!authorizationUrl,
      authorizationUrl: authorizationUrl,
      allKeys: Object.keys(transferData)
    });

    // CRITICAL: Paystack's /transfer/finalize_transfer does NOT return authorization_url
    // It completes the transfer directly after OTP verification
    // The transfer status will be 'success', 'pending', or 'failed'
    // authorization_url is ONLY for payment initialization (/transaction/initialize), NOT for transfers

    // DO NOT redirect - transfers complete directly after OTP
    // If authorizationUrl somehow exists, log it but ignore it
    if (authorizationUrl) {
      logger.warn(`[verifyOtp] ⚠️ WARNING: Paystack returned authorization_url for transfer finalization`);
      logger.warn(`[verifyOtp] This should NOT happen - transfers complete directly after OTP`);
      logger.warn(`[verifyOtp] Ignoring authorization_url and proceeding with transfer completion`);
      logger.warn(`[verifyOtp] Authorization URL was: ${authorizationUrl}`);
      // Continue with normal flow - don't redirect
    }

    // If no redirect required, proceed with balance updates
    logger.info(`[verifyOtp] ✅ No redirect required. Transfer status: ${transferData.status}`);

    // Seller already fetched at line 716 - use it here
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

    // Log seller revenue history for completed payout (OTP verified)
    try {
      await logSellerRevenue({
        sellerId: sellerId,
        amount: -amountRequested, // Negative for payout
        type: 'PAYOUT',
        description: `Withdrawal completed (OTP verified): GH₵${amountRequested.toFixed(2)} (withholding tax: GH₵${withholdingTax.toFixed(2)})`,
        reference: `WITHDRAWAL-OTP-${withdrawalRequest._id}-${Date.now()}`,
        payoutRequestId: withdrawalRequest._id,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance,
        metadata: {
          withdrawalRequestId: withdrawalRequest._id.toString(),
          amountRequested,
          withholdingTax,
          withholdingTaxRate: withdrawalRequest.withholdingTaxRate || 0,
          amountPaidToSeller,
          status: 'completed',
        },
      });
      logger.info(`[verifyOtp] ✅ Seller revenue history logged for completed payout - seller ${sellerId}`);
    } catch (historyError) {
      logger.error(`[verifyOtp] Failed to log seller revenue history (non-critical); for seller ${sellerId}:`, {
        error: historyError.message,
        stack: historyError.stack,
      });
    }

    logger.info(`[verifyOtp] Withdrawal finalized for seller ${sellerId}:`);
    logger.info(`  Amount Requested: ${amountRequested}`);
    logger.info(`  Withholding Tax: ${withholdingTax} (${(withdrawalRequest.withholdingTaxRate || 0) * 100}%)`);
    logger.info(`  Amount Paid to Seller: ${amountPaidToSeller}`);
    logger.info(`  Total Revenue (Balance);: ${oldBalance} - ${amountRequested} = ${seller.balance} (deducted)`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${amountRequested} = ${seller.pendingBalance} (deducted);`);
    logger.info(`  Locked Balance: ${oldLockedBalance} (unchanged);`);
    logger.info(`  Available Balance: ${seller.withdrawableBalance} (recalculated);`);

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

    // Send withdrawal approved email to seller (when transfer is successful)
    try {
      if (transferStatus === 'success' || transferData.status === 'success') {
        const emailDispatcher = require('../../emails/emailDispatcher');
        // Seller is already fetched, use it
        await emailDispatcher.sendWithdrawalApproved(seller, withdrawalRequest);
        logger.info(`[verifyOtp] ✅ Withdrawal approved email sent to seller ${seller.email}`);
      }
    } catch (emailError) {
      logger.error('[verifyOtp] Error sending withdrawal approved email:', emailError.message);
      // Don't fail withdrawal if email fails
    }

    // Return response with transfer details
    // Include authorization_url if it exists (shouldn't at this point, but just in case)
    const responseData = {
      status: 'success',
      message: 'OTP verified successfully. Your withdrawal is being processed.',
      requiresRedirect: false,
      data: {
        withdrawalRequest,
        transferStatus: transferData.status,
        transferCode: transferData.transfer_code,
        reference: transferData.reference,
      },
    };

    // Include authorization_url if somehow it exists (shouldn't happen after balance update)
    if (transferData.authorization_url || transferData.redirect_url) {
      responseData.authorization_url = transferData.authorization_url || transferData.redirect_url;
      responseData.redirect_url = transferData.authorization_url || transferData.redirect_url;
      responseData.requiresRedirect = true;
      logger.info(`[verifyOtp] ⚠️ WARNING: Authorization URL found after balance update: ${responseData.authorization_url}`);
    }

    logger.info(`[verifyOtp] ✅ Returning success response:`, {
      status: responseData.status,
      requiresRedirect: responseData.requiresRedirect,
      hasAuthorizationUrl: !!responseData.authorization_url,
      transferStatus: transferData.status
    });

    res.status(200).json(responseData);
  } catch (error) {
    // Ensure transaction is aborted
    try {
      if (session && session.inTransaction && session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      logger.error('[verifyOtp] Error aborting transaction:', abortError);
    }

    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('[verifyOtp] ❌ UNEXPECTED ERROR IN VERIFY OTP:');
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('[verifyOtp] Error message:', error.message);
    logger.error('[verifyOtp] Error name:', error.name);
    logger.error('[verifyOtp] Error code:', error.code);
    logger.error('[verifyOtp] Error stack:', error.stack);

    // Log additional error details
    if (error.response) {
      logger.error('[verifyOtp] Error response status:', error.response.status);
      logger.error('[verifyOtp] Error response data:', JSON.stringify(error.response.data, null, 2));
      logger.error('[verifyOtp] Error response headers:', error.response.headers);
    }

    // Handle specific error types
    if (error instanceof AppError) {
      logger.error('[verifyOtp] This is an AppError - passing to error handler');
      // Ensure AppError doesn't return 401 unless it's a real auth error
      if (error.statusCode === 401 && !error.message.toLowerCase().includes('not authenticated') &&
        !error.message.toLowerCase().includes('not logged in') &&
        !error.message.toLowerCase().includes('session expired')) {
        logger.warn('[verifyOtp] ⚠️ Converting 401 to 400 for non-auth error');
        error.statusCode = 400;
      }
      return next(error);
    }

    // Handle Mongoose errors
    if (error.name === 'ValidationError') {
      logger.error('[verifyOtp] Mongoose validation error');
      return next(new AppError(`Validation error: ${error.message}`, 400));
    }

    if (error.name === 'CastError') {
      logger.error('[verifyOtp] Mongoose cast error - invalid ID format');
      return next(new AppError('Invalid withdrawal request ID', 400));
    }

    // Handle network/timeout errors
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      logger.error('[verifyOtp] Request timeout error');
      return next(new AppError('Request to Paystack timed out. Please try again.', 504));
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      logger.error('[verifyOtp] Network connection error');
      return next(new AppError('Unable to connect to Paystack. Please try again later.', 503));
    }

    // Generic error handler
    logger.error('[verifyOtp] Generic error - returning 500');
    return next(new AppError(
      error.message || 'Failed to verify OTP. Please try again or contact support.',
      500
    ));
  } finally {
    // Always end the session
    try {
      if (session) {
        await session.endSession();
      }
    } catch (endError) {
      logger.error('[verifyOtp] Error ending session:', endError);
    }
  }
});

/**
 * Request reversal of a withdrawal
 * POST /api/v1/seller/payout/request/:id/request-reversal
 * 
 * Allows sellers to request reversal of their own withdrawals.
 * Note: This creates a reversal request that may need admin approval.
 * For immediate reversals, use admin endpoint.
 */
exports.requestWithdrawalReversal = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { amount, bankDetails, pin, reason } = req.body;

  // SECURITY FIX #24: Withdrawal amount validation
  if (!amount) {
    return next(new AppError('Withdrawal amount is required', 400));
  }

  const numAmount = parseFloat(amount);

  // Validate amount is a number
  if (isNaN(numAmount)) {
    return next(new AppError('Amount must be a valid number', 400));
  }

  // Minimum withdrawal amount (GH₵10)
  const MIN_WITHDRAWAL = 10;
  if (numAmount < MIN_WITHDRAWAL) {
    return next(new AppError(`Minimum withdrawal amount is GH₵${MIN_WITHDRAWAL}`, 400));
  }

  // Validate amount is positive
  if (numAmount <= 0) {
    return next(new AppError('Withdrawal amount must be greater than zero', 400));
  }
  const sellerId = req.user.id;

  // Validate reason
  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Reversal reason is required', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let withdrawalRequest = null;
  let isPaymentRequest = false;

  try {
    // Find withdrawal request (try PaymentRequest first, then WithdrawalRequest)
    withdrawalRequest = await PaymentRequest.findById(id).session(session);
    isPaymentRequest = true;

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
      return next(new AppError('You are not authorized to reverse this withdrawal', 403));
    }

    // Check if already reversed
    if (withdrawalRequest.reversed === true) {
      await session.abortTransaction();
      return next(new AppError('This withdrawal has already been reversed', 400));
    }

    // Only allow reversing certain statuses
    // Sellers can request reversal for: pending, processing, awaiting_paystack_otp
    // For completed/paid withdrawals, only admins can reverse
    const sellerReversibleStatuses = ['pending', 'processing', 'awaiting_paystack_otp'];
    const adminOnlyStatuses = ['paid', 'approved', 'success'];

    if (adminOnlyStatuses.includes(withdrawalRequest.status)) {
      await session.abortTransaction();
      return next(
        new AppError(
          `Cannot reverse withdrawal with status: ${withdrawalRequest.status}. Please contact admin for reversal of completed withdrawals.`,
          400
        )
      );
    }

    if (!sellerReversibleStatuses.includes(withdrawalRequest.status)) {
      await session.abortTransaction();
      return next(
        new AppError(
          `Cannot reverse withdrawal with status: ${withdrawalRequest.status}. Only pending or processing withdrawals can be reversed.`,
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

    // Calculate amounts
    const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
    const oldBalance = seller.balance || 0;
    const oldPendingBalance = seller.pendingBalance || 0;

    // For pending/processing withdrawals, refund from pendingBalance back to available balance
    // The amount was in pendingBalance, so we just remove it from there
    if (oldPendingBalance >= amountRequested) {
      seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
    } else {
      // If pendingBalance is less, there might be an issue, but proceed anyway
      logger.warn(`[requestWithdrawalReversal] Pending balance (${oldPendingBalance}); is less than requested amount (${amountRequested})`);
      seller.pendingBalance = 0;
    }

    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    await seller.save({ session });

    // Update withdrawal request with reversal fields
    withdrawalRequest.reversed = true;
    withdrawalRequest.reversedAt = new Date();
    withdrawalRequest.reversedBy = sellerId; // Seller who requested reversal
    withdrawalRequest.reverseReason = reason.trim();
    withdrawalRequest.status = 'cancelled'; // Update status to cancelled (since it was reversed before completion)

    // Add to audit history
    if (!withdrawalRequest.auditHistory) {
      withdrawalRequest.auditHistory = [];
    }
    withdrawalRequest.auditHistory.push({
      action: 'reversed',
      adminId: null, // Seller-initiated, no admin
      name: seller.name || seller.shopName || seller.email,
      role: 'seller',
      timestamp: new Date(),
      ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    await withdrawalRequest.save({ session });

    // Create transaction record for reversal
    await Transaction.create(
      [
        {
          seller: sellerId,
          amount: amountRequested,
          type: 'credit',
          description: `Withdrawal Reversal Request - Refund for Request #${withdrawalRequest._id}. Reason: ${reason}`,
          status: 'completed',
          metadata: {
            withdrawalRequestId: withdrawalRequest._id,
            action: 'withdrawal_reversal_request',
            reversedAt: new Date(),
            reversedBy: sellerId,
            reverseReason: reason,
            originalAmount: amountRequested,
          },
        },
      ],
      { session }
    );

    // Log seller revenue history
    try {
      await logSellerRevenue({
        sellerId: sellerId,
        amount: amountRequested, // Positive for refund
        type: 'REVERSAL',
        description: `Withdrawal reversal requested - Refund: GH₵${amountRequested.toFixed(2)}. Reason: ${reason}`,
        reference: `WITHDRAWAL-REVERSE-REQUEST-${withdrawalRequest._id}-${Date.now()}`,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance,
        metadata: {
          withdrawalRequestId: withdrawalRequest._id.toString(),
          action: 'withdrawal_reversal_request',
          originalAmount: amountRequested,
          reversedBy: sellerId,
          reverseReason: reason,
        },
      });
      logger.info(`[requestWithdrawalReversal] ✅ Seller revenue history logged for withdrawal reversal request - seller ${sellerId}`);
    } catch (historyError) {
      logger.error(`[requestWithdrawalReversal] Failed to log seller revenue history (non-critical);:`, {
        error: historyError.message,
        stack: historyError.stack,
      });
    }

    await session.commitTransaction();

    // Log activity
    logActivityAsync({
      userId: sellerId,
      role: 'seller',
      action: 'WITHDRAWAL_REVERSAL_REQUESTED',
      description: `Seller requested reversal of withdrawal request #${withdrawalRequest._id} - Amount: GH₵${amountRequested}. Reason: ${reason}`,
      req,
      metadata: {
        withdrawalRequestId: withdrawalRequest._id,
        amount: amountRequested,
        reverseReason: reason,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Withdrawal reversal requested successfully. Amount has been refunded to your available balance.',
      data: {
        withdrawalRequest,
        refundedAmount: amountRequested,
        sellerBalanceBefore: oldBalance,
        sellerBalanceAfter: seller.balance,
        pendingBalanceBefore: oldPendingBalance,
        pendingBalanceAfter: seller.pendingBalance,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[requestWithdrawalReversal] Error:', error);

    if (error instanceof AppError) {
      return next(error);
    }

    return next(new AppError('Failed to request withdrawal reversal', 500));
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
    let withdrawalRequest = await PaymentRequest.findById(id).populate('seller', 'name shopName');
    let isPaymentRequest = true;

    if (!withdrawalRequest) {
      const WithdrawalRequest = require('../../models/payout/withdrawalRequestModel');
      withdrawalRequest = await WithdrawalRequest.findById(id).populate('seller', 'name shopName');
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
    const validStatuses = ['awaiting_paystack_otp', 'processing', 'otp_expired'];
    if (!validStatuses.includes(withdrawalRequest.status)) {
      return next(
        new AppError(
          `Cannot resend OTP. Current status: ${withdrawalRequest.status}`,
          400
        )
      );
    }

    // Get seller for recipient name if needed
    const Seller = require('../../models/user/sellerModel');
    const seller = await Seller.findById(withdrawalRequest.seller).select('name shopName');

    if (!seller) {
      return next(new AppError('Seller not found', 404));
    }

    // Get current transfer code (may be null if abandoned)
    const transferCode = withdrawalRequest.paystackTransferCode;
    let recipientCode = withdrawalRequest.paystackRecipientCode;

    // If no recipient code, recreate it from payment details
    if (!recipientCode) {
      logger.info('⚠️ [resendOtp] Recipient code not found. Recreating from payment details...');

      // Get payment method and details
      const paymentMethod = isPaymentRequest
        ? (withdrawalRequest.paymentMethod || withdrawalRequest.payoutMethod)
        : (withdrawalRequest.payoutMethod || withdrawalRequest.paymentMethod);
      const paymentDetails = withdrawalRequest.paymentDetails || {};

      if (!paymentMethod || !paymentDetails || Object.keys(paymentDetails).length === 0) {
        return next(new AppError('Payment details not found. Cannot recreate recipient. Please contact support.', 400));
      }

      // Recreate recipient from payment details (same logic as approveWithdrawalRequest)
      const isMobileMoney = ['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod);
      let recipientData = {};

      if (isMobileMoney) {
        // Map payment method to network
        const methodToNetwork = {
          'mtn_momo': 'MTN',
          'vodafone_cash': 'Vodafone',
          'airtel_tigo_money': 'AirtelTigo',
        };

        if (!paymentDetails.phone) {
          return next(new AppError('Mobile money phone number is missing from payment details', 400));
        }

        const payoutService = require('../../services/payoutService');
        const network = paymentDetails.network || methodToNetwork[paymentMethod];
        const mobileBankCode = payoutService.getMobileMoneyBankCode(network);

        if (!mobileBankCode) {
          return next(new AppError('Invalid mobile money network. Supported networks: MTN, Vodafone, AirtelTigo', 400));
        }

        // Format phone number
        const formattedPhone = paymentDetails.phone.replace(/\D/g, '');

        if (formattedPhone.length !== 10) {
          return next(new AppError(`Invalid phone number format. Expected 10 digits, got ${formattedPhone.length}`, 400));
        }

        recipientData = {
          type: 'mobile_money',
          name: paymentDetails.accountName || seller.name || seller.shopName || 'Seller',
          account_number: formattedPhone,
          bank_code: mobileBankCode,
          currency: 'GHS',
        };
      } else if (paymentMethod === 'bank') {
        if (!paymentDetails.accountNumber || !paymentDetails.accountName || !paymentDetails.bankName) {
          return next(new AppError('Bank account details are incomplete. Please contact support.', 400));
        }

        const payoutService = require('../../services/payoutService');
        let bankCode = paymentDetails.bankCode;
        if (!bankCode && paymentDetails.bankName) {
          bankCode = payoutService.getBankCodeFromName(paymentDetails.bankName);
        }

        if (!bankCode) {
          return next(new AppError('Bank code is required. Please contact support.', 400));
        }

        const formattedAccountNumber = paymentDetails.accountNumber.replace(/\s+/g, '');

        recipientData = {
          type: 'nuban',
          name: paymentDetails.accountName,
          account_number: formattedAccountNumber,
          bank_code: bankCode,
          currency: 'GHS',
        };
      } else {
        return next(new AppError(`Unsupported payment method: ${paymentMethod}`, 400));
      }

      // Create recipient
      try {
        const { paystackApi, PAYSTACK_ENDPOINTS } = require('../../config/paystack');
        const response = await paystackApi.post(PAYSTACK_ENDPOINTS.CREATE_RECIPIENT, recipientData);

        if (response.data.status && response.data.data) {
          recipientCode = response.data.data.recipient_code;
          logger.info('✅ [resendOtp] Recreated recipient from payment details:', {
            recipientCode,
            paymentMethod,
            recipientName: recipientData.name,
          });

          // Save recipient code to withdrawal request
          withdrawalRequest.paystackRecipientCode = recipientCode;
          await withdrawalRequest.save();
        } else {
          return next(new AppError('Failed to create Paystack recipient', 500));
        }
      } catch (recipientError) {
        logger.error('❌ [resendOtp] Error recreating recipient:', {
          message: recipientError.response?.data?.message || recipientError.message,
          status: recipientError.response?.status,
          data: JSON.stringify(recipientError.response?.data, null, 2),
        });
        return next(new AppError(
          recipientError.response?.data?.message || 'Failed to create recipient. Please contact support.',
          recipientError.response?.status || 500
        ));
      }
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

    const axios = require('axios');
    const mongoose = require('mongoose');
    const session = await mongoose.startSession();
    session.startTransaction();

    let shouldCreateNewTransfer = false;
    let currentTransferStatus = null;

    // Check current transfer status if transfer code exists
    if (transferCode) {
      logger.info('🔍 [resendOtp] Checking current transfer status from Paystack...');
      try {
        const statusResponse = await axios.get(
          `https://api.paystack.co/transfer/${transferCode}`,
          {
            headers: {
              Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        currentTransferStatus = statusResponse.data?.data?.status;
        logger.info('🔍 [resendOtp] Current transfer status from Paystack:', {
          status: currentTransferStatus,
          transferCode: transferCode,
          fullStatus: JSON.stringify(statusResponse.data?.data, null, 2)
        });

        // If transfer is abandoned, we MUST create a new transfer
        if (currentTransferStatus === 'abandoned') {
          logger.info('⚠️ [resendOtp] Transfer is ABANDONED - cannot resend OTP. Creating new transfer...');
          shouldCreateNewTransfer = true;
        } else if (currentTransferStatus !== 'otp') {
          logger.warn('⚠️ [resendOtp] Transfer is NOT in OTP status. Current status:', currentTransferStatus);
          logger.warn('⚠️ [resendOtp] Attempting to resend OTP, but may need to create new transfer if it fails');
        }
      } catch (statusError) {
        logger.error('❌ [resendOtp] Error checking transfer status:', {
          message: statusError.response?.data?.message || statusError.message,
          status: statusError.response?.status,
          data: JSON.stringify(statusError.response?.data, null, 2)
        });
        // If we can't check status and transfer code exists, try resend first
        // If resend fails, we'll create new transfer
      }
    } else {
      // No transfer code means we need to create a new transfer
      logger.info('⚠️ [resendOtp] No transfer code found - creating new transfer...');
      shouldCreateNewTransfer = true;
    }

    let newTransferCode = null;
    let paystackResponse = null;

    // If transfer is abandoned or no transfer code, create NEW transfer
    if (shouldCreateNewTransfer) {
      logger.info('🔄 [resendOtp] Creating NEW Paystack transfer (abandoned transfer cannot be revived);...');

      try {
        const payoutService = require('../../services/payoutService');
        const transferResult = await payoutService.initiatePayout(
          withdrawalRequest.amount,
          recipientCode,
          `Payout resend for ${withdrawalRequest._id}`
        );

        newTransferCode = transferResult.transfer_code;
        logger.info('✅ [resendOtp] New transfer created:', {
          newTransferCode: newTransferCode,
          status: transferResult.status,
          fullResponse: JSON.stringify(transferResult, null, 2)
        });

        // Update withdrawal request with new transfer code
        withdrawalRequest.paystackTransferCode = newTransferCode;
        withdrawalRequest.status = 'awaiting_paystack_otp';
        withdrawalRequest.otpSessionStatus = 'active';

        // Store old transfer code in metadata for reference
        if (!withdrawalRequest.metadata) {
          withdrawalRequest.metadata = {};
        }
        if (transferCode) {
          withdrawalRequest.metadata.previousTransferCodes = withdrawalRequest.metadata.previousTransferCodes || [];
          withdrawalRequest.metadata.previousTransferCodes.push({
            transferCode: transferCode,
            status: currentTransferStatus || 'unknown',
            replacedAt: new Date(),
            reason: 'abandoned'
          });
        }

        await withdrawalRequest.save({ session });
        await session.commitTransaction();

        logger.info('✅ [resendOtp] Withdrawal request updated with new transfer code');

      } catch (transferError) {
        await session.abortTransaction();
        logger.error('❌ [resendOtp] Error creating new transfer:', {
          message: transferError.message,
          response: transferError.response?.data,
          fullError: JSON.stringify(transferError.response?.data, null, 2)
        });
        return next(new AppError(
          transferError.response?.data?.message || 'Failed to create new transfer. Please contact support.',
          transferError.response?.status || 500
        ));
      } finally {
        session.endSession();
      }

      // Log activity
      logActivityAsync({
        userId: sellerId,
        role: 'seller',
        action: 'WITHDRAWAL_NEW_TRANSFER_CREATED',
        description: `New Paystack transfer created for withdrawal request #${withdrawalRequest._id} (previous transfer was abandoned)`,
        req,
        metadata: {
          withdrawalRequestId: withdrawalRequest._id,
          amount: withdrawalRequest.amount,
          oldTransferCode: transferCode,
          newTransferCode: newTransferCode,
        },
      });

      return res.status(200).json({
        status: 'success',
        message: 'New transfer session created. OTP has been sent to your phone/email.',
        data: {
          withdrawalRequest,
          newTransferCode: newTransferCode,
          previousTransferCode: transferCode,
        },
      });
    }

    // If transfer is NOT abandoned, try to resend OTP
    logger.info('📤 [resendOtp] Attempting to resend OTP for existing transfer...');

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

      logger.info('✅ [resendOtp] Paystack resend_otp success:', {
        status: paystackResponse.data?.status,
        message: paystackResponse.data?.message,
        data: JSON.stringify(paystackResponse.data?.data, null, 2)
      });
    } catch (paystackError) {
      logger.error('❌ [resendOtp] Paystack resend_otp error:', {
        message: paystackError.response?.data?.message || paystackError.message,
        status: paystackError.response?.status,
        data: JSON.stringify(paystackError.response?.data, null, 2)
      });

      // If resend fails, create a new transfer
      logger.info('🔄 [resendOtp] Resend failed - creating new transfer instead...');

      try {
        await session.startTransaction();
        const payoutService = require('../../services/payoutService');
const logger = require('../../utils/logger');
        const transferResult = await payoutService.initiatePayout(
          withdrawalRequest.amount,
          recipientCode,
          `Payout resend for ${withdrawalRequest._id}`
        );

        newTransferCode = transferResult.transfer_code;
        logger.info('✅ [resendOtp] New transfer created after resend failure:', {
          newTransferCode: newTransferCode,
          status: transferResult.status,
          fullResponse: JSON.stringify(transferResult, null, 2)
        });

        // Update withdrawal request
        withdrawalRequest.paystackTransferCode = newTransferCode;
        withdrawalRequest.status = 'awaiting_paystack_otp';
        withdrawalRequest.otpSessionStatus = 'active';

        if (!withdrawalRequest.metadata) {
          withdrawalRequest.metadata = {};
        }
        withdrawalRequest.metadata.previousTransferCodes = withdrawalRequest.metadata.previousTransferCodes || [];
        withdrawalRequest.metadata.previousTransferCodes.push({
          transferCode: transferCode,
          status: currentTransferStatus || 'unknown',
          replacedAt: new Date(),
          reason: 'resend_failed'
        });

        await withdrawalRequest.save({ session });
        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({
          status: 'success',
          message: 'New transfer session created. OTP has been sent to your phone/email.',
          data: {
            withdrawalRequest,
            newTransferCode: newTransferCode,
            previousTransferCode: transferCode,
          },
        });
      } catch (transferError) {
        await session.abortTransaction();
        session.endSession();
        logger.error('❌ [resendOtp] Error creating new transfer after resend failure:', transferError);
        return next(new AppError(
          'Failed to resend OTP and failed to create new transfer. Please contact support.',
          500
        ));
      }
    }

    // Check Paystack response
    if (!paystackResponse.data || paystackResponse.data.status !== true) {
      const errorMessage = paystackResponse.data?.message || 'Failed to resend OTP';
      logger.error('❌ [resendOtp] Paystack resend_otp returned failure:', JSON.stringify(paystackResponse.data, null, 2));
      return next(new AppError(errorMessage, 400));
    }

    // Verify transfer is now in 'otp' status after resend
    logger.info('🔍 [resendOtp] Verifying transfer status after resend...');
    try {
      const verifyResponse = await axios.get(
        `https://api.paystack.co/transfer/${transferCode}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const newStatus = verifyResponse.data?.data?.status;
      logger.info('✅ [resendOtp] Transfer status after resend:', {
        status: newStatus,
        isOtpStatus: newStatus === 'otp',
        fullStatus: JSON.stringify(verifyResponse.data?.data, null, 2)
      });

      if (newStatus !== 'otp') {
        logger.warn('⚠️ [resendOtp] Transfer is still NOT in OTP status after resend. Status:', newStatus);
        logger.warn('⚠️ [resendOtp] This may indicate the transfer cannot accept OTP (already completed, expired, etc.);');
      } else {
        logger.info('✅ [resendOtp] Transfer is now in OTP status - ready for verification');
      }
    } catch (verifyError) {
      logger.error('❌ [resendOtp] Error verifying transfer status after resend:', verifyError.response?.data || verifyError.message);
      // Don't fail - resend might have worked
    }

    // Update metadata for successful resend
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
      transferCode: transferCode,
      transferStatus: currentTransferStatus || 'otp',
    });
    withdrawalRequest.metadata.lastOtpResentAt = new Date();
    withdrawalRequest.metadata.otpResendHistory = resendHistory;
    withdrawalRequest.metadata.lastResendReason = finalReason;
    withdrawalRequest.metadata.lastInternalReason = internalReason;
    withdrawalRequest.otpSessionStatus = 'active'; // Ensure session is marked as active
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
    logger.error('[resendOtp] Error:', error);

    if (error instanceof AppError) {
      return next(error);
    }

    return next(new AppError(error.message || 'Failed to resend OTP', 500));
  }
});

