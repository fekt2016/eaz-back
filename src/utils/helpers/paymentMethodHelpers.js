const PaymentMethod = require('../../models/payment/PaymentMethodModel');
const User = require('../../models/user/userModel');

/**
 * Normalize account number (remove spaces, convert to lowercase)
 */
const normalizeAccountNumber = (accountNumber) => {
  if (!accountNumber) return null;
  return accountNumber.replace(/\s+/g, '').toLowerCase().trim();
};

/**
 * Normalize phone number (remove non-digits)
 */
const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  return phone.replace(/\D/g, '').trim();
};

/**
 * Find matching PaymentMethod records for a seller's payment details
 * @param {Object} seller - Seller document
 * @param {String} paymentMethodType - 'bank' | 'mtn_momo' | 'vodafone_cash' | 'airtel_tigo_money'
 * @returns {Promise<Array>} Array of matching PaymentMethod documents
 */
const findMatchingPaymentMethods = async (seller, paymentMethodType) => {
  try {
    // Find User account for this seller (if exists)
    const userAccount = await User.findOne({ email: seller.email });
    if (!userAccount) {
      return [];
    }

    // Get payment details from seller.paymentMethods
    let paymentDetails = null;
    let searchCriteria = {};

    if (paymentMethodType === 'bank' && seller.paymentMethods?.bankAccount) {
      paymentDetails = seller.paymentMethods.bankAccount;
      const accountNumber = normalizeAccountNumber(paymentDetails.accountNumber);
      if (accountNumber) {
        searchCriteria = {
          user: userAccount._id,
          type: 'bank_transfer',
          accountNumber: accountNumber,
        };
      }
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethodType) && seller.paymentMethods?.mobileMoney) {
      paymentDetails = seller.paymentMethods.mobileMoney;
      const phoneNumber = normalizePhoneNumber(paymentDetails.phone);
      if (phoneNumber) {
        // Map payment method type to provider
        const providerMap = {
          'mtn_momo': 'MTN',
          'vodafone_cash': 'Vodafone',
          'airtel_tigo_money': 'AirtelTigo',
        };
        const provider = providerMap[paymentMethodType];

        searchCriteria = {
          user: userAccount._id,
          type: 'mobile_money',
          mobileNumber: phoneNumber,
          ...(provider && { provider: provider }),
        };
      }
    }

    if (Object.keys(searchCriteria).length === 0) {
      return [];
    }

    // Find matching PaymentMethod records
    const matchingMethods = await PaymentMethod.find(searchCriteria);
    return matchingMethods;
  } catch (error) {
    console.error('[findMatchingPaymentMethods] Error:', error);
    return [];
  }
};

/**
 * Update PaymentMethod records verification status
 * @param {Array} paymentMethods - Array of PaymentMethod documents
 * @param {String} status - 'verified' | 'rejected'
 * @param {String} adminId - Admin ID who performed the action
 * @param {String} reason - Rejection reason (optional, only for rejected)
 * @param {Object} session - MongoDB session (optional)
 */
const updatePaymentMethodVerification = async (paymentMethods, status, adminId, reason = null, session = null) => {
  if (!paymentMethods || paymentMethods.length === 0) {
    return;
  }

  const updateOptions = session ? { validateBeforeSave: false, session } : { validateBeforeSave: false };

  for (const pm of paymentMethods) {
    if (status === 'verified') {
      // CRITICAL: Set status first, then verificationStatus will be synced by pre-save hook
      // The model has a pre-save hook that syncs verificationStatus from status
      pm.status = 'verified';
      pm.verificationStatus = 'verified';
      pm.verifiedAt = new Date();
      pm.verifiedBy = adminId;
      pm.rejectionReason = null;
    } else if (status === 'rejected') {
      pm.status = 'rejected';
      pm.verificationStatus = 'rejected';
      pm.verifiedAt = null;
      pm.verifiedBy = null;
      pm.rejectionReason = reason;
    } else if (status === 'pending') {
      pm.status = 'pending';
      pm.verificationStatus = 'pending';
      pm.verifiedAt = null;
      pm.verifiedBy = null;
      pm.rejectionReason = null;
    }

    // Add to verification history
    if (!pm.verificationHistory) {
      pm.verificationHistory = [];
    }
    pm.verificationHistory.push({
      status: status,
      adminId: adminId,
      reason: reason || undefined,
      timestamp: new Date(),
    });

    await pm.save(updateOptions);
  }
};

/**
 * Get account identifier for duplicate checking
 * @param {Object} seller - Seller document
 * @param {String} paymentMethodType - 'bank' | 'mtn_momo' | 'vodafone_cash' | 'airtel_tigo_money'
 * @returns {String|null} Normalized account identifier
 */
const getAccountIdentifier = (seller, paymentMethodType) => {
  if (paymentMethodType === 'bank' && seller.paymentMethods?.bankAccount?.accountNumber) {
    return normalizeAccountNumber(seller.paymentMethods.bankAccount.accountNumber);
  } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethodType) && seller.paymentMethods?.mobileMoney?.phone) {
    return normalizePhoneNumber(seller.paymentMethods.mobileMoney.phone);
  }
  return null;
};

/**
 * Check if account is already used by another verified seller
 * @param {String} accountIdentifier - Normalized account identifier
 * @param {String} paymentMethodType - 'bank' | 'mtn_momo' | 'vodafone_cash' | 'airtel_tigo_money'
 * @param {String} currentSellerId - Current seller ID to exclude
 * @returns {Promise<Object|null>} Other seller using this account, or null
 */
const checkAccountReuse = async (accountIdentifier, paymentMethodType, currentSellerId) => {
  if (!accountIdentifier) {
    return null;
  }

  try {
    const Seller = require('../../models/user/sellerModel');
    
    // Find all sellers with payment methods (we'll check individually)
    const otherSellers = await Seller.find({
      _id: { $ne: currentSellerId },
    }).select('paymentMethods name shopName email');

    for (const otherSeller of otherSellers) {
      // Check if this seller has a verified payment method
      const payoutCheck = hasVerifiedPayoutMethod(otherSeller);
      if (!payoutCheck.hasVerified) {
        continue; // Skip sellers without verified payment methods
      }
      
      const otherIdentifier = getAccountIdentifier(otherSeller, paymentMethodType);
      if (otherIdentifier === accountIdentifier) {
        return {
          seller: otherSeller,
          identifier: otherIdentifier,
        };
      }
    }

    return null;
  } catch (error) {
    console.error('[checkAccountReuse] Error:', error);
    return null;
  }
};

/**
 * Validate name match between seller and payment account
 * @param {String} sellerName - Seller name or shop name
 * @param {String} accountName - Account name from payment details
 * @returns {Object} { isValid: boolean, message?: string }
 */
const validateNameMatch = (sellerName, accountName) => {
  if (!sellerName || !accountName) {
    return {
      isValid: false,
      message: 'Seller name and account name are required for verification',
    };
  }

  const normalizedSellerName = sellerName.toLowerCase().trim();
  const normalizedAccountName = accountName.toLowerCase().trim();

  // Extract words (length > 2) from both names
  const sellerWords = normalizedSellerName.split(/\s+/).filter(w => w.length > 2);
  const accountWords = normalizedAccountName.split(/\s+/).filter(w => w.length > 2);

  // Check for word matches
  const hasWordMatch = sellerWords.some(word => 
    accountWords.some(accWord => accWord.includes(word) || word.includes(accWord))
  );

  // Check for substring match
  const hasSubstringMatch = normalizedSellerName.includes(normalizedAccountName) || 
                           normalizedAccountName.includes(normalizedSellerName);

  if (!hasWordMatch && !hasSubstringMatch && sellerWords.length > 0 && accountWords.length > 0) {
    return {
      isValid: false,
      message: `Account name "${accountName}" does not match seller name "${sellerName}". Please verify the account belongs to this seller.`,
    };
  }

  return { isValid: true };
};

/**
 * Get payment method type from seller's payment methods
 * @param {Object} seller - Seller document
 * @returns {String|null} 'bank' | 'mtn_momo' | 'vodafone_cash' | 'airtel_tigo_money' | null
 */
const getPaymentMethodType = (seller) => {
  if (seller.paymentMethods?.bankAccount?.accountNumber) {
    return 'bank';
  } else if (seller.paymentMethods?.mobileMoney?.phone) {
    const network = seller.paymentMethods.mobileMoney.network;
    if (network === 'MTN') return 'mtn_momo';
    if (network === 'Vodafone' || network === 'vodafone') return 'vodafone_cash';
    if (network === 'AirtelTigo' || network === 'airteltigo') return 'airtel_tigo_money';
    return 'mtn_momo'; // Default fallback
  }
  return null;
};

/**
 * Check if seller has at least one verified payment method
 * @param {Object} seller - Seller document with paymentMethods
 * @returns {Object} - { hasVerified: boolean, verifiedMethod: string|null, rejectionReasons: string[], allRejected: boolean, bankStatus: string, mobileStatus: string }
 */
const hasVerifiedPayoutMethod = (seller) => {
  if (!seller || !seller.paymentMethods) {
    return {
      hasVerified: false,
      verifiedMethod: null,
      rejectionReasons: [],
      allRejected: false,
      bankStatus: 'pending',
      mobileStatus: 'pending',
    };
  }

  const bankStatus = seller.paymentMethods?.bankAccount?.payoutStatus || 'pending';
  const mobileStatus = seller.paymentMethods?.mobileMoney?.payoutStatus || 'pending';
  
  const hasVerifiedBank = bankStatus === 'verified';
  const hasVerifiedMobile = mobileStatus === 'verified';
  const hasVerified = hasVerifiedBank || hasVerifiedMobile;

  const rejectionReasons = [];
  if (bankStatus === 'rejected' && seller.paymentMethods?.bankAccount?.payoutRejectionReason) {
    rejectionReasons.push(`Bank: ${seller.paymentMethods.bankAccount.payoutRejectionReason}`);
  }
  if (mobileStatus === 'rejected' && seller.paymentMethods?.mobileMoney?.payoutRejectionReason) {
    rejectionReasons.push(`Mobile Money: ${seller.paymentMethods.mobileMoney.payoutRejectionReason}`);
  }

  const allRejected = 
    (!seller.paymentMethods?.bankAccount || bankStatus === 'rejected') &&
    (!seller.paymentMethods?.mobileMoney || mobileStatus === 'rejected') &&
    (seller.paymentMethods?.bankAccount || seller.paymentMethods?.mobileMoney);

  let verifiedMethod = null;
  if (hasVerifiedBank) {
    verifiedMethod = 'bank';
  } else if (hasVerifiedMobile) {
    const network = seller.paymentMethods.mobileMoney.network;
    verifiedMethod = network === 'MTN' ? 'mtn_momo' :
                     network === 'Vodafone' || network === 'vodafone' ? 'vodafone_cash' :
                     'airtel_tigo_money';
  }

  return {
    hasVerified,
    verifiedMethod,
    rejectionReasons,
    allRejected,
    bankStatus,
    mobileStatus,
  };
};

module.exports = {
  normalizeAccountNumber,
  normalizePhoneNumber,
  findMatchingPaymentMethods,
  updatePaymentMethodVerification,
  getAccountIdentifier,
  checkAccountReuse,
  validateNameMatch,
  getPaymentMethodType,
  hasVerifiedPayoutMethod,
};

