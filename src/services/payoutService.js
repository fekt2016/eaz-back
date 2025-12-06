/**
 * Payout Service
 * Handles Paystack transfer operations for seller payouts
 */

const { paystackApi, PAYSTACK_ENDPOINTS } = require('../config/paystack');
const AppError = require('../utils/errors/appError');

/**
 * Map bank name to Paystack bank code
 * @param {String} bankName - Bank name
 * @returns {String} Paystack bank code
 */
exports.getBankCodeFromName = function getBankCodeFromName(bankName) {
  if (!bankName || typeof bankName !== 'string') {
    return null;
  }
  
  // Normalize bank name: trim, lowercase, remove extra spaces
  const normalized = bankName.trim().toLowerCase().replace(/\s+/g, ' ');
  
  // Comprehensive bank code mapping with multiple variations
  const bankCodeMap = {
    // GCB Bank variations
    'gcb bank': '044',
    'gcb': '044',
    'ghana commercial bank': '044',
    
    // Absa Ghana variations
    'absa ghana': '050',
    'absa': '050',
    'barclays bank ghana': '050',
    'barclays': '050',
    
    // Stanbic Bank variations
    'stanbic bank': '001',
    'stanbic': '001',
    'stanbic bank ghana': '001',
    
    // Ecobank variations
    'ecobank ghana': '019',
    'ecobank': '019',
    
    // Fidelity Bank variations
    'fidelity bank': '070',
    'fidelity': '070',
    'fidelity bank ghana': '070',
    
    // CalBank variations
    'calbank': '140',
    'cal bank': '140',
    'cal': '140',
    
    // Zenith Bank variations
    'zenith bank': '057',
    'zenith': '057',
    'zenith bank ghana': '057',
    
    // GT Bank variations
    'gt bank': '058',
    'gtbank': '058',
    'guaranty trust bank': '058',
    'guaranty trust': '058',
    
    // Republic Bank variations
    'republic bank': '032',
    'republic': '032',
    'republic bank ghana': '032',
    'hfc bank': '032', // Republic Bank was formerly HFC Bank
    
    // Standard Chartered variations
    'standard chartered': '021',
    'standard chartered bank': '021',
    'standard chartered ghana': '021',
    'stanchart': '021',
    
    // First National Bank variations
    'first national bank': '011',
    'fnb': '011',
    'fnb ghana': '011',
    
    // Additional banks
    'access bank': '044', // May need to verify
    'united bank for africa': '066',
    'uba': '066',
    'consolidated bank ghana': '068',
    'agricultural development bank': '001', // May need to verify
    'adb': '001',
  };
  
  // Try exact match first
  if (bankCodeMap[normalized]) {
    return bankCodeMap[normalized];
  }
  
  // Try partial match (contains)
  for (const [key, code] of Object.entries(bankCodeMap)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return code;
    }
  }
  
  console.warn(`[PayoutService] Bank code not found for: "${bankName}" (normalized: "${normalized}")`);
  return null;
}

/**
 * Create a transfer recipient for a seller
 * @param {Object} seller - Seller object with payment details
 * @returns {Promise<Object>} Recipient data with recipient_code
 */
exports.createRecipientForSeller = async (seller) => {
  try {
    const paymentMethod = seller.paymentMethods || {};
    let recipientData = {};

    // Determine recipient type based on payment method
    if (paymentMethod.bankAccount) {
      // Bank transfer recipient
      const bank = paymentMethod.bankAccount;
      
      // Get bank code - use stored bankCode or map from bankName
      let bankCode = bank.bankCode;
      if (!bankCode && bank.bankName) {
        bankCode = exports.getBankCodeFromName(bank.bankName);
        console.log(`[PayoutService] Mapped bank name "${bank.bankName}" to code: ${bankCode}`);
      }
      
      if (!bankCode) {
        const errorMsg = bank.bankName 
          ? `Invalid bank name: "${bank.bankName}". Please provide a valid bank code or use a supported bank name.`
          : 'Bank code is required. Please ensure the seller has a valid bank code configured.';
        throw new AppError(errorMsg, 400);
      }
      
      // Validate bank code format (should be 3 digits)
      if (!/^\d{3}$/.test(bankCode)) {
        console.warn(`[PayoutService] Bank code format may be invalid: ${bankCode}`);
      }
      
      if (!bank.accountNumber) {
        throw new AppError('Bank account number is required', 400);
      }
      
      if (!bank.accountName) {
        throw new AppError('Bank account name is required', 400);
      }
      
      recipientData = {
        type: 'nuban',
        name: bank.accountName || seller.name || seller.shopName,
        account_number: bank.accountNumber,
        bank_code: bankCode,
        currency: 'GHS',
      };
      
      console.log(`[PayoutService] Creating bank recipient:`, {
        name: recipientData.name,
        account_number: recipientData.account_number,
        bank_code: recipientData.bank_code,
        bank_name: bank.bankName,
      });
    } else if (paymentMethod.mobileMoney) {
      // Mobile money recipient
      const mobile = paymentMethod.mobileMoney;
      
      if (!mobile.phone) {
        throw new AppError('Mobile money phone number is required', 400);
      }
      
      if (!mobile.network) {
        throw new AppError('Mobile money network is required', 400);
      }
      
      const mobileBankCode = exports.getMobileMoneyBankCode(mobile.network);
      if (!mobileBankCode) {
        throw new AppError('Invalid mobile money network. Supported networks: MTN, Vodafone, AirtelTigo', 400);
      }
      
      recipientData = {
        type: 'mobile_money',
        name: mobile.accountName || seller.name || seller.shopName,
        account_number: mobile.phone,
        bank_code: mobileBankCode,
        currency: 'GHS',
      };
    } else {
      throw new AppError('Seller does not have valid payment method configured. Please add bank account or mobile money details.', 400);
    }

    const response = await paystackApi.post(PAYSTACK_ENDPOINTS.CREATE_RECIPIENT, recipientData);

    if (response.data.status && response.data.data) {
      return {
        recipient_code: response.data.data.recipient_code,
        recipient_data: response.data.data,
      };
    }

    throw new AppError('Failed to create Paystack recipient', 500);
  } catch (error) {
    console.error('[PayoutService] Error creating recipient:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      recipientData,
    });
    
    // Handle specific Paystack errors
    if (error.response?.data?.message) {
      const paystackMessage = error.response.data.message;
      
      // Provide helpful error messages for common issues
      if (paystackMessage.toLowerCase().includes('bank is invalid') || 
          paystackMessage.toLowerCase().includes('invalid bank')) {
        const bankInfo = paymentMethod.bankAccount || {};
        const errorDetails = [
          `Bank code "${bankInfo.bankCode || 'N/A'}" is invalid.`,
          bankInfo.bankName ? `Bank name: "${bankInfo.bankName}"` : '',
          'Please verify the bank code is correct. You can use the Paystack API to list valid bank codes for Ghana.',
        ].filter(Boolean).join(' ');
        
        throw new AppError(`Paystack error: ${paystackMessage}. ${errorDetails}`, error.response.status || 400);
      }
      
      throw new AppError(`Paystack error: ${paystackMessage}`, error.response.status || 500);
    }
    
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError('Failed to create transfer recipient', 500);
  }
};

/**
 * Get bank code for mobile money networks
 * @param {String} network - Mobile money network (MTN, Vodafone, AirtelTigo)
 * @returns {String} Bank code
 */
exports.getMobileMoneyBankCode = function getMobileMoneyBankCode(network) {
  const networkMap = {
    'MTN': 'MTN', // Paystack uses 'MTN' as bank code for MTN Mobile Money
    'Vodafone': 'VOD', // Paystack uses 'VOD' for Vodafone Cash
    'AirtelTigo': 'ATL', // Paystack uses 'ATL' for AirtelTigo Money
    'mtn': 'MTN',
    'vodafone': 'VOD',
    'airteltigo': 'ATL',
  };
  
  return networkMap[network] || 'MTN'; // Default to MTN
}

/**
 * Initiate a Paystack transfer
 * @param {Number} amount - Amount to transfer (in pesewas, so multiply by 100)
 * @param {String} recipientCode - Paystack recipient code
 * @param {String} reason - Reason for transfer
 * @returns {Promise<Object>} Transfer data with reference and transfer_code
 */
exports.initiatePayout = async (amount, recipientCode, reason = 'Seller payout') => {
  try {
    // Convert amount to pesewas (Paystack uses smallest currency unit)
    const amountInPesewas = Math.round(amount * 100);

    const transferData = {
      source: 'balance', // Use Paystack balance
      amount: amountInPesewas,
      recipient: recipientCode,
      reason: reason,
      currency: 'GHS',
    };

    console.log('💳 [PayoutService] Initiating Paystack transfer:', {
      amount: amountInPesewas,
      recipientCode,
      reason,
      endpoint: PAYSTACK_ENDPOINTS.INITIATE_TRANSFER
    });

    const response = await paystackApi.post(PAYSTACK_ENDPOINTS.INITIATE_TRANSFER, transferData);

    console.log('💳 [PayoutService] Paystack transfer initiated response:', {
      status: response.data?.status,
      transferStatus: response.data?.data?.status,
      transferCode: response.data?.data?.transfer_code,
      requiresOtp: response.data?.data?.status === 'otp',
      requiresApproval: response.data?.data?.requires_approval,
      fullResponse: JSON.stringify(response.data, null, 2)
    });

    if (response.data.status && response.data.data) {
      const transferStatus = response.data.data.status;
      
      // Log OTP generation info
      if (transferStatus === 'otp' || response.data.data.requires_approval === 1) {
        console.log('🔐 [PayoutService] ⚠️ PAYSTACK WILL GENERATE AND SEND OTP AUTOMATICALLY');
        console.log('🔐 [PayoutService] Paystack automatically sends OTP to recipient phone/email when transfer requires OTP');
        console.log('🔐 [PayoutService] Our backend does NOT generate the OTP - Paystack handles it');
        console.log('🔐 [PayoutService] Transfer status:', transferStatus);
        console.log('🔐 [PayoutService] Transfer code:', response.data.data.transfer_code);
      }
      
      return {
        transfer_code: response.data.data.transfer_code,
        reference: response.data.data.reference,
        transfer_id: response.data.data.id,
        status: response.data.data.status,
        transfer_data: response.data.data,
      };
    }

    throw new AppError('Failed to initiate Paystack transfer', 500);
  } catch (error) {
    console.error('[PayoutService] Error initiating transfer:', error.response?.data || error.message);
    
    if (error.response?.data?.message) {
      throw new AppError(`Paystack error: ${error.response.data.message}`, error.response.status || 500);
    }
    
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError('Failed to initiate transfer', 500);
  }
};

/**
 * Submit PIN for mobile money transfer
 * @param {String} transferCode - Paystack transfer code
 * @param {String} pin - PIN received by the seller
 * @returns {Promise<Object>} Transfer completion status
 */
exports.submitTransferPin = async (transferCode, pin) => {
  try {
    if (!transferCode || !pin) {
      throw new AppError('Transfer code and PIN are required', 400);
    }

    // Validate PIN format (should be numeric, typically 4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      throw new AppError('PIN must be 4-6 digits', 400);
    }

    const pinData = {
      transfer_code: transferCode,
      pin: pin,
    };

    const response = await paystackApi.post(PAYSTACK_ENDPOINTS.FINALIZE_TRANSFER, pinData);

    if (response.data.status && response.data.data) {
      return {
        status: response.data.data.status,
        transfer_code: response.data.data.transfer_code,
        reference: response.data.data.reference,
        amount: response.data.data.amount / 100, // Convert from pesewas to cedis
        recipient: response.data.data.recipient,
        transfer_data: response.data.data,
        message: response.data.message || 'Transfer PIN submitted successfully',
      };
    }

    throw new AppError('Failed to submit PIN', 500);
  } catch (error) {
    console.error('[PayoutService] Error submitting PIN:', error.response?.data || error.message);
    
    if (error.response?.data?.message) {
      // Provide user-friendly error messages
      const paystackMessage = error.response.data.message;
      if (paystackMessage.toLowerCase().includes('invalid pin') || 
          paystackMessage.toLowerCase().includes('incorrect pin')) {
        throw new AppError('Invalid PIN. Please check and try again.', 400);
      }
      if (paystackMessage.toLowerCase().includes('expired')) {
        throw new AppError('PIN has expired. Please request a new withdrawal.', 400);
      }
      throw new AppError(`Paystack error: ${paystackMessage}`, error.response.status || 500);
    }
    
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError('Failed to submit transfer PIN', 500);
  }
};

/**
 * Verify transfer status from Paystack
 * @param {String} transferId - Paystack transfer ID or reference
 * @returns {Promise<Object>} Transfer status and details
 */
exports.verifyTransferStatus = async (transferId) => {
  try {
    const response = await paystackApi.get(`${PAYSTACK_ENDPOINTS.GET_TRANSFER}/${transferId}`);

    if (response.data.status && response.data.data) {
      const transferData = response.data.data;
      return {
        status: transferData.status, // 'pending', 'success', 'failed', 'reversed', 'otp'
        transfer_code: transferData.transfer_code,
        reference: transferData.reference,
        amount: transferData.amount / 100, // Convert from pesewas to cedis
        recipient: transferData.recipient,
        requires_pin: transferData.status === 'otp' || transferData.requires_approval === 1,
        transfer_data: transferData,
      };
    }

    throw new AppError('Transfer not found', 404);
  } catch (error) {
    console.error('[PayoutService] Error verifying transfer:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      throw new AppError('Transfer not found', 404);
    }
    
    if (error.response?.data?.message) {
      throw new AppError(`Paystack error: ${error.response.data.message}`, error.response.status || 500);
    }
    
    throw new AppError('Failed to verify transfer status', 500);
  }
};

/**
 * Get list of supported banks from Paystack
 * @returns {Promise<Array>} List of banks
 */
exports.getSupportedBanks = async () => {
  try {
    const response = await paystackApi.get(PAYSTACK_ENDPOINTS.LIST_BANKS, {
      params: {
        country: 'ghana',
        currency: 'GHS',
      },
    });

    if (response.data.status && response.data.data) {
      return response.data.data;
    }

    return [];
  } catch (error) {
    console.error('[PayoutService] Error fetching banks:', error.response?.data || error.message);
    return [];
  }
};

/**
 * Resolve bank account details
 * @param {String} accountNumber - Bank account number
 * @param {String} bankCode - Paystack bank code
 * @returns {Promise<Object>} Account details
 */
exports.resolveBankAccount = async (accountNumber, bankCode) => {
  try {
    const response = await paystackApi.get(PAYSTACK_ENDPOINTS.RESOLVE_BANK, {
      params: {
        account_number: accountNumber,
        bank_code: bankCode,
      },
    });

    if (response.data.status && response.data.data) {
      return {
        account_number: response.data.data.account_number,
        account_name: response.data.data.account_name,
        bank_id: response.data.data.bank_id,
      };
    }

    throw new AppError('Failed to resolve bank account', 400);
  } catch (error) {
    console.error('[PayoutService] Error resolving bank:', error.response?.data || error.message);
    
    if (error.response?.data?.message) {
      throw new AppError(`Paystack error: ${error.response.data.message}`, error.response.status || 400);
    }
    
    throw new AppError('Failed to resolve bank account', 400);
  }
};

