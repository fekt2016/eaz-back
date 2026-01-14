const Seller = require('../../models/user/sellerModel');
const { hasVerifiedPayoutMethod } = require('../../utils/helpers/paymentMethodHelpers');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');
const {
  findMatchingPaymentMethods,
  updatePaymentMethodVerification,
  getAccountIdentifier,
  checkAccountReuse,
  validateNameMatch,
  getPaymentMethodType,
} = require('../../utils/helpers/paymentMethodHelpers');

/**
 * Admin: Approve seller payout verification
 * PATCH /api/v1/admin/sellers/:id/payout/approve
 * Body: { paymentMethod: 'bank' | 'mtn_momo' | 'vodafone_cash' | 'airtel_tigo_money' }
 * 
 * Verifies seller's payout details (bank account or mobile money)
 * This is COMPLETELY SEPARATE from document verification
 */
exports.approvePayoutVerification = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { paymentMethod } = req.body;
  const adminId = req.user.id;

  if (!paymentMethod) {
    return next(new AppError('Payment method is required', 400));
  }

  if (!['bank', 'mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
    return next(new AppError('Invalid payment method', 400));
  }

  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check if this specific payment method is already verified
  let currentPaymentMethodStatus = 'pending';
  if (paymentMethod === 'bank' && seller.paymentMethods?.bankAccount) {
    currentPaymentMethodStatus = seller.paymentMethods.bankAccount.payoutStatus || 'pending';
  } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod) && seller.paymentMethods?.mobileMoney) {
    currentPaymentMethodStatus = seller.paymentMethods.mobileMoney.payoutStatus || 'pending';
  }

  // IDEMPOTENCY: If this specific payment method is already verified, return success
  if (currentPaymentMethodStatus === 'verified') {
    return res.status(200).json({
      status: 'success',
      data: {
        seller: {
          id: seller._id,
          shopName: seller.shopName,
          paymentMethod: paymentMethod,
          verificationStatus: 'verified',
        },
        message: `${paymentMethod === 'bank' ? 'Bank account' : 'Mobile money'} verification already approved`,
      },
    });
  }

  // Get payment details based on payment method
  let paymentDetails = null;
  if (paymentMethod === 'bank' && seller.paymentMethods?.bankAccount) {
    paymentDetails = seller.paymentMethods.bankAccount;
  } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod) && seller.paymentMethods?.mobileMoney) {
    paymentDetails = seller.paymentMethods.mobileMoney;
  }

  if (!paymentDetails) {
    return next(new AppError(`Payment details for ${paymentMethod} not found. Seller must add payment details first.`, 400));
  }

  // SECURITY: Name matching validation
  const sellerName = seller.name || seller.shopName;
  const accountName = paymentDetails.accountName;
  const nameValidation = validateNameMatch(sellerName, accountName);
  
  if (!nameValidation.isValid) {
    return next(new AppError(nameValidation.message, 400));
  }

  // SECURITY: Account reuse prevention
  const accountIdentifier = getAccountIdentifier(seller, paymentMethod);
  if (accountIdentifier) {
    const accountReuse = await checkAccountReuse(accountIdentifier, paymentMethod, seller._id);
    if (accountReuse) {
      const otherSeller = accountReuse.seller;
      return next(new AppError(
        `This ${paymentMethod === 'bank' ? 'bank account' : 'mobile money number'} is already verified for another seller (${otherSeller.name || otherSeller.shopName}). ` +
        `Each seller must use a unique payout account.`,
        400
      ));
    }
  }

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update verification status for the SPECIFIC payment method (not global)
    const oldStatus = currentPaymentMethodStatus;
    
    if (paymentMethod === 'bank' && seller.paymentMethods?.bankAccount) {
      seller.paymentMethods.bankAccount.payoutStatus = 'verified';
      seller.paymentMethods.bankAccount.payoutVerifiedAt = new Date();
      seller.paymentMethods.bankAccount.payoutVerifiedBy = adminId;
      seller.paymentMethods.bankAccount.payoutRejectionReason = null;
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod) && seller.paymentMethods?.mobileMoney) {
      seller.paymentMethods.mobileMoney.payoutStatus = 'verified';
      seller.paymentMethods.mobileMoney.payoutVerifiedAt = new Date();
      seller.paymentMethods.mobileMoney.payoutVerifiedBy = adminId;
      seller.paymentMethods.mobileMoney.payoutRejectionReason = null;
    }

    // Update global payoutStatus only if at least one payment method is verified
    // This is for backward compatibility and withdrawal checks
    const hasVerifiedBank = seller.paymentMethods?.bankAccount?.payoutStatus === 'verified';
    const hasVerifiedMobile = seller.paymentMethods?.mobileMoney?.payoutStatus === 'verified';
    if (hasVerifiedBank || hasVerifiedMobile) {
      seller.payoutStatus = 'verified';
      seller.payoutVerifiedAt = new Date();
      seller.payoutVerifiedBy = adminId;
      seller.payoutRejectionReason = null;
    }

    // Add to verification history
    if (!seller.payoutVerificationHistory) {
      seller.payoutVerificationHistory = [];
    }
    seller.payoutVerificationHistory.push({
      action: 'verified',
      adminId: adminId,
      timestamp: new Date(),
      paymentMethod: paymentMethod,
      paymentDetails: paymentDetails,
    });

    await seller.save({ validateBeforeSave: false, session });

    // Update PaymentMethod records if they match the verified payment details
    try {
      const matchingPaymentMethods = await findMatchingPaymentMethods(seller, paymentMethod);
      if (matchingPaymentMethods.length > 0) {
        await updatePaymentMethodVerification(matchingPaymentMethods, 'verified', adminId, null, session);
        console.log(`[Approve Payout Verification] Updated ${matchingPaymentMethods.length} PaymentMethod record(s) for seller ${seller._id}`);
      } else {
        console.log(`[Approve Payout Verification] No matching PaymentMethod records found for seller ${seller._id} (this is OK if seller doesn't have a User account)`);
      }
    } catch (paymentMethodError) {
      console.error('[Approve Payout Verification] Error updating PaymentMethod records:', paymentMethodError);
      // Don't fail verification approval if PaymentMethod update fails
    }

    // Log to AdminActionLog
    try {
      const AdminActionLog = require('../../models/admin/adminActionLogModel');
      await AdminActionLog.create([{
        adminId: adminId,
        name: req.user.name || req.user.email,
        email: req.user.email,
        role: req.user.role,
        actionType: 'PAYOUT_VERIFICATION_APPROVED',
        sellerId: seller._id,
        oldStatus: oldStatus,
        newStatus: 'verified',
        timestamp: new Date(),
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        metadata: {
          paymentMethod: paymentMethod,
          paymentDetails: {
            accountName: paymentDetails.accountName,
            accountNumber: paymentMethod === 'bank' ? paymentDetails.accountNumber : undefined,
            phone: paymentMethod !== 'bank' ? paymentDetails.phone : undefined,
          },
        },
      }], { session });
    } catch (logError) {
      console.error('[Approve Payout Verification] Error logging to AdminActionLog:', logError);
      // Don't fail verification if logging fails
    }

    // Commit transaction
    await session.commitTransaction();

    // Notify seller about payout verification approval (outside transaction)
    try {
      const notificationService = require('../../services/notification/notificationService');
      await notificationService.createVerificationNotification(
        seller._id,
        'seller',
        seller._id,
        'payout_approved'
      );
      console.log(`[Approve Payout Verification] Notification created for seller ${seller._id}`);
    } catch (notificationError) {
      console.error('[Approve Payout Verification] Error creating notification:', notificationError);
      // Don't fail verification approval if notification fails
    }

    const payoutCheck = hasVerifiedPayoutMethod(seller);
    res.status(200).json({
      status: 'success',
      data: {
        seller: {
          id: seller._id,
          shopName: seller.shopName,
          payoutStatus: payoutCheck.hasVerified ? 'verified' : 'pending',
          bankStatus: payoutCheck.bankStatus,
          mobileStatus: payoutCheck.mobileStatus,
        },
        message: 'Payout verification approved successfully',
      },
    });
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * Admin: Reject seller payout verification
 * PATCH /api/v1/admin/sellers/:id/payout/reject
 * Body: { reason: string (required) }
 * 
 * Rejects seller's payout details with a reason
 * This is COMPLETELY SEPARATE from document verification
 */
exports.rejectPayoutVerification = catchAsync(async (req, res, next) => {
  const { reason } = req.body;
  const { id } = req.params;
  const adminId = req.user.id;

  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Get current payment method for history
  const paymentMethod = getPaymentMethodType(seller);
  const paymentDetails = seller.paymentMethods?.bankAccount || seller.paymentMethods?.mobileMoney;
  
  if (!paymentMethod || !paymentDetails) {
    return next(new AppError('Seller has no payment method configured. Cannot reject payout verification.', 400));
  }

  // Check if this specific payment method is already rejected with same reason
  let currentPaymentMethodStatus = 'pending';
  let currentRejectionReason = null;
  if (paymentMethod === 'bank' && seller.paymentMethods?.bankAccount) {
    currentPaymentMethodStatus = seller.paymentMethods.bankAccount.payoutStatus || 'pending';
    currentRejectionReason = seller.paymentMethods.bankAccount.payoutRejectionReason;
  } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod) && seller.paymentMethods?.mobileMoney) {
    currentPaymentMethodStatus = seller.paymentMethods.mobileMoney.payoutStatus || 'pending';
    currentRejectionReason = seller.paymentMethods.mobileMoney.payoutRejectionReason;
  }

  // IDEMPOTENCY: If this specific payment method is already rejected with same reason, return success
  if (currentPaymentMethodStatus === 'rejected' && currentRejectionReason === reason.trim()) {
    return res.status(200).json({
      status: 'success',
      data: {
        seller: {
          id: seller._id,
          shopName: seller.shopName,
          paymentMethod: paymentMethod,
          verificationStatus: 'rejected',
          rejectionReason: currentRejectionReason,
        },
        message: `${paymentMethod === 'bank' ? 'Bank account' : 'Mobile money'} verification already rejected with this reason`,
      },
    });
  }

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update verification status for the SPECIFIC payment method (not global)
    const oldStatus = currentPaymentMethodStatus;
    
    if (paymentMethod === 'bank' && seller.paymentMethods?.bankAccount) {
      seller.paymentMethods.bankAccount.payoutStatus = 'rejected';
      seller.paymentMethods.bankAccount.payoutRejectionReason = reason.trim();
      seller.paymentMethods.bankAccount.payoutVerifiedAt = null;
      seller.paymentMethods.bankAccount.payoutVerifiedBy = null;
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod) && seller.paymentMethods?.mobileMoney) {
      seller.paymentMethods.mobileMoney.payoutStatus = 'rejected';
      seller.paymentMethods.mobileMoney.payoutRejectionReason = reason.trim();
      seller.paymentMethods.mobileMoney.payoutVerifiedAt = null;
      seller.paymentMethods.mobileMoney.payoutVerifiedBy = null;
    }

    // No global payoutStatus - each payment method has its own payoutStatus

    // Add to verification history
    if (!seller.payoutVerificationHistory) {
      seller.payoutVerificationHistory = [];
    }
    seller.payoutVerificationHistory.push({
      action: 'rejected',
      adminId: adminId,
      reason: reason.trim(),
      timestamp: new Date(),
      paymentMethod: paymentMethod,
      paymentDetails: paymentDetails,
    });

    await seller.save({ validateBeforeSave: false, session });

    // Update PaymentMethod records if they match the rejected payment details
    try {
      const matchingPaymentMethods = await findMatchingPaymentMethods(seller, paymentMethod);
      if (matchingPaymentMethods.length > 0) {
        await updatePaymentMethodVerification(matchingPaymentMethods, 'rejected', adminId, reason.trim(), session);
        console.log(`[Reject Payout Verification] Updated ${matchingPaymentMethods.length} PaymentMethod record(s) for seller ${seller._id}`);
      } else {
        console.log(`[Reject Payout Verification] No matching PaymentMethod records found for seller ${seller._id} (this is OK if seller doesn't have a User account)`);
      }
    } catch (paymentMethodError) {
      console.error('[Reject Payout Verification] Error updating PaymentMethod records:', paymentMethodError);
      // Don't fail verification rejection if PaymentMethod update fails
    }

    // Log to AdminActionLog
    try {
      const AdminActionLog = require('../../models/admin/adminActionLogModel');
      await AdminActionLog.create([{
        adminId: adminId,
        name: req.user.name || req.user.email,
        email: req.user.email,
        role: req.user.role,
        actionType: 'PAYOUT_VERIFICATION_REJECTED',
        sellerId: seller._id,
        oldStatus: oldStatus,
        newStatus: 'rejected',
        timestamp: new Date(),
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        rejectionReason: reason.trim(),
        metadata: {
          paymentMethod: paymentMethod,
          paymentDetails: {
            accountName: paymentDetails.accountName,
            accountNumber: paymentMethod === 'bank' ? paymentDetails.accountNumber : undefined,
            phone: paymentMethod !== 'bank' ? paymentDetails.phone : undefined,
          },
        },
      }], { session });
    } catch (logError) {
      console.error('[Reject Payout Verification] Error logging to AdminActionLog:', logError);
      // Don't fail verification if logging fails
    }

    // Commit transaction
    await session.commitTransaction();

    // Notify seller about payout verification rejection (outside transaction)
    try {
      const notificationService = require('../../services/notification/notificationService');
      await notificationService.createVerificationNotification(
        seller._id,
        'seller',
        seller._id,
        'payout_rejected'
      );
      console.log(`[Reject Payout Verification] Notification created for seller ${seller._id}`);
    } catch (notificationError) {
      console.error('[Reject Payout Verification] Error creating notification:', notificationError);
      // Don't fail verification rejection if notification fails
    }

    const payoutCheck = hasVerifiedPayoutMethod(seller);
    res.status(200).json({
      status: 'success',
      data: {
        seller: {
          id: seller._id,
          shopName: seller.shopName,
          payoutStatus: payoutCheck.hasVerified ? 'verified' : (payoutCheck.allRejected ? 'rejected' : 'pending'),
          bankStatus: payoutCheck.bankStatus,
          mobileStatus: payoutCheck.mobileStatus,
          rejectionReasons: payoutCheck.rejectionReasons,
        },
        message: 'Payout verification rejected',
      },
    });
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * Admin: Get seller payout verification details
 * GET /api/v1/admin/sellers/:id/payout
 * 
 * Returns seller's payout verification status and payment method details
 * Includes both seller.paymentMethods (embedded) and PaymentMethod records (separate model)
 */
exports.getPayoutVerificationDetails = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const seller = await Seller.findById(id).select(
    'name shopName email payoutVerificationHistory paymentMethods'
  );

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Also fetch PaymentMethod records if seller has a User account
  let paymentMethodRecords = [];
  try {
    const PaymentMethod = require('../../models/payment/PaymentMethodModel');
    const User = require('../../models/user/userModel');
    
    const userAccount = await User.findOne({ email: seller.email });
    if (userAccount) {
      paymentMethodRecords = await PaymentMethod.find({ user: userAccount._id })
        .sort({ isDefault: -1, createdAt: -1 })
        .select('type isDefault name provider mobileNumber bankName accountNumber accountName branch verificationStatus verifiedAt verifiedBy rejectionReason verificationHistory');
    }
  } catch (error) {
    console.error('[Get Payout Verification Details] Error fetching PaymentMethod records:', error);
    // Don't fail the request if PaymentMethod fetch fails
  }

  res.status(200).json({
    status: 'success',
    data: {
      seller: {
        id: seller._id,
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        payoutStatus: hasVerifiedPayoutMethod(seller).hasVerified ? 'verified' : 'pending',
        bankStatus: hasVerifiedPayoutMethod(seller).bankStatus,
        mobileStatus: hasVerifiedPayoutMethod(seller).mobileStatus,
        payoutVerificationHistory: seller.payoutVerificationHistory || [],
        paymentMethods: seller.paymentMethods, // Embedded payment methods
        paymentMethodRecords: paymentMethodRecords, // Separate PaymentMethod model records
      },
    },
  });
});

