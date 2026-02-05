/**
 * Payment Request Service
 * Shared service for creating payment requests (withdrawal requests)
 * Used by both createPaymentRequest and createWithdrawalRequest controllers
 */

const AppError = require('../utils/errors/appError');
const logger = require('../utils/logger');
const Seller = require('../models/user/sellerModel');
const PaymentRequest = require('../models/payment/paymentRequestModel');
const PaymentMethod = require('../models/payment/PaymentMethodModel');
const User = require('../models/user/userModel');
const { sendPaymentNotification } = require('../utils/helpers/notificationService');

/**
 * Create a payment request (withdrawal request)
 * @param {Object} seller - Seller object from req.user
 * @param {Number} amount - Amount to withdraw
 * @param {String} paymentMethod - Payment method (bank, mtn_momo, vodafone_cash, etc.)
 * @param {Object} paymentDetails - Payment details (optional, will be fetched if not provided)
 * @returns {Promise<Object>} - Created payment request
 */
exports.createPaymentRequest = async (seller, amount, paymentMethod, paymentDetails = {}) => {
  // Validate amount
  if (amount <= 0) {
    throw new AppError('Amount must be greater than 0', 400);
  }

  // Get current seller balance from seller model (including taxCategory and paymentMethods)
  const currentSeller = await Seller.findById(seller.id).select('balance lockedBalance pendingBalance taxCategory paymentMethods email name shopName requiredSetup onboardingStage');
  if (!currentSeller) {
    throw new AppError('Seller not found', 404);
  }

  // SECURITY: Require payout verification before allowing withdrawal
  const { hasVerifiedPayoutMethod } = require('../utils/helpers/paymentMethodHelpers');
  let payoutCheck = hasVerifiedPayoutMethod(currentSeller);

  // Fallback: if Seller.paymentMethods doesn't show verified, check PaymentMethod records
  if (!payoutCheck.hasVerified && currentSeller.email) {
    try {
      let userAccount = await User.findOne({ email: currentSeller.email }).select('_id').lean();
      if (!userAccount) {
        const escaped = String(currentSeller.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        userAccount = await User.findOne({ email: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
      }
      if (userAccount) {
        const verifiedPm = await PaymentMethod.findOne({
          user: userAccount._id,
          $or: [{ verificationStatus: 'verified' }, { status: 'verified' }],
        }).lean();
        if (verifiedPm) {
          payoutCheck = { hasVerified: true, rejectionReasons: [] };
        }
      }
    } catch (err) {
      // Non-critical: continue with payoutCheck from Seller
    }
  }

  if (!payoutCheck.hasVerified) {
    const reason = payoutCheck.allRejected
      ? payoutCheck.rejectionReasons.join('; ') || 'Payout details were rejected. Please update your payment details and resubmit for verification.'
      : 'Your payout details (bank account or mobile money) must be verified by an admin before you can withdraw funds.';
    
    throw new AppError(reason, 403);
  }

  // Use balance directly from seller model
  const sellerBalance = currentSeller.balance || 0;

  // Calculate withdrawable balance (balance - lockedBalance - pendingBalance)
  const withdrawableBalance = Math.max(0, sellerBalance - (currentSeller.lockedBalance || 0) - (currentSeller.pendingBalance || 0));

  // Check available balance (use withdrawableBalance for validation)
  if (amount > withdrawableBalance) {
    throw new AppError(`Insufficient balance. Available: GH₵${withdrawableBalance.toFixed(2)}`, 400);
  }

  // Use seller's saved payment methods if paymentDetails are not provided or incomplete
  let finalPaymentDetails = paymentDetails || {};
  
  // If paymentDetails is empty or incomplete, fetch from PaymentMethod model first, then fallback to seller.paymentMethods
  if (!paymentDetails || Object.keys(paymentDetails).length === 0) {
    // Try to find User account linked to seller (by email)
    let userAccount = null;
    if (currentSeller.email) {
      userAccount = await User.findOne({ email: currentSeller.email });
    }
    
    // Map payment method to PaymentMethod model type
    const paymentMethodToType = {
      'bank': 'bank_transfer',
      'mtn_momo': 'mobile_money',
      'vodafone_cash': 'mobile_money',
      'airtel_tigo_money': 'mobile_money',
    };
    
    // Map payment method to provider
    const paymentMethodToProvider = {
      'mtn_momo': 'MTN',
      'vodafone_cash': 'Vodafone',
      'airtel_tigo_money': 'AirtelTigo',
    };
    
    if (paymentMethod === 'bank') {
      // Try to get from PaymentMethod model first
      if (userAccount) {
        // CRITICAL: Prefer verified default method, then any verified method, then default, then any
        let paymentMethodDoc = await PaymentMethod.findOne({
          user: userAccount._id,
          type: 'bank_transfer',
          isDefault: true,
          verificationStatus: 'verified', // Prefer verified default
        });
        
        // If no verified default, get any verified method
        if (!paymentMethodDoc) {
          paymentMethodDoc = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'bank_transfer',
            verificationStatus: 'verified',
          });
        }
        
        // If no verified method, fallback to default (even if not verified)
        if (!paymentMethodDoc) {
          paymentMethodDoc = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'bank_transfer',
            isDefault: true,
          });
        }
        
        // If no default, get any bank transfer method
        if (!paymentMethodDoc) {
          const anyBankMethod = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'bank_transfer',
          });
          if (anyBankMethod && anyBankMethod.accountNumber && anyBankMethod.accountName && anyBankMethod.bankName) {
            finalPaymentDetails = {
              accountName: anyBankMethod.accountName,
              accountNumber: anyBankMethod.accountNumber,
              bankName: anyBankMethod.bankName,
              branch: anyBankMethod.branch || '',
            };
          }
        } else if (paymentMethodDoc.accountNumber && paymentMethodDoc.accountName && paymentMethodDoc.bankName) {
          finalPaymentDetails = {
            accountName: paymentMethodDoc.accountName,
            accountNumber: paymentMethodDoc.accountNumber,
            bankName: paymentMethodDoc.bankName,
            branch: paymentMethodDoc.branch || '',
          };
        }
      }
      
      // Fallback to seller's saved bank account details
      if (!finalPaymentDetails.accountNumber && currentSeller.paymentMethods?.bankAccount) {
        const bankAccount = currentSeller.paymentMethods.bankAccount;
        if (bankAccount.accountNumber && bankAccount.accountName && bankAccount.bankName) {
          finalPaymentDetails = {
            accountName: bankAccount.accountName,
            accountNumber: bankAccount.accountNumber,
            bankName: bankAccount.bankName,
            branch: bankAccount.branch || '',
          };
        }
      }
      
      if (!finalPaymentDetails.accountNumber) {
        throw new AppError('Bank account details not found. Please add bank details in your payment methods.', 400);
      }
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
      const provider = paymentMethodToProvider[paymentMethod];
      
      // Try to get from PaymentMethod model first
      if (userAccount && provider) {
        // CRITICAL: Prefer verified default method, then any verified method, then default, then any
        let paymentMethodDoc = await PaymentMethod.findOne({
          user: userAccount._id,
          type: 'mobile_money',
          provider: provider,
          isDefault: true,
          verificationStatus: 'verified', // Prefer verified default
        });
        
        // If no verified default, get any verified method with matching provider
        if (!paymentMethodDoc) {
          paymentMethodDoc = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'mobile_money',
            provider: provider,
            verificationStatus: 'verified',
          });
        }
        
        // If no verified method, fallback to default (even if not verified)
        if (!paymentMethodDoc) {
          paymentMethodDoc = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'mobile_money',
            provider: provider,
            isDefault: true,
          });
        }
        
        // If no default, get any matching provider
        if (!paymentMethodDoc) {
          paymentMethodDoc = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'mobile_money',
            provider: provider,
          });
        }
        
        if (paymentMethodDoc && paymentMethodDoc.mobileNumber) {
          finalPaymentDetails = {
            phone: paymentMethodDoc.mobileNumber,
            network: paymentMethodDoc.provider,
            accountName: paymentMethodDoc.name || currentSeller.name || currentSeller.shopName || '',
          };
        }
      }
      
      // Fallback to seller's saved mobile money details
      if (!finalPaymentDetails.phone && currentSeller.paymentMethods?.mobileMoney) {
        const mobileMoney = currentSeller.paymentMethods.mobileMoney;
        if (mobileMoney.phone && mobileMoney.network) {
          // Map saved network to payment method
          const networkToPaymentMethod = {
            'mtn': 'mtn_momo',
            'vodafone': 'vodafone_cash',
            'airteltigo': 'airtel_tigo_money',
          };
          
          const savedNetwork = mobileMoney.network.toLowerCase();
          const expectedPaymentMethod = networkToPaymentMethod[savedNetwork];
          
          if (expectedPaymentMethod === paymentMethod) {
            finalPaymentDetails = {
              phone: mobileMoney.phone,
              network: mobileMoney.network,
              accountName: mobileMoney.accountName || '',
            };
          }
        }
      }
      
      if (!finalPaymentDetails.phone) {
        throw new AppError('Mobile money details not found. Please add mobile money details in your payment methods.', 400);
      }
    } else if (paymentMethod === 'cash') {
      // Cash pickup requires manual entry, cannot use saved methods
      if (!paymentDetails || !paymentDetails.pickupLocation || !paymentDetails.contactPerson || !paymentDetails.contactPhone) {
        throw new AppError('Cash pickup requires pickup location, contact person, and contact phone. Please fill all cash pickup details.', 400);
      }
      finalPaymentDetails = paymentDetails;
    }
  } else {
    // Payment details provided - validate and use them
    if (paymentMethod === 'bank') {
      if (!paymentDetails.accountName || !paymentDetails.accountNumber || !paymentDetails.bankName) {
        throw new AppError('Please provide all bank details: account name, account number, and bank name.', 400);
      }
      finalPaymentDetails = {
        accountName: paymentDetails.accountName,
        accountNumber: paymentDetails.accountNumber,
        bankName: paymentDetails.bankName,
        branch: paymentDetails.branch || '',
      };
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
      if (!paymentDetails.phone || !paymentDetails.network) {
        throw new AppError('Please provide phone number and network for mobile money.', 400);
      }
      finalPaymentDetails = {
        phone: paymentDetails.phone,
        network: paymentDetails.network,
        accountName: paymentDetails.accountName || '',
      };
    } else if (paymentMethod === 'cash') {
      if (!paymentDetails.pickupLocation || !paymentDetails.contactPerson || !paymentDetails.contactPhone) {
        throw new AppError('Please provide all cash pickup details: pickup location, contact person, and contact phone.', 400);
      }
      finalPaymentDetails = paymentDetails;
    }
  }
  
  // Ensure paymentDetails is always populated before creating the request
  if (!finalPaymentDetails || Object.keys(finalPaymentDetails).length === 0) {
    throw new AppError('Payment details are required. Please provide payment information.', 400);
  }

  // Calculate withholding tax based on seller's tax category (using dynamic rates)
  const taxService = require('./tax/taxService');
  const taxCategory = currentSeller.taxCategory || 'individual';
  const withholdingResult = await taxService.calculateWithholdingTax(amount, taxCategory);
  const withholdingTax = withholdingResult.withholdingTax;
  const withholdingTaxRate = withholdingResult.withholdingTaxRate;
  const amountPaidToSeller = withholdingResult.amountPaidToSeller;

  // Create payment request with withholding tax information
  const paymentRequest = await PaymentRequest.create({
    seller: seller.id,
    amount,
    amountRequested: amount, // Store original requested amount
    currency: 'GHS',
    paymentMethod,
    paymentDetails: finalPaymentDetails,
    status: 'pending',
    withholdingTax,
    withholdingTaxRate,
    amountPaidToSeller,
    sellerBalanceBefore: currentSeller.balance || 0,
  });

  // Add amount to pendingBalance when withdrawal request is created
  // This tracks funds awaiting admin approval and OTP verification
  // IMPORTANT: Total Revenue (balance) should NOT be deducted here - only available balance decreases
  const oldBalance = currentSeller.balance || 0;
  const oldPendingBalance = currentSeller.pendingBalance || 0;
  const oldLockedBalance = currentSeller.lockedBalance || 0;
  const oldWithdrawableBalance = Math.max(0, oldBalance - oldLockedBalance - oldPendingBalance);
  
  // PROTECTION: Prevent negative pendingBalance
  if (oldPendingBalance < 0) {
    logger.warn(`[createPaymentRequest] ⚠️ Seller ${seller.id} has negative pendingBalance: ${oldPendingBalance}. Resetting to 0.`);
    currentSeller.pendingBalance = 0;
  }
  
  // Add to pendingBalance (funds awaiting approval and OTP verification)
  // This reduces available balance but does NOT affect total revenue (balance)
  const newPendingBalance = oldPendingBalance + amount;
  
  // PROTECTION: Prevent double-adding (check if amount already in pendingBalance)
  // This is a safety check - in normal flow, amount should not already be in pendingBalance
  if (newPendingBalance > oldBalance) {
    logger.warn(`[createPaymentRequest] ⚠️ New pendingBalance (${newPendingBalance}); exceeds balance (${oldBalance}). This may indicate a double-add.`);
  }
  
  currentSeller.pendingBalance = newPendingBalance;
  
  // CRITICAL: Do NOT modify balance (total revenue) - it should remain unchanged
  // Only pendingBalance is increased, which reduces withdrawableBalance
  // Balance will only be deducted when withdrawal is actually paid (in processPaymentRequest)
  
  // Recalculate withdrawableBalance explicitly (balance - lockedBalance - pendingBalance)
  currentSeller.calculateWithdrawableBalance();
  const newWithdrawableBalance = Math.max(0, currentSeller.balance - currentSeller.lockedBalance - currentSeller.pendingBalance);
  currentSeller.withdrawableBalance = newWithdrawableBalance;
  
  // Verify balance was NOT modified
  if (currentSeller.balance !== oldBalance) {
    logger.error(`[createPaymentRequest] ERROR: Balance was modified! Old: ${oldBalance}, New: ${currentSeller.balance}`);
    // Restore balance if it was accidentally modified
    currentSeller.balance = oldBalance;
  }
  
  logger.info(`[createPaymentRequest] Pending balance update for seller ${seller.id}:`);
  logger.info(`  Total Revenue (Balance);: ${oldBalance} (UNCHANGED - not deducted)`);
  logger.info(`  Pending Balance: ${oldPendingBalance} + ${amount} = ${currentSeller.pendingBalance}`);
  logger.info(`  Locked Balance: ${oldLockedBalance} (unchanged);`);
  logger.info(`  Available Balance: ${oldWithdrawableBalance} - ${amount} = ${newWithdrawableBalance} (decreased due to pending withdrawal);`);
  
  // Auto-update onboarding if bank details are being added
  if (!currentSeller.requiredSetup.hasAddedBankDetails) {
    currentSeller.requiredSetup.hasAddedBankDetails = true;
    
    // Check if all setup is complete (product not required for verification)
    const allSetupComplete =
      currentSeller.requiredSetup.hasAddedBusinessInfo &&
      currentSeller.requiredSetup.hasAddedBankDetails;

    if (allSetupComplete && currentSeller.onboardingStage === 'profile_incomplete') {
      currentSeller.onboardingStage = 'pending_verification';
    }
  }
  
  await currentSeller.save();
  
  // Verify the save worked and balance was NOT deducted
  const savedSeller = await Seller.findById(seller.id).select('balance lockedBalance pendingBalance withdrawableBalance');
  if (savedSeller) {
    // Verify balance (total revenue) was NOT modified
    if (Math.abs((savedSeller.balance || 0) - oldBalance) > 0.01) {
      logger.error(`[createPaymentRequest] ❌ ERROR: Total Revenue (Balance); was modified! Expected: ${oldBalance}, Actual: ${savedSeller.balance}`);
    } else {
      logger.info(`[createPaymentRequest] ✅ Verified save - Total Revenue (Balance);: ${savedSeller.balance} (UNCHANGED)`);
    }
    logger.info(`[createPaymentRequest] ✅ Verified save - LockedBalance: ${savedSeller.lockedBalance}, PendingBalance: ${savedSeller.pendingBalance}, WithdrawableBalance: ${savedSeller.withdrawableBalance}`);
    
    // Log finance audit
    try {
      const financeAudit = require('./financeAuditService');
      await financeAudit.logWithdrawalCreated(
        seller.id,
        amount,
        paymentRequest._id,
        oldPendingBalance,
        savedSeller.pendingBalance
      );
    } catch (auditError) {
      logger.error('[createPaymentRequest] Failed to log finance audit (non-critical);:', auditError);
    }
  }

  // Send confirmation to seller
  await sendPaymentNotification(seller, 'request_created', paymentRequest);

  // Notify all admins about withdrawal request
  try {
    const notificationService = require('../services/notification/notificationService');
    await notificationService.createWithdrawalRequestNotification(
      paymentRequest._id,
      seller.id,
      currentSeller.shopName || currentSeller.name || 'Seller',
      amount
    );
    logger.info(`[Payment Request] Admin notification created for withdrawal ${paymentRequest._id}`);
  } catch (notificationError) {
    logger.error('[Payment Request] Error creating admin notification:', notificationError);
    // Don't fail payment request if notification fails
  }

  return paymentRequest;
};

