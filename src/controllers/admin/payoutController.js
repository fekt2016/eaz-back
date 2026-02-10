/**
 * Admin Payout Controller
 * Handles admin approval and processing of seller withdrawal requests
 */

const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const Seller = require('../../models/user/sellerModel');
const WithdrawalRequest = require('../../models/payout/withdrawalRequestModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel'); // Existing payment request model
const Transaction = require('../../models/transaction/transactionModel');
const AdminActionLog = require('../../models/admin/adminActionLogModel');
const Admin = require('../../models/user/adminModel');
const payoutService = require('../../services/payoutService');
const mongoose = require('mongoose');
const { logSellerRevenue } = require('../../services/historyLogger');
const { getIpAddress } = require('../../utils/helpers/deviceUtils');

/**
 * Get all withdrawal requests
 * Fetches from both WithdrawalRequest (new) and PaymentRequest (existing) models
 * GET /api/v1/admin/payout/requests
 */
exports.getAllWithdrawalRequests = catchAsync(async (req, res, next) => {
  const { status, seller, limit = 50, page = 1 } = req.query;

  const query = {}; // Admin can see both active and deactivated withdrawals
  if (status) {
    query.status = status;
  }
  if (seller) {
    query.seller = seller;
  }

  const skip = (page - 1) * limit;

  // Fetch from both models
  const [withdrawalRequests, paymentRequests] = await Promise.all([
    WithdrawalRequest.find(query)
      .populate({
        path: 'seller',
        select: 'name shopName email',
      })
      .populate({
        path: 'processedBy',
        select: 'name email',
      })
      .sort('-createdAt')
      .lean(),
    PaymentRequest.find({ ...query, seller: { $exists: true, $ne: null } }) // Only get seller payment requests (includes deactivated)
      .populate({
        path: 'seller',
        select: 'name shopName email',
      })
      .sort('-createdAt')
      .lean(),
  ]);

  // Transform PaymentRequest to match WithdrawalRequest format
  const transformedPaymentRequests = paymentRequests.map((req) => ({
    ...req,
    payoutMethod: req.paymentMethod, // Map paymentMethod to payoutMethod
    _id: req._id,
    type: 'payment-request', // Mark as legacy payment request
  }));

  // Combine and sort by createdAt
  const allRequests = [...withdrawalRequests, ...transformedPaymentRequests]
    .sort((a, b) => new Date(b.createdAt || b.paymentDate) - new Date(a.createdAt || a.paymentDate));

  // Apply pagination
  const paginatedRequests = allRequests.slice(skip, skip + parseInt(limit));
  const total = allRequests.length;

  res.status(200).json({
    status: 'success',
    results: paginatedRequests.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    data: {
      withdrawalRequests: paginatedRequests,
    },
  });
});

/**
 * Admin: Verify Paystack OTP for a withdrawal
 * POST /api/v1/admin/payout/request/:id/verify-otp
 */
exports.verifyPaystackOtpForWithdrawal = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { otp } = req.body;
  const adminId = req.user.id;

  if (!otp || String(otp).trim().length < 4) {
    return next(new AppError('A valid OTP is required', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Load withdrawal from PaymentRequest first, then WithdrawalRequest
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

    // Only allow OTP verification when awaiting Paystack OTP
    if (withdrawalRequest.status !== 'awaiting_paystack_otp') {
      await session.abortTransaction();
      return next(
        new AppError(
          `This withdrawal is not awaiting OTP. Current status: ${withdrawalRequest.status}`,
          400
        )
      );
    }

    const transferCode =
      withdrawalRequest.paystackTransferCode || withdrawalRequest.transferCode;

    if (!transferCode) {
      await session.abortTransaction();
      return next(
        new AppError(
          'No Paystack transfer code found for this withdrawal. Cannot verify OTP.',
          400
        )
      );
    }

    logger.info('[verifyPaystackOtpForWithdrawal] Checking Paystack transfer status before OTP verification', {
      withdrawalId: withdrawalRequest._id,
      transferCode,
      isPaymentRequest,
      adminId,
    });

    // CRITICAL: Check Paystack transfer status BEFORE attempting OTP verification
    // Paystack may have changed the transfer status (completed, failed, etc.)
    let paystackTransferStatus;
    try {
      const transferId = withdrawalRequest.paystackTransferId || 
                        withdrawalRequest.paystackReference || 
                        transferCode;
      
      if (!transferId) {
        logger.warn('[verifyPaystackOtpForWithdrawal] No transfer ID found, skipping status check');
      } else {
        paystackTransferStatus = await payoutService.verifyTransferStatus(transferId);
        
        logger.info('[verifyPaystackOtpForWithdrawal] Paystack transfer status:', {
          status: paystackTransferStatus.status,
          requiresPin: paystackTransferStatus.requires_pin,
        });
        
        // If transfer is already completed, do NOT accept OTP - each transfer has its own OTP on Paystack.
        // Direct admin to use "Verify Transfer Status" to sync (no OTP needed).
        if (['success', 'completed', 'paid'].includes(paystackTransferStatus.status)) {
          await session.abortTransaction();
          return next(
            new AppError(
              'This transfer is already completed on Paystack. No OTP is needed. Use "Verify Transfer Status" to sync the status.',
              400
            )
          );
        }
        
        // If transfer has failed or been reversed: remove from pendingBalance so amount returns to available; total revenue (balance) unchanged
        if (['failed', 'reversed'].includes(paystackTransferStatus.status)) {
          logger.info('[verifyPaystackOtpForWithdrawal] Transfer failed on Paystack, syncing database status and refunding seller');
          withdrawalRequest.status = 'failed';
          const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
          const sellerForRefund = await Seller.findById(withdrawalRequest.seller).session(session);
          if (sellerForRefund && amountRequested > 0) {
            const oldPending = sellerForRefund.pendingBalance || 0;
            if (oldPending >= amountRequested) {
              sellerForRefund.pendingBalance = Math.max(0, oldPending - amountRequested);
              sellerForRefund.calculateWithdrawableBalance(); // restores amount to available; total revenue (balance) unchanged
              await sellerForRefund.save({ session, validateBeforeSave: false });
              logger.info('[verifyPaystackOtpForWithdrawal] Removed from pendingBalance → back to available; total revenue unchanged:', { sellerId: sellerForRefund._id, amount: amountRequested, pendingBefore: oldPending, pendingAfter: sellerForRefund.pendingBalance, withdrawableAfter: sellerForRefund.withdrawableBalance });
            } else {
              logger.warn('[verifyPaystackOtpForWithdrawal] Pending balance less than amount, skipping refund', { oldPending, amountRequested });
            }
          }
          try {
            await withdrawalRequest.save({ session, validateBeforeSave: false });
          } catch (saveError) {
            logger.error('[verifyPaystackOtpForWithdrawal] Error syncing failed status:', saveError);
          }
          await session.commitTransaction();
          return next(
            new AppError(
              `Transfer has failed on Paystack. Paystack status: ${paystackTransferStatus.status}. Database synced and amount refunded to seller's available balance.`,
              400
            )
          );
        }
        
        // If transfer was abandoned: remove from pendingBalance so amount returns to available; total revenue (balance) unchanged
        if (paystackTransferStatus.status === 'abandoned') {
          logger.info('[verifyPaystackOtpForWithdrawal] Transfer abandoned on Paystack, syncing database status and refunding seller');
          withdrawalRequest.status = 'failed';
          if (withdrawalRequest.otpSessionStatus !== undefined) {
            withdrawalRequest.otpSessionStatus = 'abandoned';
          }
          const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
          const sellerForRefund = await Seller.findById(withdrawalRequest.seller).session(session);
          if (sellerForRefund && amountRequested > 0) {
            const oldPending = sellerForRefund.pendingBalance || 0;
            if (oldPending >= amountRequested) {
              sellerForRefund.pendingBalance = Math.max(0, oldPending - amountRequested);
              sellerForRefund.calculateWithdrawableBalance(); // restores amount to available; total revenue unchanged
              await sellerForRefund.save({ session, validateBeforeSave: false });
              logger.info('[verifyPaystackOtpForWithdrawal] Removed from pendingBalance (abandoned) → back to available; total revenue unchanged:', { sellerId: sellerForRefund._id, amount: amountRequested, pendingBefore: oldPending, pendingAfter: sellerForRefund.pendingBalance, withdrawableAfter: sellerForRefund.withdrawableBalance });
            } else {
              logger.warn('[verifyPaystackOtpForWithdrawal] Pending balance less than amount, skipping refund', { oldPending, amountRequested });
            }
          }
          try {
            await withdrawalRequest.save({ session, validateBeforeSave: false });
          } catch (saveError) {
            logger.error('[verifyPaystackOtpForWithdrawal] Error syncing abandoned status:', saveError);
          }
          await session.commitTransaction();
          return next(
            new AppError(
              'This transfer was abandoned on Paystack (e.g. OTP expired). The request has been marked as failed and the amount refunded to the seller\'s available balance. They can submit a new withdrawal.',
              400
            )
          );
        }
        
        // Only allow OTP verification if Paystack status is 'otp'
        if (paystackTransferStatus.status !== 'otp') {
          await session.abortTransaction();
          return next(
            new AppError(
              `Transfer is not currently awaiting OTP. Paystack status: ${paystackTransferStatus.status}. ` +
              `Use "Verify Transfer Status" to sync, or resend OTP if the transfer is still awaiting PIN.`,
              400
            )
          );
        }
      }
    } catch (statusError) {
      logger.error('[verifyPaystackOtpForWithdrawal] Error checking Paystack transfer status:', {
        message: statusError.message,
        stack: statusError.stack,
        isAppError: statusError instanceof AppError,
        response: statusError.response?.data,
      });
      // Continue with OTP verification attempt if status check fails
      // (Paystack API might be temporarily unavailable)
      // But log a warning
      logger.warn('[verifyPaystackOtpForWithdrawal] Proceeding with OTP verification despite status check failure');
    }

    logger.info('[verifyPaystackOtpForWithdrawal] Finalizing transfer with OTP', {
      withdrawalId: withdrawalRequest._id,
      transferCode,
      isPaymentRequest,
      adminId,
    });

    // Call Paystack to finalize transfer with OTP
    let paystackResponse;
    try {
      paystackResponse = await payoutService.finalizeTransferOtp(
        transferCode,
        otp
      );
      
      if (!paystackResponse) {
        throw new AppError('Paystack returned an empty response', 500);
      }
    } catch (otpError) {
      // If it's already an AppError, re-throw it
      if (otpError instanceof AppError) {
        throw otpError;
      }
      // Otherwise wrap it
      logger.error('[verifyPaystackOtpForWithdrawal] Error calling finalizeTransferOtp:', {
        message: otpError.message,
        stack: otpError.stack,
        response: otpError.response?.data,
      });
      throw new AppError(
        `Paystack OTP verification failed: ${otpError.message || 'Unknown error'}`,
        500
      );
    }

    // Safely extract transfer data from response
    const transferData = paystackResponse?.data?.data || paystackResponse?.data || {};
    const transferStatus =
      transferData.status || 
      paystackResponse?.data?.status || 
      paystackResponse?.status || 
      'unknown';

    logger.info('[verifyPaystackOtpForWithdrawal] Paystack finalize_transfer result:', {
      transferStatus,
      hasData: !!transferData,
      responseStructure: {
        hasData: !!paystackResponse?.data,
        hasNestedData: !!paystackResponse?.data?.data,
        topLevelStatus: paystackResponse?.status,
        dataLevelStatus: paystackResponse?.data?.status,
      },
    });

    // Update withdrawal status based on Paystack transfer status
    withdrawalRequest.pinSubmitted = true;

    if (['success', 'completed', 'paid'].includes(transferStatus)) {
      withdrawalRequest.status = 'paid';
      // Remove amount from pendingBalance and balance now that payout is complete
      const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
      const sellerForDeduction = await Seller.findById(withdrawalRequest.seller).session(session);
      if (sellerForDeduction && amountRequested > 0) {
        const oldPending = sellerForDeduction.pendingBalance || 0;
        const oldBalance = sellerForDeduction.balance || 0;
        if (oldPending >= amountRequested) {
          sellerForDeduction.pendingBalance = Math.max(0, oldPending - amountRequested);
          sellerForDeduction.balance = Math.max(0, oldBalance - amountRequested);
          sellerForDeduction.calculateWithdrawableBalance();
          await sellerForDeduction.save({ session, validateBeforeSave: false });
          logger.info('[verifyPaystackOtpForWithdrawal] Deducted from pendingBalance and balance (paid):', { sellerId: sellerForDeduction._id, amount: amountRequested, pendingBefore: oldPending, balanceBefore: oldBalance });
        } else {
          logger.warn('[verifyPaystackOtpForWithdrawal] Pending balance less than amount, skipping deduction', { oldPending, amountRequested });
        }
      }
    } else if (['pending', 'processing'].includes(transferStatus)) {
      withdrawalRequest.status = 'processing';
    } else {
      withdrawalRequest.status = 'failed';
    }

    // Persist changes
    try {
      await withdrawalRequest.save({ session, validateBeforeSave: false });
    } catch (saveError) {
      logger.error('[verifyPaystackOtpForWithdrawal] Error saving withdrawal request:', {
        message: saveError.message,
        stack: saveError.stack,
        withdrawalId: withdrawalRequest._id,
      });
      throw new AppError(
        `Failed to save withdrawal request: ${saveError.message}`,
        500
      );
    }

    // Log admin action
    try {
      await AdminActionLog.create(
        [
          {
            adminId,
            name: req.user.name || req.user.email,
            email: req.user.email,
            role: req.user.role,
            actionType: 'WITHDRAWAL_VERIFY_PAYSTACK_OTP',
            withdrawalId: withdrawalRequest._id,
            timestamp: new Date(),
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent'),
            metadata: {
              transferCode,
              transferStatus,
            },
          },
        ],
        { session }
      );
    } catch (logError) {
      // Log error but don't fail the request - admin action logging is non-critical
      logger.error('[verifyPaystackOtpForWithdrawal] Error creating admin action log:', {
        message: logError.message,
        stack: logError.stack,
      });
    }

    await session.commitTransaction();

    // Send transfer-success email to seller when payout is paid
    if (withdrawalRequest.status === 'paid') {
      try {
        const emailDispatcher = require('../../emails/emailDispatcher');
        const sellerForEmail = await Seller.findById(withdrawalRequest.seller)
          .select('email name shopName')
          .lean();
        if (sellerForEmail && sellerForEmail.email) {
          await emailDispatcher.sendWithdrawalApproved(sellerForEmail, withdrawalRequest);
          logger.info('[verifyPaystackOtpForWithdrawal] ✅ Transfer success email sent to seller %s', sellerForEmail.email);
        }
      } catch (emailError) {
        logger.error('[verifyPaystackOtpForWithdrawal] Error sending transfer success email:', emailError.message);
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        withdrawalRequest,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[verifyPaystackOtpForWithdrawal] Error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      response: error.response?.data,
      status: error.response?.status,
      isAppError: error instanceof AppError,
      withdrawalId: id,
      adminId,
    });
    
    // If it's already an AppError, pass it through
    if (error instanceof AppError) {
      return next(error);
    }
    
    // If it's a Paystack error that wasn't wrapped, wrap it
    if (error.response?.data?.message) {
      return next(
        new AppError(
          `Paystack error: ${error.response.data.message}`,
          error.response.status || 400
        )
      );
    }
    
    // Generic error fallback with more context
    return next(
      new AppError(
        `Failed to verify Paystack OTP: ${error.message || 'Unknown error'}`,
        500
      )
    );
  } finally {
    session.endSession();
  }
});

/**
 * Admin: Resend Paystack OTP for a withdrawal
 * POST /api/v1/admin/payout/request/:id/resend-otp
 */
exports.resendPaystackOtpForWithdrawal = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const adminId = req.user.id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Load withdrawal from PaymentRequest first, then WithdrawalRequest
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

    // Only allow resend when status is awaiting OTP or OTP expired
    if (
      withdrawalRequest.status !== 'awaiting_paystack_otp' &&
      withdrawalRequest.status !== 'otp_expired'
    ) {
      await session.abortTransaction();
      return next(
        new AppError(
          `Cannot resend OTP in current status: ${withdrawalRequest.status}`,
          400
        )
      );
    }

    const transferCode =
      withdrawalRequest.paystackTransferCode || withdrawalRequest.transferCode;

    if (!transferCode) {
      await session.abortTransaction();
      return next(
        new AppError(
          'No Paystack transfer code found for this withdrawal. Cannot resend OTP.',
          400
        )
      );
    }

    // Abandoned transfers cannot be resent; admin must sync then reject or seller creates new withdrawal
    try {
      const currentStatus = await payoutService.verifyTransferStatus(transferCode);
      if (currentStatus.status === 'abandoned') {
        await session.abortTransaction();
        return next(
          new AppError(
            'This transfer was abandoned on Paystack (e.g. OTP expired). Resend OTP is not available. Use "Verify Transfer Status" to sync, then reject this request or ask the seller to submit a new withdrawal.',
            400
          )
        );
      }
    } catch (statusErr) {
      logger.warn('[resendPaystackOtpForWithdrawal] Could not check transfer status before resend:', statusErr.message);
      // Continue with resend attempt
    }

    logger.info('[resendPaystackOtpForWithdrawal] Resending OTP', {
      withdrawalId: withdrawalRequest._id,
      transferCode,
      isPaymentRequest,
      adminId,
    });

    // Call Paystack to resend OTP
    const paystackResponse = await payoutService.resendTransferOtp(transferCode);

    // Mark OTP session as active again
    withdrawalRequest.otpSessionStatus = 'active';
    // Ensure we are back in awaiting OTP status
    withdrawalRequest.status = 'awaiting_paystack_otp';
    await withdrawalRequest.save({ session, validateBeforeSave: false });

    // Log admin action
    await AdminActionLog.create(
      [
        {
          adminId,
          name: req.user.name || req.user.email,
          email: req.user.email,
          role: req.user.role,
          actionType: 'WITHDRAWAL_RESEND_PAYSTACK_OTP',
          withdrawalId: withdrawalRequest._id,
          timestamp: new Date(),
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          metadata: {
            transferCode,
            paystackStatus: paystackResponse?.data?.status,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message:
        'OTP resend requested from Paystack. Check your Paystack business phone/email.',
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[resendPaystackOtpForWithdrawal] Error:', error);
    return next(
      error instanceof AppError
        ? error
        : new AppError('Failed to resend Paystack OTP', 500)
    );
  } finally {
    session.endSession();
  }
});

/**
 * Get a single withdrawal request
 * Checks both WithdrawalRequest and PaymentRequest models
 * GET /api/v1/admin/payout/request/:id
 */
exports.getWithdrawalRequest = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Try PaymentRequest first (since we're using PaymentRequest model now)
  let withdrawalRequest = await PaymentRequest.findById(id)
    .populate({
      path: 'seller',
      select: 'name shopName email balance lockedBalance pendingBalance withdrawableBalance paymentMethods paystackRecipientCode',
    })
    .lean();

  // If not found, try WithdrawalRequest (for backward compatibility)
  if (!withdrawalRequest) {
    const withdrawalReq = await WithdrawalRequest.findById(id)
      .populate({
        path: 'seller',
        select: 'name shopName email balance lockedBalance pendingBalance withdrawableBalance paymentMethods paystackRecipientCode',
      })
      .populate({
        path: 'processedBy',
        select: 'name email',
      })
      .populate({
        path: 'transaction',
      })
      .lean();

    if (!withdrawalReq) {
      return next(new AppError('Withdrawal request not found', 404));
    }

    withdrawalRequest = withdrawalReq;
  } else {
    // Transform PaymentRequest to match WithdrawalRequest format for compatibility
    withdrawalRequest = {
      ...withdrawalRequest,
      payoutMethod: withdrawalRequest.paymentMethod, // Map paymentMethod to payoutMethod
      type: 'payment-request',
    };
  }

  // Debug: Log paymentDetails to verify they're included
  logger.info('[getWithdrawalRequest] Payment details:', {
    id: withdrawalRequest._id,
    hasPaymentDetails: !!withdrawalRequest.paymentDetails,
    paymentDetails: withdrawalRequest.paymentDetails,
    paymentMethod: withdrawalRequest.paymentMethod,
    payoutMethod: withdrawalRequest.payoutMethod,
  });

  res.status(200).json({
    status: 'success',
    data: {
      withdrawalRequest,
    },
  });
});

/**
 * Approve and process a withdrawal request
 * POST /api/v1/admin/payout/request/:id/approve
 */
exports.approveWithdrawalRequest = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const adminId = req.user.id;

  // Role restriction: Only superadmin and admin can approve withdrawals
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return next(new AppError('Not authorized to approve withdrawals. Only superadmin and admin can approve.', 403));
  }

  // Get full admin details for tracking
  const admin = await Admin.findById(adminId);
  if (!admin) {
    return next(new AppError('Admin not found', 404));
  }

  // Capture IP address and user agent
  const ipAddress = getIpAddress(req);
  const userAgent = req.headers['user-agent'] || 'unknown';

  const session = await mongoose.startSession();
  session.startTransaction();

  // Declare outside try block so it's accessible in catch block
  let withdrawalRequest = null;
  let isPaymentRequest = false;

  try {
    // Try WithdrawalRequest first
    // Get all fields - payoutMethod and paymentDetails should be included by default
    withdrawalRequest = await WithdrawalRequest.findById(id).session(session);

    // If not found, try PaymentRequest
    if (!withdrawalRequest) {
      const paymentRequest = await PaymentRequest.findById(id).session(session);
      if (!paymentRequest) {
        await session.abortTransaction();
        return next(new AppError('Withdrawal request not found', 404));
      }
      isPaymentRequest = true;
      withdrawalRequest = paymentRequest;
    }
    
    // Convert to plain object to inspect all fields
    const requestObj = withdrawalRequest.toObject ? withdrawalRequest.toObject() : withdrawalRequest;
    
    // Debug: Log the withdrawal request to see what fields are present
    logger.info('[approveWithdrawalRequest] Withdrawal request fields:', {
      id: requestObj._id,
      isPaymentRequest,
      payoutMethod: requestObj.payoutMethod,
      paymentMethod: requestObj.paymentMethod,
      hasPaymentDetails: !!requestObj.paymentDetails,
      paymentDetails: requestObj.paymentDetails, // Log full paymentDetails
      paymentDetailsKeys: requestObj.paymentDetails ? Object.keys(requestObj.paymentDetails) : [],
      allFields: Object.keys(requestObj),
    });

    // Security check: Prevent approving if status is not pending
    if (withdrawalRequest.status !== 'pending') {
      await session.abortTransaction();
      return next(
        new AppError(`Cannot approve withdrawal request with status: ${withdrawalRequest.status}. Only pending requests can be approved.`, 400)
      );
    }

    // Security check: Prevent approving deactivated withdrawals
    if (withdrawalRequest.isActive === false) {
      await session.abortTransaction();
      return next(
        new AppError('Cannot approve a deactivated withdrawal request. The seller has cancelled this withdrawal.', 400)
      );
    }

    // Security check: Prevent double approval - verify no Paystack transfer already exists
    if (withdrawalRequest.paystackTransferId || withdrawalRequest.paystackTransferCode || withdrawalRequest.paystackReference) {
      await session.abortTransaction();
      return next(
        new AppError('This withdrawal request has already been processed. A Paystack transfer already exists.', 400)
      );
    }

    // Security check: Prevent approval if already processed
    if (withdrawalRequest.processedAt) {
      await session.abortTransaction();
      return next(
        new AppError('This withdrawal request has already been processed.', 400)
      );
    }

    // Get seller
    const seller = await Seller.findById(withdrawalRequest.seller).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // Note: Balance was already deducted when withdrawal was created
    // We only need to verify the withdrawal exists and update status

    // ALWAYS use payment details from the request, not from seller's saved methods
    // PaymentRequest uses 'paymentMethod', WithdrawalRequest uses 'payoutMethod'
    const paymentMethod = isPaymentRequest 
      ? (withdrawalRequest.paymentMethod || withdrawalRequest.payoutMethod)
      : (withdrawalRequest.payoutMethod || withdrawalRequest.paymentMethod);
    const paymentDetails = withdrawalRequest.paymentDetails || {};
    
    logger.info('[approveWithdrawalRequest] Using payment details from request:', {
      isPaymentRequest,
      payoutMethod: withdrawalRequest.payoutMethod,
      paymentMethod: withdrawalRequest.paymentMethod,
      resolvedPaymentMethod: paymentMethod,
      hasPaymentDetails: !!paymentDetails && Object.keys(paymentDetails).length > 0,
      paymentDetailsKeys: paymentDetails ? Object.keys(paymentDetails) : [],
      paymentDetails,
      withdrawalRequestFields: Object.keys(withdrawalRequest.toObject ? withdrawalRequest.toObject() : withdrawalRequest),
    });
    
    // Validate payment method exists
    if (!paymentMethod) {
      await session.abortTransaction();
      logger.error('[approveWithdrawalRequest] Payment method missing. Request data:', {
        id: withdrawalRequest._id,
        isPaymentRequest,
        payoutMethod: withdrawalRequest.payoutMethod,
        paymentMethod: withdrawalRequest.paymentMethod,
        allFields: Object.keys(withdrawalRequest.toObject ? withdrawalRequest.toObject() : withdrawalRequest),
      });
      return next(new AppError('Payment method is missing from the withdrawal request. Please ensure the request has a valid payout method.', 400));
    }
    
    // Validate payment details exist
    if (!paymentDetails || Object.keys(paymentDetails).length === 0) {
      await session.abortTransaction();
      return next(new AppError('Payment details are missing from the withdrawal request. Please ensure the request has valid payment information.', 400));
    }
    
    // Build recipientData directly from payment details in the request
    let recipientData = {};
    let recipientCode = null;
    
    // Check if this is a mobile money payment method
    const isMobileMoney = ['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod);
    
    if (isMobileMoney) {
      // Map payment method to network
      const methodToNetwork = {
        'mtn_momo': 'MTN',
        'vodafone_cash': 'Vodafone',
        'airtel_tigo_money': 'AirtelTigo',
      };
      
      // Validate mobile money details
      if (!paymentDetails.phone) {
        await session.abortTransaction();
        return next(new AppError('Mobile money phone number is missing from payment details', 400));
      }
      
      // Get mobile money bank code
      const payoutService = require('../../services/payoutService');
      const network = paymentDetails.network || methodToNetwork[paymentMethod];
      const mobileBankCode = payoutService.getMobileMoneyBankCode(network);
      
      if (!mobileBankCode) {
        await session.abortTransaction();
        return next(new AppError('Invalid mobile money network. Supported networks: MTN, Vodafone, AirtelTigo', 400));
      }
      
      // Format phone number - remove any spaces, dashes, or non-digit characters
      // Paystack expects phone number in format: 0551234987 (Ghana format)
      const formattedPhone = paymentDetails.phone.replace(/\D/g, ''); // Remove non-digits
      
      // Validate phone number format (should be 10 digits for Ghana)
      if (formattedPhone.length !== 10) {
        await session.abortTransaction();
        return next(new AppError(`Invalid phone number format. Expected 10 digits, got ${formattedPhone.length}. Phone: ${paymentDetails.phone}`, 400));
      }
      
      // Build recipient data directly from payment details (Paystack format)
      recipientData = {
        type: 'mobile_money',
        name: paymentDetails.accountName || seller.name || seller.shopName,
        account_number: formattedPhone, // Use formatted phone number
        bank_code: mobileBankCode, // MTN, VOD, or ATL
        currency: 'GHS',
      };
      
      logger.info('[approveWithdrawalRequest] Mobile money recipient data from request:', {
        phone: paymentDetails.phone,
        network: network,
        bank_code: mobileBankCode,
        paymentMethod,
      });
    } else if (paymentMethod === 'bank') {
      // Validate bank account details
      if (!paymentDetails.accountNumber || !paymentDetails.accountName || !paymentDetails.bankName) {
        await session.abortTransaction();
        return next(new AppError('Bank account details are incomplete. Please ensure account number, account name, and bank name are provided.', 400));
      }
      
      // Get bank code - use stored bankCode or map from bankName
      const payoutService = require('../../services/payoutService');
      let bankCode = paymentDetails.bankCode;
      if (!bankCode && paymentDetails.bankName) {
        bankCode = payoutService.getBankCodeFromName(paymentDetails.bankName);
        logger.info(`[approveWithdrawalRequest] Mapped bank name "${paymentDetails.bankName}" to code: ${bankCode}`);
      }
      
      if (!bankCode) {
        const errorMsg = paymentDetails.bankName 
          ? `Invalid bank name: "${paymentDetails.bankName}". Please provide a valid bank code or use a supported bank name.`
          : 'Bank code is required. Please ensure the payment request has a valid bank code.';
        await session.abortTransaction();
        return next(new AppError(errorMsg, 400));
      }
      
      // Validate bank code format (should be 3 digits for Ghana banks)
      if (!/^\d{3}$/.test(bankCode)) {
        logger.warn(`[approveWithdrawalRequest] Bank code format may be invalid: ${bankCode}`);
      }
      
      // Format account number - remove any spaces or dashes
      const formattedAccountNumber = paymentDetails.accountNumber.replace(/\s+/g, '');
      
      // Build recipient data directly from payment details (Paystack format)
      recipientData = {
        type: 'nuban',
        name: paymentDetails.accountName,
        account_number: formattedAccountNumber,
        bank_code: bankCode, // 3-digit bank code (e.g., "044", "050")
        currency: 'GHS',
      };
      
      logger.info('[approveWithdrawalRequest] Bank recipient data from request:', {
        accountNumber: paymentDetails.accountNumber,
        accountName: paymentDetails.accountName,
        bankName: paymentDetails.bankName,
        bank_code: bankCode,
      });
    } else {
      await session.abortTransaction();
      return next(new AppError(`Unsupported payment method: ${paymentMethod}`, 400));
    }
    
    // Create recipient using recipientData built from payment request details
    try {
      const { paystackApi, PAYSTACK_ENDPOINTS } = require('../../config/paystack');
      const response = await paystackApi.post(PAYSTACK_ENDPOINTS.CREATE_RECIPIENT, recipientData);

      if (response.data.status && response.data.data) {
        recipientCode = response.data.data.recipient_code;
        logger.info('[approveWithdrawalRequest] Created recipient from payment details:', {
          recipientCode,
          paymentMethod,
        });
      } else {
        throw new AppError('Failed to create Paystack recipient', 500);
      }
    } catch (recipientError) {
      // Don't abort here - let outer catch handle it to avoid double abort
      logger.error('[approveWithdrawalRequest] Error creating recipient:', recipientError);
      throw recipientError; // Re-throw to be caught by outer catch
    }

    // Initiate Paystack transfer
    const transferResult = await payoutService.initiatePayout(
      withdrawalRequest.amount,
      recipientCode,
      `Payout for ${seller.shopName || seller.name} - Request #${withdrawalRequest._id}`
    );

    logger.info('💳 [approveWithdrawalRequest] Paystack transfer initiated:', {
      transferCode: transferResult.transfer_code,
      status: transferResult.status,
      transferData: transferResult.transfer_data
    });

    // Check if transfer requires PIN (for mobile money transfers)
    // For mobile money, Paystack typically requires PIN via SMS
    // Check transfer_data for requires_approval or otp status
    const transferData = transferResult.transfer_data || {};
    const paystackStatus = transferResult.status; // This is Paystack's actual status
    
    // CRITICAL: Check Paystack's ACTUAL status, not our assumptions
    const requiresPin = paystackStatus === 'otp' || 
                        transferData.requires_approval === 1 ||
                        transferData.requires_approval === true ||
                        (isMobileMoney && (paystackStatus === 'pending' || paystackStatus === 'otp'));

    logger.info('💳 [approveWithdrawalRequest] Paystack transfer status analysis:', {
      paystackStatus: paystackStatus,
      isMobileMoney: isMobileMoney,
      requiresPin: requiresPin,
      transferDataRequiresApproval: transferData.requires_approval,
      willSetStatusToAwaitingOtp: (isMobileMoney || requiresPin)
    });

    // For mobile money, always require PIN and set status to processing
    // For bank transfers, set status based on transfer result
    const finalRequiresPin = isMobileMoney ? true : requiresPin;
    
    // IMPORTANT: Only set to 'awaiting_paystack_otp' if Paystack status is actually 'otp'
    // Otherwise, Paystack won't accept OTP verification
    const shouldAwaitOtp = (isMobileMoney || requiresPin) && paystackStatus === 'otp';
    const finalStatus = shouldAwaitOtp ? 'awaiting_paystack_otp' : 
                       (isMobileMoney ? 'processing' : (requiresPin ? 'processing' : 'paid'));
    
    logger.info('💳 [approveWithdrawalRequest] Setting withdrawal status:', {
      finalStatus: finalStatus,
      shouldAwaitOtp: shouldAwaitOtp,
      paystackStatus: paystackStatus,
      reason: shouldAwaitOtp ? 'Paystack status is "otp" - will await OTP' : 
              `Paystack status is "${paystackStatus}" - cannot await OTP`
    });

    // Security check: Double-check status before updating (prevent race conditions)
    const currentRequest = await PaymentRequest.findById(id).session(session);
    if (!currentRequest) {
      const currentWithdrawalRequest = await WithdrawalRequest.findById(id).session(session);
      if (!currentWithdrawalRequest) {
        await session.abortTransaction();
        return next(new AppError('Withdrawal request not found', 404));
      }
      if (currentWithdrawalRequest.status !== 'pending') {
        await session.abortTransaction();
        return next(new AppError(`Withdrawal request status changed to ${currentWithdrawalRequest.status}. Cannot proceed with approval.`, 400));
      }
      if (currentWithdrawalRequest.isActive === false) {
        await session.abortTransaction();
        return next(new AppError('Withdrawal request was deactivated. Cannot proceed with approval.', 400));
      }
    } else {
      if (currentRequest.status !== 'pending') {
        await session.abortTransaction();
        return next(new AppError(`Withdrawal request status changed to ${currentRequest.status}. Cannot proceed with approval.`, 400));
      }
      if (currentRequest.isActive === false) {
        await session.abortTransaction();
        return next(new AppError('Withdrawal request was deactivated. Cannot proceed with approval.', 400));
      }
    }

    // Calculate withholding tax and create TaxCollection record
    const TaxCollection = require('../../models/tax/taxCollectionModel');
    const withholdingTax = withdrawalRequest.withholdingTax || 0;
    const withholdingTaxRate = withdrawalRequest.withholdingTaxRate || 0;
    const taxCategory = seller.taxCategory || 'individual';
    
    // Create TaxCollection record when admin approves withdrawal
    if (withholdingTax > 0) {
      const taxCollection = await TaxCollection.create([{
        sellerId: seller._id,
        withdrawalId: withdrawalRequest._id,
        amount: withholdingTax,
        rate: withholdingTaxRate,
        taxCategory: taxCategory,
        dateCollected: new Date(),
        remitted: false,
        metadata: {
          amountRequested: withdrawalRequest.amountRequested || withdrawalRequest.amount,
          amountPaidToSeller: withdrawalRequest.amountPaidToSeller || (withdrawalRequest.amount - withholdingTax),
        },
      }], { session });
      
      logger.info(`[approveWithdrawalRequest] Created TaxCollection record: ${taxCollection[0]._id}, Amount: ${withholdingTax}, Rate: ${withholdingTaxRate}`);
    }

    // Prepare admin tracking data
    const adminTrackingData = {
      adminId: admin._id,
      name: admin.name || admin.email,
      email: admin.email,
      role: admin.role,
      timestamp: new Date(),
      ipAddress: ipAddress,
      userAgent: userAgent,
    };

    // Update withdrawal request (handle both models)
    if (isPaymentRequest) {
      // Update PaymentRequest
      const paymentRequest = await PaymentRequest.findById(id).session(session);
      // Set status based on Paystack's actual transfer status
      // Only set to 'awaiting_paystack_otp' if Paystack status is 'otp'
      paymentRequest.status = finalStatus;
      paymentRequest.paystackTransferCode = transferResult.transfer_code;
      paymentRequest.transactionId = transferResult.reference;
      paymentRequest.processedAt = new Date();
      paymentRequest.approvedAt = new Date(); // Mark as approved
      paymentRequest.requiresPin = finalRequiresPin;
      paymentRequest.pinSubmitted = false;
      
      // Add admin tracking
      paymentRequest.approvedByAdmin = adminTrackingData;
      paymentRequest.rejectedByAdmin = null; // Clear rejection if exists
      
      // Add to audit history
      if (!paymentRequest.auditHistory) {
        paymentRequest.auditHistory = [];
      }
      paymentRequest.auditHistory.push({
        action: 'approved',
        ...adminTrackingData,
      });
      
      await paymentRequest.save({ session });
      withdrawalRequest = paymentRequest.toObject();
    } else {
      // Update WithdrawalRequest
      // Set to 'awaiting_paystack_otp' for mobile money or if PIN is required
      // Set status based on Paystack's actual transfer status
      // Only set to 'awaiting_paystack_otp' if Paystack status is 'otp'
      withdrawalRequest.status = finalStatus;
      withdrawalRequest.paystackRecipientCode = recipientCode;
      withdrawalRequest.paystackTransferId = transferResult.transfer_id;
      withdrawalRequest.paystackTransferCode = transferResult.transfer_code;
      withdrawalRequest.paystackReference = transferResult.reference;
      withdrawalRequest.requiresPin = finalRequiresPin; // Always true for mobile money
      withdrawalRequest.pinSubmitted = false;
      withdrawalRequest.processedBy = adminId;
      withdrawalRequest.processedAt = new Date();
      
      // Add admin tracking
      withdrawalRequest.approvedByAdmin = adminTrackingData;
      withdrawalRequest.rejectedByAdmin = null; // Clear rejection if exists
      
      // Add to audit history
      if (!withdrawalRequest.auditHistory) {
        withdrawalRequest.auditHistory = [];
      }
      withdrawalRequest.auditHistory.push({
        action: 'approved',
        ...adminTrackingData,
      });
      
      await withdrawalRequest.save({ session });
    }

    // Create AdminActionLog entry
    const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
    const amountPaid = withdrawalRequest.amountPaidToSeller || amountRequested;
    // Reuse withholdingTax from earlier in the function (line 465)
    const auditWithholdingTax = withdrawalRequest.withholdingTax || withholdingTax || 0;

    await AdminActionLog.create([{
      adminId: admin._id,
      name: admin.name || admin.email,
      email: admin.email,
      role: admin.role,
      actionType: 'WITHDRAWAL_APPROVED',
      withdrawalId: withdrawalRequest._id,
      withdrawalType: isPaymentRequest ? 'PaymentRequest' : 'WithdrawalRequest',
      sellerId: withdrawalRequest.seller,
      amountRequested: amountRequested,
      amountPaid: amountPaid,
      withholdingTax: auditWithholdingTax,
      timestamp: new Date(),
      ipAddress: ipAddress,
      userAgent: userAgent,
      metadata: {
        paystackTransferCode: transferResult.transfer_code,
        paystackReference: transferResult.reference,
        requiresPin: finalRequiresPin,
        isMobileMoney: isMobileMoney,
      },
    }], { session });

    // When admin approves, the withdrawal is in pendingBalance (awaiting OTP)
    // Balance (total revenue) is NOT deducted yet - only when OTP is verified
    // But we need to ensure withdrawableBalance is correctly calculated
    // Available Balance = balance - lockedBalance - pendingBalance
    const oldBalance = seller.balance || 0;
    const oldPendingBalance = seller.pendingBalance || 0;
    const oldLockedBalance = seller.lockedBalance || 0;
    const oldWithdrawableBalance = seller.withdrawableBalance || 0;
    
    // Recalculate withdrawableBalance (balance - lockedBalance - pendingBalance)
    seller.calculateWithdrawableBalance();
    const newWithdrawableBalance = seller.withdrawableBalance || 0;
    
    await seller.save({ session });
    
    logger.info(`[approveWithdrawalRequest] Balance after admin approval for seller ${seller._id}:`);
    logger.info(`  Total Revenue (Balance);: ${oldBalance} (unchanged - will deduct when OTP verified)`);
    logger.info(`  Pending Balance: ${oldPendingBalance} (unchanged - awaiting OTP verification);`);
    logger.info(`  Locked Balance: ${oldLockedBalance} (unchanged);`);
    logger.info(`  Available Balance: ${oldWithdrawableBalance} → ${newWithdrawableBalance} (recalculated);`);

    // Create transaction record
    const transaction = await Transaction.create(
      [
        {
          seller: seller._id,
          amount: withdrawalRequest.amount,
          type: 'debit',
          description: `Withdrawal Payout - Request #${withdrawalRequest._id}`,
          status: 'pending', // Will be updated when transfer is verified
          metadata: {
            withdrawalRequestId: withdrawalRequest._id,
            paystackReference: transferResult.reference,
            paystackTransferCode: transferResult.transfer_code,
            processedBy: adminId,
          },
        },
      ],
      { session }
    );

    // Link transaction to request (only for WithdrawalRequest, PaymentRequest doesn't have this field)
    if (!isPaymentRequest) {
      withdrawalRequest.transaction = transaction[0]._id;
      await withdrawalRequest.save({ session });
    }

    await session.commitTransaction();

    // Verify transfer status asynchronously (don't wait) - only for WithdrawalRequest
    // BUT: Don't auto-update to 'paid' if PIN is required - seller must submit PIN first
    if (!isPaymentRequest && !finalRequiresPin && !isMobileMoney) {
      // Only auto-verify if PIN is not required (bank transfers that don't need PIN)
      payoutService
        .verifyTransferStatus(transferResult.transfer_id)
        .then(async (transferStatus) => {
          await updateWithdrawalStatusFromPaystack(withdrawalRequest._id, transferStatus, finalRequiresPin);
        })
        .catch((error) => {
          logger.error('[approveWithdrawalRequest] Error verifying transfer:', error);
          // Will be verified later via polling or webhook
        });
    } else if (!isPaymentRequest && (finalRequiresPin || isMobileMoney)) {
      // For mobile money with PIN requirement, verify status but don't auto-update to paid
      payoutService
        .verifyTransferStatus(transferResult.transfer_id)
        .then(async (transferStatus) => {
          // Update requiresPin flag if verification confirms it, but keep status as processing
          const withdrawal = await WithdrawalRequest.findById(withdrawalRequest._id);
          if (withdrawal) {
            // Ensure requiresPin is set for mobile money
            if (isMobileMoney && !withdrawal.requiresPin) {
              withdrawal.requiresPin = true;
            }
            // Keep status as processing until PIN is submitted
            if (withdrawal.status !== 'processing') {
              withdrawal.status = 'processing';
            }
            await withdrawal.save();
          }
        })
        .catch((error) => {
          logger.error('[approveWithdrawalRequest] Error verifying transfer:', error);
        });
    }

    // Determine response message based on payment method and PIN requirement
    let message = 'Withdrawal request approved and transfer initiated';
    if (isMobileMoney || finalRequiresPin) {
      message = 'Withdrawal request approved. A PIN has been sent to the seller\'s mobile number. The seller must submit the PIN to complete the transfer.';
    }

    // Fetch updated seller balance information for response
    const updatedSeller = await Seller.findById(seller._id)
      .select('balance lockedBalance pendingBalance withdrawableBalance')
      .lean();
    
    // Send withdrawal request confirmation email to seller
    try {
      const emailDispatcher = require('../../emails/emailDispatcher');
      await emailDispatcher.sendWithdrawalRequest(seller, withdrawalRequest);
      logger.info(`[approveWithdrawalRequest] ✅ Withdrawal request email sent to seller ${seller.email}`);
    } catch (emailError) {
      logger.error('[approveWithdrawalRequest] Error sending withdrawal request email:', emailError.message);
      // Don't fail withdrawal if email fails
    }
    
    res.status(200).json({
      status: 'success',
      message: message,
      data: {
        withdrawalRequest,
        transfer: transferResult,
        requiresPin: finalRequiresPin,
        isMobileMoney: isMobileMoney,
        sellerBalance: {
          totalRevenue: updatedSeller.balance || 0,
          lockedBalance: updatedSeller.lockedBalance || 0,
          pendingBalance: updatedSeller.pendingBalance || 0,
          availableBalance: updatedSeller.withdrawableBalance || 0,
          note: 'Available balance = Total Revenue - Locked Balance - Pending Balance. Balance will be deducted when seller verifies OTP.',
        },
        message: (isMobileMoney || finalRequiresPin)
          ? 'The seller will receive a PIN via SMS. They need to submit this PIN to complete the transfer.'
          : undefined,
      },
    });
  } catch (error) {
    // Abort transaction if still active (wrap in try-catch to handle if already aborted)
    try {
      await session.abortTransaction();
    } catch (abortError) {
      // Ignore abort errors (transaction might already be aborted or committed)
      // This can happen if an error occurred after abortTransaction was already called
      if (abortError.message && !abortError.message.includes('Cannot call abortTransaction twice')) {
        logger.warn('[approveWithdrawalRequest] Transaction abort error:', abortError.message);
      }
    }
    
    logger.error('[approveWithdrawalRequest] Error:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status,
      withdrawalRequestId: id,
      sellerId: withdrawalRequest?.seller || withdrawalRequest?.seller?._id || null,
    });

    if (error instanceof AppError) {
      return next(error);
    }

    // Provide more specific error message
    const errorMessage = error.response?.data?.message 
      ? `Paystack error: ${error.response.data.message}`
      : error.message || 'Failed to approve withdrawal request';
    
    return next(new AppError(errorMessage, error.response?.status || 500));
  } finally {
    session.endSession();
  }
});

/**
 * Reject a withdrawal request
 * Handles both WithdrawalRequest (new) and PaymentRequest (existing) models
 * POST /api/v1/admin/payout/request/:id/reject
 */
exports.rejectWithdrawalRequest = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user.id;

  // Role restriction: Only superadmin and admin can reject withdrawals
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return next(new AppError('Not authorized to reject withdrawals. Only superadmin and admin can reject.', 403));
  }

  // Get full admin details for tracking
  const admin = await Admin.findById(adminId);
  if (!admin) {
    return next(new AppError('Admin not found', 404));
  }

  // Capture IP address and user agent
  const ipAddress = getIpAddress(req);
  const userAgent = req.headers['user-agent'] || 'unknown';

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Try WithdrawalRequest first
    let withdrawalRequest = await WithdrawalRequest.findById(id).session(session);
    let isPaymentRequest = false;

    // If not found, try PaymentRequest
    if (!withdrawalRequest) {
      const paymentRequest = await PaymentRequest.findById(id).session(session);
      if (!paymentRequest) {
        await session.abortTransaction();
        return next(new AppError('Withdrawal request not found', 404));
      }
      isPaymentRequest = true;
      withdrawalRequest = paymentRequest;
    }

    if (withdrawalRequest.status !== 'pending') {
      await session.abortTransaction();
      return next(
        new AppError(`Cannot reject withdrawal request with status: ${withdrawalRequest.status}`, 400)
      );
    }

    // Get seller
    const seller = await Seller.findById(withdrawalRequest.seller).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // CRITICAL FIX: Refund from pendingBalance, not balance
    // When withdrawal is rejected, the amount is in pendingBalance, not balance
    const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
    const oldPendingBalance = seller.pendingBalance || 0;
    const oldBalance = seller.balance || 0;
    
    // Validate pendingBalance has the amount
    if (amountRequested > oldPendingBalance) {
      logger.warn(`[rejectWithdrawalRequest] Pending balance (${oldPendingBalance}); is less than requested amount (${amountRequested}). Proceeding with refund anyway.`);
    }
    
    // Refund from pendingBalance (the amount was moved to pendingBalance when request was created)
    seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
    
    // Balance should NOT be modified - it was never deducted
    // Only pendingBalance is refunded, which increases available balance
    
    seller.calculateWithdrawableBalance();
    await seller.save({ session });
    
    logger.info(`[rejectWithdrawalRequest] Pending balance refund for seller ${seller._id}:`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${amountRequested} = ${seller.pendingBalance}`);
    logger.info(`  Total Balance: ${oldBalance} (unchanged);`);
    logger.info(`  Available Balance: ${seller.withdrawableBalance}`);
    
    // Log finance audit
    try {
      const financeAudit = require('../../services/financeAuditService');
      await financeAudit.logWithdrawalRefunded(
        seller._id,
        amountRequested,
        withdrawalRequest._id,
        oldPendingBalance,
        seller.pendingBalance,
        `Rejected by admin: ${reason || 'No reason provided'}`
      );
    } catch (auditError) {
      logger.error('[rejectWithdrawalRequest] Failed to log finance audit (non-critical);:', auditError);
    }
    
    // Log seller revenue history for rejected withdrawal refund
    // Note: This is a pendingBalance refund, not a balance refund
    try {
      await logSellerRevenue({
        sellerId: seller._id,
        amount: 0, // No balance change - only pendingBalance refund
        type: 'REVERSAL',
        description: `Withdrawal rejected by admin - PendingBalance refund: GH₵${amountRequested.toFixed(2)}`,
        reference: `WITHDRAWAL-REJECTED-${withdrawalRequest._id}-${Date.now()}`,
        payoutRequestId: withdrawalRequest._id,
        adminId: adminId,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance, // Balance unchanged
        metadata: {
          withdrawalRequestId: withdrawalRequest._id.toString(),
          rejectionReason: req.body.reason || 'Rejected by admin',
          rejectedBy: adminId,
          isPaymentRequest,
          pendingBalanceBefore: oldPendingBalance,
          pendingBalanceAfter: seller.pendingBalance,
          refundType: 'pendingBalance_refund', // Indicates this is a pendingBalance refund
        },
      });
      logger.info(`[rejectWithdrawalRequest] ✅ Seller revenue history logged for rejected withdrawal refund - seller ${seller._id}`);
    } catch (historyError) {
      logger.error(`[rejectWithdrawalRequest] Failed to log seller revenue history (non-critical); for seller ${seller._id}:`, {
        error: historyError.message,
        stack: historyError.stack,
      });
    }

    // Prepare admin tracking data
    const adminTrackingData = {
      adminId: admin._id,
      name: admin.name || admin.email,
      email: admin.email,
      role: admin.role,
      timestamp: new Date(),
      ipAddress: ipAddress,
      userAgent: userAgent,
    };

    // Update withdrawal request (handle both models)
    if (isPaymentRequest) {
      // Update PaymentRequest
      const paymentRequest = await PaymentRequest.findById(id).session(session);
      paymentRequest.status = 'rejected';
      paymentRequest.rejectionReason = reason || 'Rejected by admin';
      paymentRequest.processedAt = new Date();
      paymentRequest.rejectedAt = new Date(); // Mark rejection time
      
      // Add admin tracking
      paymentRequest.rejectedByAdmin = adminTrackingData;
      paymentRequest.approvedByAdmin = null; // Clear approval if exists
      
      // Add to audit history
      if (!paymentRequest.auditHistory) {
        paymentRequest.auditHistory = [];
      }
      paymentRequest.auditHistory.push({
        action: 'rejected',
        ...adminTrackingData,
      });
      
      await paymentRequest.save({ session });
      withdrawalRequest = paymentRequest.toObject();
    } else {
      // Update WithdrawalRequest
      withdrawalRequest.status = 'rejected';
      withdrawalRequest.rejectionReason = reason || 'Rejected by admin';
      withdrawalRequest.processedBy = adminId;
      withdrawalRequest.processedAt = new Date();
      withdrawalRequest.rejectedAt = new Date(); // Mark rejection time
      
      // Add admin tracking
      withdrawalRequest.rejectedByAdmin = adminTrackingData;
      withdrawalRequest.approvedByAdmin = null; // Clear approval if exists
      
      // Add to audit history
      if (!withdrawalRequest.auditHistory) {
        withdrawalRequest.auditHistory = [];
      }
      withdrawalRequest.auditHistory.push({
        action: 'rejected',
        ...adminTrackingData,
      });
      
      await withdrawalRequest.save({ session });
    }

    // Create AdminActionLog entry
    // amountRequested already declared at line 832

    await AdminActionLog.create([{
      adminId: admin._id,
      name: admin.name || admin.email,
      email: admin.email,
      role: admin.role,
      actionType: 'WITHDRAWAL_REJECTED',
      withdrawalId: withdrawalRequest._id,
      withdrawalType: isPaymentRequest ? 'PaymentRequest' : 'WithdrawalRequest',
      sellerId: withdrawalRequest.seller,
      amountRequested: amountRequested,
      amountPaid: 0, // No payment on rejection
      withholdingTax: 0,
      timestamp: new Date(),
      ipAddress: ipAddress,
      userAgent: userAgent,
      rejectionReason: reason || 'Rejected by admin',
      metadata: {
        rejectionReason: reason || 'Rejected by admin',
      },
    }], { session });

    await session.commitTransaction();

    // Send withdrawal rejected email to seller
    try {
      const emailDispatcher = require('../../emails/emailDispatcher');
      const Seller = require('../../models/user/sellerModel');
const logger = require('../../utils/logger');
      const seller = await Seller.findById(withdrawalRequest.seller).select('name email shopName').lean();
      
      if (seller && seller.email) {
        await emailDispatcher.sendWithdrawalRejected(seller, withdrawalRequest, reason || 'Rejected by admin');
        logger.info(`[rejectWithdrawalRequest] ✅ Withdrawal rejected email sent to seller ${seller.email}`);
      }
    } catch (emailError) {
      logger.error('[rejectWithdrawalRequest] Error sending withdrawal rejected email:', emailError.message);
      // Don't fail rejection if email fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Withdrawal request rejected',
      data: {
        withdrawalRequest,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[rejectWithdrawalRequest] Error:', error);
    return next(new AppError('Failed to reject withdrawal request', 500));
  } finally {
    session.endSession();
  }
});

/**
 * Reverse a completed withdrawal
 * POST /api/v1/admin/payout/request/:id/reverse
 * Body: { reason: string (required) }
 * 
 * This function reverses a completed/paid withdrawal by:
 * 1. Refunding the amount back to seller's balance
 * 2. Updating reversal fields (reversed, reversedAt, reversedBy, reverseReason)
 * 3. Creating transaction records
 * 4. Logging activity
 */
exports.reverseWithdrawal = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user.id;

  // Role restriction: Only superadmin and admin can reverse withdrawals
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return next(new AppError('Not authorized to reverse withdrawals. Only superadmin and admin can reverse.', 403));
  }

  // Validate reason
  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Reversal reason is required', 400));
  }

  // Get full admin details for tracking
  const admin = await Admin.findById(adminId);
  if (!admin) {
    return next(new AppError('Admin not found', 404));
  }

  // Capture IP address and user agent
  const ipAddress = getIpAddress(req);
  const userAgent = req.headers['user-agent'] || 'unknown';

  const session = await mongoose.startSession();
  session.startTransaction();

  let withdrawalRequest = null;
  let isPaymentRequest = false;

  try {
    // Try PaymentRequest first, then WithdrawalRequest
    withdrawalRequest = await PaymentRequest.findById(id).session(session);
    isPaymentRequest = true;

    if (!withdrawalRequest) {
      withdrawalRequest = await WithdrawalRequest.findById(id).session(session);
      isPaymentRequest = false;
    }

    if (!withdrawalRequest) {
      await session.abortTransaction();
      return next(new AppError('Withdrawal request not found', 404));
    }

    // Check if already reversed
    if (withdrawalRequest.reversed === true) {
      await session.abortTransaction();
      return next(new AppError('This withdrawal has already been reversed', 400));
    }

    // Only allow reversing completed/paid withdrawals
    const reversibleStatuses = ['paid', 'approved', 'success', 'processing'];
    if (!reversibleStatuses.includes(withdrawalRequest.status)) {
      await session.abortTransaction();
      return next(
        new AppError(
          `Cannot reverse withdrawal with status: ${withdrawalRequest.status}. Only completed/paid withdrawals can be reversed.`,
          400
        )
      );
    }

    // Get seller
    const seller = await Seller.findById(withdrawalRequest.seller).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // Calculate amounts
    const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
    const withholdingTax = withdrawalRequest.withholdingTax || 0;
    const amountPaidToSeller = withdrawalRequest.amountPaidToSeller || (amountRequested - withholdingTax);

    // CRITICAL FIX: For completed/paid withdrawals, refund to balance
    // For pending/processing withdrawals, refund from pendingBalance
    const oldBalance = seller.balance || 0;
    const oldPendingBalance = seller.pendingBalance || 0;
    
    // Check if withdrawal was already paid (balance was deducted)
    const wasPaid = ['paid', 'success'].includes(withdrawalRequest.status);
    
    if (wasPaid) {
      // Refund to balance (money was already deducted from balance)
      seller.balance = oldBalance + amountRequested;
    } else {
      // Refund from pendingBalance (money was in pendingBalance, not deducted from balance)
      if (oldPendingBalance >= amountRequested) {
        seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
      } else {
        logger.warn(`[reverseWithdrawal] Pending balance (${oldPendingBalance}); is less than requested amount (${amountRequested})`);
        seller.pendingBalance = 0;
      }
    }
    
    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    await seller.save({ session });
    
    logger.info(`[reverseWithdrawal] Refund for seller ${seller._id}:`, {
      wasPaid,
      amountRequested,
      oldBalance,
      newBalance: seller.balance,
      oldPendingBalance,
      newPendingBalance: seller.pendingBalance,
    });

    // Update withdrawal request with reversal fields
    withdrawalRequest.reversed = true;
    withdrawalRequest.reversedAt = new Date();
    withdrawalRequest.reversedBy = adminId; // Admin who reversed the withdrawal
    withdrawalRequest.reverseReason = reason.trim();
    withdrawalRequest.status = 'reversed'; // Update status to reversed

    // Add to audit history
    if (!withdrawalRequest.auditHistory) {
      withdrawalRequest.auditHistory = [];
    }
    withdrawalRequest.auditHistory.push({
      action: 'reversed',
      adminId: admin._id,
      name: admin.name || admin.email,
      role: admin.role,
      timestamp: new Date(),
      ipAddress: ipAddress,
      userAgent: userAgent,
    });

    await withdrawalRequest.save({ session });

    // Create transaction record for reversal
    await Transaction.create(
      [
        {
          seller: withdrawalRequest.seller,
          amount: amountRequested,
          type: 'credit',
          description: `Withdrawal Reversal - Refund for Request #${withdrawalRequest._id}. Reason: ${reason}`,
          status: 'completed',
          metadata: {
            withdrawalRequestId: withdrawalRequest._id,
            action: 'withdrawal_reversal',
            reversedAt: new Date(),
            reversedBy: adminId,
            reverseReason: reason,
            originalAmount: amountRequested,
            withholdingTax: withholdingTax,
            amountPaidToSeller: amountPaidToSeller,
          },
        },
      ],
      { session }
    );

    // Log seller revenue history
    try {
      await logSellerRevenue({
        sellerId: withdrawalRequest.seller,
        amount: amountRequested, // Positive for refund
        type: 'REVERSAL',
        description: `Withdrawal reversed by admin - Refund: GH₵${amountRequested.toFixed(2)}. Reason: ${reason}`,
        reference: `WITHDRAWAL-REVERSE-${withdrawalRequest._id}-${Date.now()}`,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance,
        metadata: {
          withdrawalRequestId: withdrawalRequest._id.toString(),
          action: 'withdrawal_reversal',
          originalAmount: amountRequested,
          withholdingTax: withholdingTax,
          amountPaidToSeller: amountPaidToSeller,
          reversedBy: adminId,
          reverseReason: reason,
        },
      });
      logger.info(`[reverseWithdrawal] ✅ Seller revenue history logged for withdrawal reversal - seller ${withdrawalRequest.seller}`);
    } catch (historyError) {
      logger.error(`[reverseWithdrawal] Failed to log seller revenue history (non-critical);:`, {
        error: historyError.message,
        stack: historyError.stack,
      });
    }

    await session.commitTransaction();

    // Log activity
    const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
    logActivityAsync({
      userId: adminId,
      role: 'admin',
      action: 'WITHDRAWAL_REVERSED',
      description: `Admin reversed withdrawal request #${withdrawalRequest._id} - Amount: GH₵${amountRequested}. Reason: ${reason}`,
      req,
      metadata: {
        withdrawalRequestId: withdrawalRequest._id,
        amount: amountRequested,
        reverseReason: reason,
        sellerId: withdrawalRequest.seller,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Withdrawal reversed successfully. Amount has been refunded to seller balance.',
      data: {
        withdrawalRequest,
        refundedAmount: amountRequested,
        sellerBalanceBefore: oldBalance,
        sellerBalanceAfter: seller.balance,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[reverseWithdrawal] Error:', error);

    if (error instanceof AppError) {
      return next(error);
    }

    return next(new AppError('Failed to reverse withdrawal', 500));
  } finally {
    session.endSession();
  }
});

/**
 * Verify transfer status and update withdrawal request
 * POST /api/v1/admin/payout/request/:id/verify
 */
exports.verifyTransferStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Try PaymentRequest first, then WithdrawalRequest
  let withdrawalRequest = await PaymentRequest.findById(id);
  let isPaymentRequest = true;

  if (!withdrawalRequest) {
    withdrawalRequest = await WithdrawalRequest.findById(id);
    isPaymentRequest = false;
  }

  if (!withdrawalRequest) {
    return next(new AppError('Withdrawal request not found', 404));
  }

  // Get transfer ID from various possible fields
  const transferId = withdrawalRequest.paystackTransferId || 
                     withdrawalRequest.paystackReference || 
                     withdrawalRequest.paystackTransferCode ||
                     withdrawalRequest.transferCode;

  if (!transferId) {
    return next(new AppError('No Paystack transfer reference found', 400));
  }

  const transferStatus = await payoutService.verifyTransferStatus(transferId);

  // Update status based on Paystack's actual status
  // Handle both PaymentRequest and WithdrawalRequest models
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Reload the request with session
    let requestToUpdate;
    if (isPaymentRequest) {
      requestToUpdate = await PaymentRequest.findById(id).session(session);
    } else {
      requestToUpdate = await WithdrawalRequest.findById(id).session(session);
    }

    if (!requestToUpdate) {
      await session.abortTransaction();
      return next(new AppError('Withdrawal request not found', 404));
    }

    const oldStatus = requestToUpdate.status;
    let newStatus = oldStatus;

    // Map Paystack status to our status
    if (['success', 'completed', 'paid'].includes(transferStatus.status)) {
      // If Paystack says it's completed, update to 'paid'
      // But check if PIN was required and not submitted
      const pinRequired = requestToUpdate.requiresPin || transferStatus.requires_pin;
      if (!pinRequired || requestToUpdate.pinSubmitted) {
        newStatus = 'paid';
      } else {
        // PIN required but not submitted - keep as processing
        newStatus = 'processing';
      }
    } else if (transferStatus.status === 'failed' || transferStatus.status === 'reversed') {
      newStatus = 'failed';
    } else if (transferStatus.status === 'otp') {
      newStatus = 'awaiting_paystack_otp';
      if (!requestToUpdate.requiresPin) {
        requestToUpdate.requiresPin = true;
      }
    } else if (transferStatus.status === 'abandoned') {
      newStatus = 'failed';
      if (requestToUpdate.otpSessionStatus !== undefined) {
        requestToUpdate.otpSessionStatus = 'abandoned';
      }
    } else if (['pending', 'processing'].includes(transferStatus.status)) {
      newStatus = 'processing';
    }

    // When syncing to failed (failed/reversed/abandoned): remove from pendingBalance so amount returns to available; total revenue (balance) unchanged
    if (newStatus === 'failed' && oldStatus !== 'failed') {
      const amountRequested = requestToUpdate.amountRequested || requestToUpdate.amount || 0;
      const sellerToRefund = await Seller.findById(requestToUpdate.seller).session(session);
      if (sellerToRefund && amountRequested > 0) {
        const oldPending = sellerToRefund.pendingBalance || 0;
        if (oldPending >= amountRequested) {
          sellerToRefund.pendingBalance = Math.max(0, oldPending - amountRequested);
          sellerToRefund.calculateWithdrawableBalance(); // restores to available; total revenue unchanged
          await sellerToRefund.save({ session, validateBeforeSave: false });
          logger.info('[verifyTransferStatus] Removed from pendingBalance → back to available; total revenue unchanged:', { sellerId: sellerToRefund._id, amount: amountRequested, pendingBefore: oldPending, withdrawableAfter: sellerToRefund.withdrawableBalance });
        } else {
          logger.warn('[verifyTransferStatus] Pending balance less than amount, skipping refund', { oldPending, amountRequested });
        }
      }
    }

    // When syncing to paid, remove amount from seller's pendingBalance and balance
    if (newStatus === 'paid' && oldStatus !== 'paid') {
      const amountRequested = requestToUpdate.amountRequested || requestToUpdate.amount || 0;
      const sellerToUpdate = await Seller.findById(requestToUpdate.seller).session(session);
      if (sellerToUpdate && amountRequested > 0) {
        const oldPending = sellerToUpdate.pendingBalance || 0;
        const oldBalance = sellerToUpdate.balance || 0;
        if (oldPending >= amountRequested) {
          sellerToUpdate.pendingBalance = Math.max(0, oldPending - amountRequested);
          sellerToUpdate.balance = Math.max(0, oldBalance - amountRequested);
          sellerToUpdate.calculateWithdrawableBalance();
          await sellerToUpdate.save({ session, validateBeforeSave: false });
          logger.info('[verifyTransferStatus] Deducted from pendingBalance and balance (paid):', { sellerId: sellerToUpdate._id, amount: amountRequested, pendingBefore: oldPending, balanceBefore: oldBalance });
        } else {
          logger.warn('[verifyTransferStatus] Pending balance less than amount, skipping deduction', { oldPending, amountRequested });
        }
      }
    }

    // Update status if it changed
    if (newStatus !== oldStatus) {
      requestToUpdate.status = newStatus;
      await requestToUpdate.save({ session, validateBeforeSave: false });
      
      logger.info('[verifyTransferStatus] Status synced from Paystack:', {
        withdrawalId: id,
        oldStatus,
        newStatus,
        paystackStatus: transferStatus.status,
        isPaymentRequest,
      });
    }

    await session.commitTransaction();

    // Refetch updated withdrawal request
    let updatedRequest;
    if (isPaymentRequest) {
      updatedRequest = await PaymentRequest.findById(id)
        .populate('seller', 'name shopName email')
        .lean();
      // Transform to match WithdrawalRequest format
      updatedRequest = {
        ...updatedRequest,
        payoutMethod: updatedRequest.paymentMethod,
        type: 'payment-request',
      };
    } else {
      updatedRequest = await WithdrawalRequest.findById(id)
        .populate('seller', 'name shopName email')
        .populate('processedBy', 'name email')
        .lean();
    }

    // Send transfer-success email to seller when status synced to paid
    if (newStatus === 'paid' && oldStatus !== newStatus && updatedRequest && updatedRequest.seller && updatedRequest.seller.email) {
      try {
        const emailDispatcher = require('../../emails/emailDispatcher');
        await emailDispatcher.sendWithdrawalApproved(updatedRequest.seller, updatedRequest);
        logger.info('[verifyTransferStatus] ✅ Transfer success email sent to seller %s', updatedRequest.seller.email);
      } catch (emailError) {
        logger.error('[verifyTransferStatus] Error sending transfer success email:', emailError.message);
      }
    }

    res.status(200).json({
      status: 'success',
      message: oldStatus !== newStatus 
        ? `Transfer status synced. Updated from '${oldStatus}' to '${newStatus}' based on Paystack status.`
        : 'Transfer status verified',
      data: {
        withdrawalRequest: updatedRequest,
        transferStatus,
        statusChanged: oldStatus !== newStatus,
        oldStatus,
        newStatus,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[verifyTransferStatus] Error:', error);
    return next(
      error instanceof AppError
        ? error
        : new AppError('Failed to verify transfer status', 500)
    );
  } finally {
    session.endSession();
  }
});

/**
 * Helper function to update withdrawal status from Paystack transfer status
 * @param {String} withdrawalRequestId - Withdrawal request ID
 * @param {Object} transferStatus - Transfer status from Paystack
 * @param {Boolean} requiresPin - Whether PIN is required (prevents auto-update to 'paid')
 */
async function updateWithdrawalStatusFromPaystack(withdrawalRequestId, transferStatus, requiresPin = false) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const withdrawalRequest = await WithdrawalRequest.findById(withdrawalRequestId).session(session);
    if (!withdrawalRequest) {
      await session.abortTransaction();
      return;
    }

    const seller = await Seller.findById(withdrawalRequest.seller).session(session);
    if (!seller) {
      await session.abortTransaction();
      return;
    }

    let newStatus = withdrawalRequest.status;
    let shouldUpdateTransaction = false;

    // Check if PIN is required from transfer status or withdrawal request
    const pinRequired = requiresPin || 
                       withdrawalRequest.requiresPin || 
                       transferStatus.requires_pin ||
                       transferStatus.status === 'otp';

    // Map Paystack status to our status
    // IMPORTANT: Don't change to 'paid' if PIN is required and not submitted
    if (transferStatus.status === 'success') {
      // Only mark as 'paid' if PIN is not required OR PIN has been submitted
      if (!pinRequired || withdrawalRequest.pinSubmitted) {
        newStatus = 'paid';
        shouldUpdateTransaction = true;
        // Remove amount from pendingBalance and balance now that payout is complete
        const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
        const oldPendingBalance = seller.pendingBalance || 0;
        const oldBalance = seller.balance || 0;
        if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
          seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
          seller.balance = Math.max(0, oldBalance - amountRequested);
          seller.calculateWithdrawableBalance();
          await seller.save({ session });
          logger.info(`[updateWithdrawalStatusFromPaystack] Deducted from pendingBalance and balance (paid): seller ${seller._id}, amount: ${amountRequested}`);
        }
      } else {
        // PIN required but not submitted - keep as processing
        newStatus = 'processing';
        // Update requiresPin flag if not already set
        if (!withdrawalRequest.requiresPin) {
          withdrawalRequest.requiresPin = true;
        }
      }
    } else if (transferStatus.status === 'failed') {
      newStatus = 'failed';
      shouldUpdateTransaction = true;
      // Remove from pendingBalance so amount returns to available; total revenue (balance) unchanged
      const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
      const oldPendingBalance = seller.pendingBalance || 0;
      if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
        seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
        seller.calculateWithdrawableBalance();
        await seller.save({ session });
        logger.info(`[updateWithdrawalStatusFromPaystack] Removed from pendingBalance (failed) → back to available; total revenue unchanged: seller ${seller._id}, amount: ${amountRequested}`);
      }
      try {
        await logSellerRevenue({
          sellerId: seller._id,
          amount: amountRequested,
          type: 'REVERSAL',
          description: `Transfer failed - Refund: GH₵${amountRequested.toFixed(2)}`,
          reference: `TRANSFER-FAILED-${withdrawalRequest._id}-${Date.now()}`,
          payoutRequestId: withdrawalRequest._id,
          balanceBefore: seller.balance,
          balanceAfter: seller.balance,
          metadata: {
            withdrawalRequestId: withdrawalRequest._id.toString(),
            transferStatus: 'failed',
            paystackTransferId: withdrawalRequest.paystackTransferId,
            reason: 'Transfer failed on Paystack',
            pendingBalanceRefund: true,
          },
        });
        logger.info(`[updateWithdrawalStatusFromPaystack] ✅ Seller revenue history logged for failed transfer refund - seller ${seller._id}`);
      } catch (historyError) {
        logger.error(`[updateWithdrawalStatusFromPaystack] Failed to log seller revenue history (non-critical); for seller ${seller._id}:`, {
          error: historyError.message,
          stack: historyError.stack,
        });
      }
    } else if (transferStatus.status === 'abandoned') {
      newStatus = 'failed';
      shouldUpdateTransaction = true;
      if (withdrawalRequest.otpSessionStatus !== undefined) {
        withdrawalRequest.otpSessionStatus = 'abandoned';
      }
      // Remove from pendingBalance so amount returns to available; total revenue (balance) unchanged
      const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
      const oldPendingBalance = seller.pendingBalance || 0;
      if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
        seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
        seller.calculateWithdrawableBalance();
        await seller.save({ session });
        logger.info(`[updateWithdrawalStatusFromPaystack] Removed from pendingBalance (abandoned) → back to available; total revenue unchanged: seller ${seller._id}, amount: ${amountRequested}`);
      }
    } else if (transferStatus.status === 'pending' || transferStatus.status === 'otp') {
      newStatus = 'processing';
      // Update requiresPin flag if status is 'otp'
      if (transferStatus.status === 'otp' && !withdrawalRequest.requiresPin) {
        withdrawalRequest.requiresPin = true;
      }
    } else if (transferStatus.status === 'reversed') {
      newStatus = 'failed';
      shouldUpdateTransaction = true;
      // Remove from pendingBalance so amount returns to available; total revenue (balance) unchanged
      const amountRequested = withdrawalRequest.amountRequested || withdrawalRequest.amount || 0;
      const oldPendingBalance = seller.pendingBalance || 0;
      if (amountRequested > 0 && oldPendingBalance >= amountRequested) {
        seller.pendingBalance = Math.max(0, oldPendingBalance - amountRequested);
        seller.calculateWithdrawableBalance();
        await seller.save({ session });
        logger.info(`[updateWithdrawalStatusFromPaystack] Removed from pendingBalance (reversed) → back to available; total revenue unchanged: seller ${seller._id}, amount: ${amountRequested}`);
      }
      try {
        await logSellerRevenue({
          sellerId: seller._id,
          amount: amountRequested,
          type: 'REVERSAL',
          description: `Transfer reversed - Refund: GH₵${amountRequested.toFixed(2)}`,
          reference: `TRANSFER-REVERSED-${withdrawalRequest._id}-${Date.now()}`,
          payoutRequestId: withdrawalRequest._id,
          balanceBefore: seller.balance,
          balanceAfter: seller.balance,
          metadata: {
            withdrawalRequestId: withdrawalRequest._id.toString(),
            transferStatus: 'reversed',
            paystackTransferId: withdrawalRequest.paystackTransferId,
            reason: 'Transfer reversed on Paystack',
            pendingBalanceRefund: true,
          },
        });
        logger.info(`[updateWithdrawalStatusFromPaystack] ✅ Seller revenue history logged for reversed transfer refund - seller ${seller._id}`);
      } catch (historyError) {
        logger.error(`[updateWithdrawalStatusFromPaystack] Failed to log seller revenue history (non-critical); for seller ${seller._id}:`, {
          error: historyError.message,
          stack: historyError.stack,
        });
      }
    }

    // Update withdrawal request
    const statusChanged = newStatus !== withdrawalRequest.status;
    const pinFlagChanged = pinRequired && !withdrawalRequest.requiresPin;
    
    if (statusChanged || pinFlagChanged) {
      withdrawalRequest.status = newStatus;
      if (pinFlagChanged) {
        withdrawalRequest.requiresPin = true;
      }
      await withdrawalRequest.save({ session });
    }

    // Update transaction status
    if (shouldUpdateTransaction && withdrawalRequest.transaction) {
      const transaction = await Transaction.findById(withdrawalRequest.transaction).session(session);
      if (transaction) {
        transaction.status = newStatus === 'paid' ? 'completed' : 'failed';
        await transaction.save({ session });
      }
    }

    // Send transfer-success email to seller when marked paid
    if (newStatus === 'paid' && seller && seller.email) {
      try {
        const emailDispatcher = require('../../emails/emailDispatcher');
        await emailDispatcher.sendWithdrawalApproved(seller, withdrawalRequest);
        logger.info('[updateWithdrawalStatusFromPaystack] ✅ Transfer success email sent to seller %s', seller.email);
      } catch (emailError) {
        logger.error('[updateWithdrawalStatusFromPaystack] Error sending transfer success email:', emailError.message);
      }
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    logger.error('[updateWithdrawalStatusFromPaystack] Error:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

