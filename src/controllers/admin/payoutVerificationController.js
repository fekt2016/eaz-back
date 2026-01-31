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

  // Fetch seller with required fields for payout verification
  const seller = await Seller.findById(id).select('name shopName email paymentMethods payoutStatus');
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
  // First try seller.paymentMethods, then check PaymentMethod records
  let paymentDetails = null;
  let paymentMethodRecord = null;
  
  // Check seller.paymentMethods, but only use it if it has actual data
  if (paymentMethod === 'bank' && seller.paymentMethods?.bankAccount) {
    const bankAccount = seller.paymentMethods.bankAccount;
    // Only use if it has account name or account number (actual data)
    if (bankAccount.accountName?.trim() || bankAccount.accountNumber?.trim()) {
      paymentDetails = bankAccount;
      console.log('[Approve Payout Verification] Using seller.paymentMethods.bankAccount:', {
        accountName: bankAccount.accountName,
        accountNumber: bankAccount.accountNumber,
      });
    } else {
      console.log('[Approve Payout Verification] seller.paymentMethods.bankAccount exists but is empty, will check PaymentMethod records');
    }
  } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod) && seller.paymentMethods?.mobileMoney) {
    const mobileMoney = seller.paymentMethods.mobileMoney;
    // Only use if it has account name or phone (actual data)
    if (mobileMoney.accountName?.trim() || mobileMoney.phone?.trim()) {
      paymentDetails = mobileMoney;
      console.log('[Approve Payout Verification] Using seller.paymentMethods.mobileMoney:', {
        accountName: mobileMoney.accountName,
        phone: mobileMoney.phone,
        network: mobileMoney.network,
      });
    } else {
      console.log('[Approve Payout Verification] seller.paymentMethods.mobileMoney exists but is empty, will check PaymentMethod records');
    }
  }

  // If no payment details in seller.paymentMethods (or they're empty), check PaymentMethod records
  if (!paymentDetails) {
    try {
      const PaymentMethod = require('../../models/payment/PaymentMethodModel');
      const User = require('../../models/user/userModel');
      
      const userAccount = await User.findOne({ email: seller.email });
      console.log('[Approve Payout Verification] Looking for PaymentMethod record:', {
        sellerEmail: seller.email,
        userAccountFound: !!userAccount,
        userId: userAccount?._id,
        paymentMethod,
      });
      
      if (userAccount) {
        // Find matching PaymentMethod record
        let query = { user: userAccount._id };
        
        if (paymentMethod === 'bank') {
          query.type = 'bank_transfer';
        } else if (paymentMethod === 'mtn_momo') {
          query.type = 'mobile_money';
          query.provider = 'MTN';
        } else if (paymentMethod === 'vodafone_cash') {
          query.type = 'mobile_money';
          query.provider = { $in: ['Vodafone', 'vodafone'] };
        } else if (paymentMethod === 'airtel_tigo_money') {
          query.type = 'mobile_money';
          query.provider = { $in: ['AirtelTigo', 'airtel_tigo'] };
        }
        
        console.log('[Approve Payout Verification] Query for PaymentMethod:', JSON.stringify(query, null, 2));
        
        // First try with provider match
        paymentMethodRecord = await PaymentMethod.findOne(query)
          .sort({ isDefault: -1, createdAt: -1 })
          .lean();
        
        // If not found and it's mobile money, try without provider (in case provider doesn't match exactly)
        if (!paymentMethodRecord && ['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
          console.log('[Approve Payout Verification] Not found with provider, trying without provider match');
          const fallbackQuery = { user: userAccount._id, type: 'mobile_money' };
          const allMobileMoney = await PaymentMethod.find(fallbackQuery)
            .sort({ isDefault: -1, createdAt: -1 })
            .lean();
          console.log('[Approve Payout Verification] Found mobile money records:', allMobileMoney.length);
          if (allMobileMoney.length > 0) {
            // Use the first one (most recent or default)
            paymentMethodRecord = allMobileMoney[0];
            console.log('[Approve Payout Verification] Using first mobile money record:', paymentMethodRecord._id);
          }
        }
        
        if (paymentMethodRecord) {
          console.log('[Approve Payout Verification] Found PaymentMethod record:', {
            _id: paymentMethodRecord._id,
            type: paymentMethodRecord.type,
            name: paymentMethodRecord.name,
            accountName: paymentMethodRecord.accountName,
            mobileNumber: paymentMethodRecord.mobileNumber,
            provider: paymentMethodRecord.provider,
            accountNumber: paymentMethodRecord.accountNumber,
            bankName: paymentMethodRecord.bankName,
          });
          
          // Convert PaymentMethod record to paymentDetails format
          if (paymentMethodRecord.type === 'bank_transfer') {
            paymentDetails = {
              accountName: paymentMethodRecord.accountName || paymentMethodRecord.name || '',
              accountNumber: paymentMethodRecord.accountNumber || '',
              bankName: paymentMethodRecord.bankName || '',
              branch: paymentMethodRecord.branch || '',
              bankCode: paymentMethodRecord.bankCode || '',
              payoutStatus: paymentMethodRecord.verificationStatus || 'pending',
            };
          } else if (paymentMethodRecord.type === 'mobile_money') {
            paymentDetails = {
              accountName: paymentMethodRecord.accountName || paymentMethodRecord.name || '',
              phone: paymentMethodRecord.mobileNumber || '',
              network: paymentMethodRecord.provider || '',
              payoutStatus: paymentMethodRecord.verificationStatus || 'pending',
            };
          }
          
          console.log('[Approve Payout Verification] Converted paymentDetails:', paymentDetails);
          console.log('[Approve Payout Verification] Account name extracted:', paymentDetails.accountName);
        } else {
          console.log('[Approve Payout Verification] No PaymentMethod record found for paymentMethod:', paymentMethod);
          // Log all available PaymentMethod records for debugging
          const allRecords = await PaymentMethod.find({ user: userAccount._id }).lean();
          console.log('[Approve Payout Verification] All PaymentMethod records for user:', allRecords.map(r => ({
            _id: r._id,
            type: r.type,
            provider: r.provider,
            name: r.name,
            accountName: r.accountName,
          })));
        }
      } else {
        console.log('[Approve Payout Verification] No User account found for seller:', seller.email);
      }
    } catch (error) {
      console.error('[Approve Payout Verification] Error fetching PaymentMethod record:', error);
      // Continue with existing logic if PaymentMethod fetch fails
    }
  }

  if (!paymentDetails) {
    return next(new AppError(`Payment details for ${paymentMethod} not found. Seller must add payment details first.`, 400));
  }

  // SECURITY: Name matching validation
  // Check if seller has a name first
  const sellerName = seller.name || seller.shopName;
  if (!sellerName || sellerName.trim() === '') {
    return next(new AppError(
      'Seller name is required for payout verification. Please ensure the seller has a name or shop name set in their profile.',
      400
    ));
  }

  // Check if payment details have account name
  const accountName = paymentDetails.accountName;
  console.log('[Approve Payout Verification] Checking account name:', {
    accountName,
    paymentDetails,
    paymentMethod,
    hasAccountName: !!accountName,
    accountNameTrimmed: accountName?.trim(),
  });
  
  if (!accountName || accountName.trim() === '') {
    const paymentMethodType = paymentMethod === 'bank' ? 'bank account' : 'mobile money';
    console.error('[Approve Payout Verification] Account name missing:', {
      paymentMethod,
      paymentDetails,
      paymentMethodRecord: paymentMethodRecord ? {
        _id: paymentMethodRecord._id,
        name: paymentMethodRecord.name,
        accountName: paymentMethodRecord.accountName,
      } : null,
    });
    return next(new AppError(
      `Account name is required for ${paymentMethodType} verification. Please ensure the seller has provided an account name in their payment details.`,
      400
    ));
  }

  // Validate name match
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
    
    // Ensure embedded paymentMethods exist so onboarding status can see verified payout.
    if (!seller.paymentMethods) {
      seller.paymentMethods = {};
    }

    if (paymentMethod === 'bank') {
      // If bankAccount section is missing or empty, seed it from the verified paymentDetails.
      if (!seller.paymentMethods.bankAccount || Object.keys(seller.paymentMethods.bankAccount).length === 0) {
        seller.paymentMethods.bankAccount = {
          accountName: paymentDetails.accountName || '',
          accountNumber: paymentDetails.accountNumber || '',
          bankName: paymentDetails.bankName || '',
          branch: paymentDetails.branch || '',
          bankCode: paymentDetails.bankCode || '',
        };
      }

      seller.paymentMethods.bankAccount.payoutStatus = 'verified';
      seller.paymentMethods.bankAccount.payoutVerifiedAt = new Date();
      seller.paymentMethods.bankAccount.payoutVerifiedBy = adminId;
      seller.paymentMethods.bankAccount.payoutRejectionReason = null;
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
      // If mobileMoney section is missing or empty, seed it from the verified paymentDetails.
      if (!seller.paymentMethods.mobileMoney || Object.keys(seller.paymentMethods.mobileMoney).length === 0) {
        seller.paymentMethods.mobileMoney = {
          accountName: paymentDetails.accountName || '',
          phone: paymentDetails.phone || '',
          network: paymentDetails.network || '',
        };
      }

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
      // If we found a paymentMethodRecord earlier, update it directly
      if (paymentMethodRecord && paymentMethodRecord._id) {
        const PaymentMethod = require('../../models/payment/PaymentMethodModel');
        const pmDoc = await PaymentMethod.findById(paymentMethodRecord._id).session(session);
        if (pmDoc) {
          // CRITICAL: Set status first, then verificationStatus will be synced by middleware
          // The model has a pre-save hook that syncs verificationStatus from status
          pmDoc.status = 'verified';
          pmDoc.verificationStatus = 'verified'; // Also set directly for immediate effect
          pmDoc.verifiedAt = new Date();
          pmDoc.verifiedBy = adminId;
          pmDoc.rejectionReason = null;
          
          if (!pmDoc.verificationHistory) {
            pmDoc.verificationHistory = [];
          }
          pmDoc.verificationHistory.push({
            status: 'verified',
            adminId: adminId,
            timestamp: new Date(),
          });
          
          await pmDoc.save({ validateBeforeSave: false, session });
          console.log(`[Approve Payout Verification] Updated PaymentMethod record ${pmDoc._id} for seller ${seller._id}`, {
            verificationStatus: pmDoc.verificationStatus,
            status: pmDoc.status,
            verifiedBy: pmDoc.verifiedBy,
          });
        }
      } else {
        // Fallback: try to find matching PaymentMethod records
        const matchingPaymentMethods = await findMatchingPaymentMethods(seller, paymentMethod);
        if (matchingPaymentMethods.length > 0) {
          await updatePaymentMethodVerification(matchingPaymentMethods, 'verified', adminId, null, session);
          console.log(`[Approve Payout Verification] Updated ${matchingPaymentMethods.length} PaymentMethod record(s) for seller ${seller._id}`);
        } else {
          console.log(`[Approve Payout Verification] No matching PaymentMethod records found for seller ${seller._id} (this is OK if seller doesn't have a User account)`);
        }
      }
    } catch (paymentMethodError) {
      console.error('[Approve Payout Verification] Error updating PaymentMethod records:', paymentMethodError);
      // Don't fail verification approval if PaymentMethod update fails
    }

    // Log to AdminActionLog (outside of the transaction session).
    // Logging is non-critical; we avoid using the session here so that
    // a transient transaction error cannot cause the whole approval to fail.
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
      }]);
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
    // Rollback transaction on error, but only if it's still active.
    // This avoids secondary errors like "Cannot call abortTransaction after calling commitTransaction".
    try {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      console.error('[Approve Payout Verification] Error aborting transaction:', abortError);
    }
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

    // Log to AdminActionLog (outside of the transaction session).
    // Logging is non-critical; we avoid using the session here so that
    // a transient transaction error cannot cause the whole rejection flow to fail.
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
      }]);
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
    // Rollback transaction on error, but only if it's still active.
    // This avoids secondary errors like "Cannot call abortTransaction after calling commitTransaction".
    try {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      console.error('[Reject Payout Verification] Error aborting transaction:', abortError);
    }
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

  // CRITICAL: Include paymentMethods in the select to ensure they're returned
  // This is essential for admin to see payment methods added by seller for approval
  // Note: bankAccount and mobileMoney are nested inside paymentMethods, so we only need to select paymentMethods
  const seller = await Seller.findById(id).select(
    'name shopName email payoutVerificationHistory paymentMethods'
  );
  
  // Debug: Log payment methods to verify they're being fetched
  console.log('[Get Payout Verification Details] Seller paymentMethods:', JSON.stringify(seller?.paymentMethods, null, 2));

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Also fetch PaymentMethod records: seller adds payment via PaymentMethod API (linked to User by email)
  let paymentMethodRecords = [];
  try {
    const PaymentMethod = require('../../models/payment/PaymentMethodModel');
    const User = require('../../models/user/userModel');

    // Find User by seller email (exact first, then case-insensitive so admin always sees payment methods)
    const sellerEmail = (seller.email || '').trim();
    let userAccount = sellerEmail ? await User.findOne({ email: sellerEmail }) : null;
    if (!userAccount && sellerEmail) {
      userAccount = await User.findOne({ email: new RegExp(`^${sellerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    }
    console.log('[Get Payout Verification Details] User account found:', userAccount ? { id: userAccount._id, email: userAccount.email } : 'NOT FOUND', 'seller email:', seller.email);

    if (userAccount) {
      paymentMethodRecords = await PaymentMethod.find({ user: userAccount._id })
        .sort({ isDefault: -1, createdAt: -1 })
        .select('type isDefault name provider mobileNumber bankName accountNumber accountName branch verificationStatus verifiedAt verifiedBy rejectionReason verificationHistory status')
        .lean();

      console.log('[Get Payout Verification Details] PaymentMethod records found:', paymentMethodRecords.length);
    } else {
      console.log('[Get Payout Verification Details] No User account found for seller email:', seller.email, '- Payment methods are linked to User; one is created when seller adds payment in seller app.');
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

