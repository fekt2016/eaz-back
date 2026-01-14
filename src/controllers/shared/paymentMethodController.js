const PaymentMethod = require('../../models/payment/PaymentMethodModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');

/**
 * Helper function to get User ID for payment method creation
 * For sellers, finds or creates a User account with the same email
 * For regular users, returns their ID directly
 */
const getUserIdForPaymentMethod = async (currentUser) => {
  // If user is a seller, find or create User account
  if (currentUser.role === 'seller' && currentUser.email) {
    const User = require('../../models/user/userModel');
    const Seller = require('../../models/user/sellerModel');
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    
    let userAccount = await User.findOne({ email: currentUser.email });
    
    // If User account doesn't exist, create one for the seller
    if (!userAccount) {
      // Fetch full seller document to get phone from paymentMethods
      const sellerDoc = await Seller.findById(currentUser.id).select('paymentMethods');
      
      // Generate a secure random password (seller won't use this, they authenticate as seller)
      // Must be at least 8 characters for User model validation
      // Use unhashed password - the User model's pre-save hook will hash it
      const randomPassword = crypto.randomBytes(16).toString('hex'); // 32 characters, meets minLength: 8
      
      // Try to get phone from seller's payment methods
      let sellerPhone = null;
      if (sellerDoc?.paymentMethods?.mobileMoney?.phone) {
        const phoneStr = String(sellerDoc.paymentMethods.mobileMoney.phone).replace(/\D/g, '');
        if (phoneStr && phoneStr.length >= 9) {
          sellerPhone = parseInt(phoneStr, 10);
        }
      }
      
      // If no phone from payment methods, generate a unique placeholder
      // Use seller ID + timestamp to ensure uniqueness
      if (!sellerPhone) {
        const timestamp = Date.now().toString().slice(-8);
        const sellerIdStr = currentUser.id.toString().slice(-6);
        sellerPhone = parseInt(`233${timestamp}${sellerIdStr}`, 10);
        
        // Ensure it's a valid number (not too long)
        if (sellerPhone > 9999999999) {
          sellerPhone = parseInt(sellerPhone.toString().slice(-10), 10);
        }
      }
      
      try {
        // Create user with passwordConfirm matching the unhashed password for validation
        // The pre-save hook will hash the password and remove passwordConfirm
        userAccount = await User.create({
          email: currentUser.email,
          name: currentUser.businessName || currentUser.name || currentUser.shopName || 'Seller',
          phone: sellerPhone,
          password: randomPassword, // Use unhashed password - pre-save hook will hash it
          passwordConfirm: randomPassword, // Must match for validation
          role: 'user',
          emailVerified: true, // Seller email is already verified
          active: true,
          status: 'active',
        });
      } catch (error) {
        // If phone uniqueness fails, try with a different approach
        if (error.code === 11000 && error.keyPattern?.phone) {
          // Phone already exists, generate a completely unique one
          const timestamp = Date.now().toString();
          const random = Math.floor(Math.random() * 100000);
          sellerPhone = parseInt(`233${timestamp.slice(-7)}${random.toString().padStart(5, '0')}`, 10);
          
          // Ensure it's a valid number length
          if (sellerPhone > 9999999999) {
            sellerPhone = parseInt(sellerPhone.toString().slice(-10), 10);
          }
          
          // Try again with new phone
          userAccount = await User.create({
            email: currentUser.email,
            name: currentUser.businessName || currentUser.name || currentUser.shopName || 'Seller',
            phone: sellerPhone,
            password: randomPassword, // Use unhashed password - pre-save hook will hash it
            passwordConfirm: randomPassword, // Must match for validation
            role: 'user',
            emailVerified: true,
            active: true,
            status: 'active',
          });
        } else {
          throw error;
        }
      }
    }
    
    return userAccount._id;
  }
  
  // For regular users, return their ID
  return currentUser.id;
};

exports.createPaymentMethod = catchAsync(async (req, res, next) => {
  const currentUser = req.user;
  
  // Get User ID (handles sellers by finding/creating User account)
  const userId = await getUserIdForPaymentMethod(currentUser);
  
  const {
    type,
    provider,
    mobileName,
    name,
    isDefault,
    mobileNumber,
    bankName,
    accountNumber,
    accountName,
    branch,
  } = req.body;

  // Use name or mobileName or accountName for the name field
  const paymentMethodName = name || mobileName || accountName || 'Payment Method';

  // SECURITY: Check for duplicate payment methods
  if (type === 'mobile_money' && mobileNumber) {
    const normalizedPhone = mobileNumber.replace(/\D/g, ''); // Remove non-digits
    const existingMobileMoney = await PaymentMethod.findOne({
      user: userId,
      type: 'mobile_money',
      mobileNumber: normalizedPhone,
    });
    
    if (existingMobileMoney) {
      return next(new AppError(
        `A mobile money payment method with phone number ${mobileNumber} already exists. Please use the existing payment method or update it.`,
        400
      ));
    }
  } else if (type === 'bank_transfer' && accountNumber) {
    const normalizedAccountNumber = accountNumber.replace(/\s+/g, ''); // Remove spaces
    const existingBankAccount = await PaymentMethod.findOne({
      user: userId,
      type: 'bank_transfer',
      accountNumber: normalizedAccountNumber,
    });
    
    if (existingBankAccount) {
      return next(new AppError(
        `A bank account payment method with account number ${accountNumber} already exists. Please use the existing payment method or update it.`,
        400
      ));
    }
  }

  const paymentData =
    type === 'mobile_money'
      ? {
          type,
          name: paymentMethodName,
          mobileNumber: mobileNumber ? mobileNumber.replace(/\D/g, '') : mobileNumber, // Normalize phone number
          isDefault: isDefault || false,
          user: userId,
          provider: provider,
        }
      : {
          type,
          name: paymentMethodName,
          bankName,
          accountNumber: accountNumber ? accountNumber.replace(/\s+/g, '') : accountNumber, // Normalize account number
          accountName,
          branch: branch || undefined,
          isDefault: isDefault || false,
          user: userId,
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

/**
 * Get payment methods for the current authenticated user
 * @route GET /api/v1/payment-method/me
 * @access Protected
 * 
 * Note: PaymentMethod model uses 'user' field which references User model.
 * For sellers, if they have a User account with the same email, payment methods will be returned.
 * If no User account exists, returns empty array (frontend will fallback to seller.paymentMethods).
 */
exports.getMyPaymentMethods = catchAsync(async (req, res, next) => {
  const currentUser = req.user;
  
  // If user is a seller, try to find User account by email
  let userId = currentUser.id;
  
  if (currentUser.role === 'seller' && currentUser.email) {
    const User = require('../../models/user/userModel');
    const userAccount = await User.findOne({ email: currentUser.email });
    if (userAccount) {
      userId = userAccount._id;
    } else {
      // Seller doesn't have User account - return empty array
      // Frontend will fallback to seller.paymentMethods
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: {
          paymentMethods: [],
        },
      });
    }
  }
  
  const paymentMethods = await PaymentMethod.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 });
  
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
  const currentUser = req.user;
  
  // Get User ID (handles sellers by finding User account)
  const userId = await getUserIdForPaymentMethod(currentUser);
  
  // First, find the payment method to verify ownership
  const paymentMethod = await PaymentMethod.findById(req.params.id);
  if (!paymentMethod) {
    return next(new AppError('Payment method not found', 404));
  }
  
  // Verify the payment method belongs to the user
  if (paymentMethod.user.toString() !== userId.toString()) {
    return next(new AppError('You do not have permission to modify this payment method', 403));
  }
  
  // SECURITY: Check for duplicate payment methods (excluding current one)
  if (req.body.mobileNumber) {
    const normalizedPhone = req.body.mobileNumber.replace(/\D/g, '');
    const existingMobileMoney = await PaymentMethod.findOne({
      user: userId,
      type: 'mobile_money',
      mobileNumber: normalizedPhone,
      _id: { $ne: req.params.id }, // Exclude current payment method
    });
    
    if (existingMobileMoney) {
      return next(new AppError(
        `A mobile money payment method with phone number ${req.body.mobileNumber} already exists. Please use the existing payment method or update it.`,
        400
      ));
    }
  }
  
  if (req.body.accountNumber) {
    const normalizedAccountNumber = req.body.accountNumber.replace(/\s+/g, '');
    const existingBankAccount = await PaymentMethod.findOne({
      user: userId,
      type: 'bank_transfer',
      accountNumber: normalizedAccountNumber,
      _id: { $ne: req.params.id }, // Exclude current payment method
    });
    
    if (existingBankAccount) {
      return next(new AppError(
        `A bank account payment method with account number ${req.body.accountNumber} already exists. Please use the existing payment method or update it.`,
        400
      ));
    }
  }

  // Check if payment details are being changed (which should reset verification status)
  const isChangingPaymentDetails = (
    (req.body.accountNumber && req.body.accountNumber.replace(/\s+/g, '') !== (paymentMethod.accountNumber || '').replace(/\s+/g, '')) ||
    (req.body.mobileNumber && req.body.mobileNumber.replace(/\D/g, '') !== (paymentMethod.mobileNumber || '').replace(/\D/g, '')) ||
    (req.body.bankName && req.body.bankName !== paymentMethod.bankName) ||
    (req.body.provider && req.body.provider !== paymentMethod.provider)
  );
  
  // If payment details changed and verification was verified/rejected, reset to pending
  if (isChangingPaymentDetails && (paymentMethod.verificationStatus === 'verified' || paymentMethod.verificationStatus === 'rejected')) {
    req.body.verificationStatus = 'pending';
    req.body.verifiedAt = null;
    req.body.verifiedBy = null;
    req.body.rejectionReason = null;
    
    // Add to verification history
    if (!req.body.verificationHistory) {
      // Get existing history or create new array
      const existingHistory = paymentMethod.verificationHistory || [];
      req.body.verificationHistory = [...existingHistory, {
        status: 'pending',
        adminId: null, // System-initiated reset
        reason: 'Payment details changed - verification reset',
        timestamp: new Date(),
      }];
    }
    
    console.log(`[Update PaymentMethod] Payment details changed, resetting verification status from ${paymentMethod.verificationStatus} to pending`);
  }
  
  // Update the payment method
  const updatedPaymentMethod = await PaymentMethod.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true,
    },
  );
  
  // If seller updated PaymentMethod and it matches their seller.paymentMethods, sync seller payoutStatus
  if (currentUser.role === 'seller') {
    try {
      const Seller = require('../../models/user/sellerModel');
      const seller = await Seller.findById(currentUser.id);
      
      const { hasVerifiedPayoutMethod } = require('../../utils/helpers/paymentMethodHelpers');
      const payoutCheck = hasVerifiedPayoutMethod(seller);
      if (seller && payoutCheck.hasVerified) {
        // Check if updated PaymentMethod matches seller's paymentMethods
        let shouldResetSellerPayout = false;
        
        if (updatedPaymentMethod.type === 'bank_transfer' && seller.paymentMethods?.bankAccount) {
          const pmAccountNumber = (updatedPaymentMethod.accountNumber || '').replace(/\s+/g, '');
          const sellerAccountNumber = (seller.paymentMethods.bankAccount.accountNumber || '').replace(/\s+/g, '');
          if (pmAccountNumber === sellerAccountNumber) {
            shouldResetSellerPayout = true;
          }
        } else if (updatedPaymentMethod.type === 'mobile_money' && seller.paymentMethods?.mobileMoney) {
          const pmPhone = (updatedPaymentMethod.mobileNumber || '').replace(/\D/g, '');
          const sellerPhone = (seller.paymentMethods.mobileMoney.phone || '').replace(/\D/g, '');
          if (pmPhone === sellerPhone) {
            shouldResetSellerPayout = true;
          }
        }
        
        // If PaymentMethod matches seller paymentMethods and was reset, also reset seller payment method payoutStatus
        if (shouldResetSellerPayout && isChangingPaymentDetails) {
          if (updatedPaymentMethod.type === 'bank_transfer' && seller.paymentMethods?.bankAccount) {
            seller.paymentMethods.bankAccount.payoutStatus = 'pending';
            seller.paymentMethods.bankAccount.payoutVerifiedAt = null;
            seller.paymentMethods.bankAccount.payoutVerifiedBy = null;
            seller.paymentMethods.bankAccount.payoutRejectionReason = null;
          } else if (updatedPaymentMethod.type === 'mobile_money' && seller.paymentMethods?.mobileMoney) {
            seller.paymentMethods.mobileMoney.payoutStatus = 'pending';
            seller.paymentMethods.mobileMoney.payoutVerifiedAt = null;
            seller.paymentMethods.mobileMoney.payoutVerifiedBy = null;
            seller.paymentMethods.mobileMoney.payoutRejectionReason = null;
          }
          
          // Add to verification history
          if (!seller.payoutVerificationHistory) {
            seller.payoutVerificationHistory = [];
          }
          seller.payoutVerificationHistory.push({
            action: 'rejected', // Treat as rejection due to change
            adminId: null, // System-initiated
            reason: 'Payment details changed - verification reset',
            timestamp: new Date(),
            paymentMethod: updatedPaymentMethod.type === 'bank_transfer' ? 'bank' : 
                          updatedPaymentMethod.provider === 'MTN' ? 'mtn_momo' :
                          updatedPaymentMethod.provider === 'Vodafone' ? 'vodafone_cash' :
                          'airtel_tigo_money',
            paymentDetails: updatedPaymentMethod.type === 'bank_transfer' ? {
              accountNumber: updatedPaymentMethod.accountNumber,
              accountName: updatedPaymentMethod.accountName,
              bankName: updatedPaymentMethod.bankName,
            } : {
              phone: updatedPaymentMethod.mobileNumber,
              network: updatedPaymentMethod.provider,
              accountName: updatedPaymentMethod.accountName,
            },
          });
          
          await seller.save({ validateBeforeSave: false });
          console.log(`[Update PaymentMethod] Synced seller ${seller._id} payment method payoutStatus to pending due to PaymentMethod change`);
        }
      }
    } catch (sellerSyncError) {
      console.error('[Update PaymentMethod] Error syncing seller payoutStatus:', sellerSyncError);
      // Don't fail PaymentMethod update if seller sync fails
    }
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      paymentMethod: updatedPaymentMethod,
    },
  });
});

exports.deletePaymentMethod = catchAsync(async (req, res, next) => {
  const currentUser = req.user;
  
  // Get User ID (handles sellers by finding User account)
  const userId = await getUserIdForPaymentMethod(currentUser);
  
  // First, find the payment method to verify ownership
  const paymentMethod = await PaymentMethod.findById(req.params.id);
  if (!paymentMethod) {
    return next(new AppError('Payment method not found', 404));
  }
  
  // Verify the payment method belongs to the user
  if (paymentMethod.user.toString() !== userId.toString()) {
    return next(new AppError('You do not have permission to delete this payment method', 403));
  }
  
  // Delete the payment method
  await PaymentMethod.findByIdAndDelete(req.params.id);
  
  res.status(204).json({ data: null, status: 'success' });
});
exports.setDefaultPaymentMethod = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const currentUser = req.user;
    
    // Get User ID (handles sellers by finding User account)
    const userId = await getUserIdForPaymentMethod(currentUser);
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

    // Verify the payment method belongs to the user
    if (paymentMethod.user.toString() !== userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('You do not have permission to modify this payment method', 403));
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
