const walletService = require('../../services/walletService');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const WalletHistory = require('../../models/history/walletHistoryModel');

/**
 * GET /api/v1/wallet/balance
 * Get user's wallet balance
 */
exports.getWalletBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const wallet = await walletService.getWalletBalance(userId);

  res.status(200).json({
    status: 'success',
    data: {
      wallet: {
        balance: wallet.balance || 0,
        availableBalance: wallet.availableBalance || 0,
        holdAmount: wallet.holdAmount || 0,
        currency: wallet.currency || 'GHS',
        lastUpdated: wallet.lastUpdated,
      },
    },
  });
});

/**
 * GET /api/v1/wallet/transactions
 * Get wallet transaction history with pagination
 */
exports.getWalletTransactions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page, limit, type, sortBy, sortOrder } = req.query;

  const result = await walletService.getWalletTransactions(userId, {
    page,
    limit,
    type,
    sortBy,
    sortOrder,
  });

  res.status(200).json({
    status: 'success',
    results: result.pagination.total,
    pagination: result.pagination,
    data: {
      transactions: result.transactions,
    },
  });
});

/**
 * POST /api/v1/wallet/topup
 * Initialize Paystack top-up payment
 */
exports.initiateTopup = catchAsync(async (req, res, next) => {
  const { amount, email } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return next(new AppError('Invalid amount', 400));
  }

  // Validate email
  const userEmail = email || req.user.email;
  if (!userEmail) {
    return next(new AppError('Email is required for payment', 400));
  }

  // Check if Paystack is configured
  const { paystackApi, PAYSTACK_SECRET_KEY } = require('../../config/paystack');
  if (!PAYSTACK_SECRET_KEY) {
    console.error('[Wallet] PAYSTACK_SECRET_KEY is not configured');
    return next(new AppError('Payment service is not configured. Please contact support.', 500));
  }

  const reference = `WALLET-TOPUP-${userId}-${Date.now()}`;

  try {
    // Get frontend URL for callback - use WALLET_CALLBACK_URL if provided, otherwise fallback
    const walletCallbackUrl = process.env.WALLET_CALLBACK_URL;
    const frontendUrl = process.env.MAIN_APP_URL || process.env.EAZMAIN_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const callbackUrl = walletCallbackUrl || `${frontendUrl}/wallet/topup-success?reference=${reference}`;

    // Validate amount is within Paystack limits (minimum 1 GHS = 100 kobo)
    const amountInKobo = Math.round(amount * 100);
    if (amountInKobo < 100) {
      return next(new AppError('Minimum top-up amount is GH₵1.00', 400));
    }

    console.log('[Wallet] Initializing Paystack payment:', {
      email: userEmail,
      amount: amountInKobo,
      reference,
      callbackUrl,
    });

    const response = await paystackApi.post('/transaction/initialize', {
      email: userEmail,
      amount: amountInKobo, // Convert to smallest currency unit (kobo)
      reference,
      callback_url: callbackUrl,
      metadata: {
        userId: userId.toString(),
        type: 'wallet_topup',
        amount: amount,
      },
    });

    // Check if Paystack returned an error in the response
    if (!response.data || !response.data.status) {
      console.error('[Wallet] Paystack returned invalid response:', response.data);
      return next(new AppError('Invalid response from payment service', 500));
    }

    if (response.data.status === false) {
      const errorMessage = response.data.message || 'Payment initialization failed';
      console.error('[Wallet] Paystack error:', errorMessage, response.data);
      return next(new AppError(errorMessage, 400));
    }

    if (!response.data.data || !response.data.data.authorization_url) {
      console.error('[Wallet] Paystack response missing authorization URL:', response.data);
      return next(new AppError('Payment service did not return authorization URL', 500));
    }

    res.status(200).json({
      status: 'success',
      message: 'Top-up initiated',
      data: {
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference,
        amount,
      },
    });
  } catch (error) {
    // Enhanced error logging
    console.error('[Wallet] Paystack initialization error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack,
    });

    // Extract error message from Paystack response
    let errorMessage = 'Failed to initialize top-up payment';
    if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    // Check for specific error types
    if (error.response?.status === 401) {
      return next(new AppError('Payment service authentication failed. Please contact support.', 500));
    } else if (error.response?.status === 400) {
      return next(new AppError(errorMessage || 'Invalid payment request', 400));
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return next(new AppError('Payment service is temporarily unavailable. Please try again later.', 503));
    }

    return next(new AppError(errorMessage, 500));
  }
});

/**
 * POST /api/v1/wallet/verify
 * Verify Paystack top-up payment (called from webhook or frontend)
 */
exports.verifyTopup = catchAsync(async (req, res, next) => {
  const { reference } = req.body;

  if (!reference) {
    return next(new AppError('Reference is required', 400));
  }

  // Check if transaction already processed (idempotency)
  const WalletTransaction = require('../../models/user/walletTransactionModel');
  const existingTransaction = await WalletTransaction.findOne({ reference });

  if (existingTransaction) {
    return res.status(200).json({
      status: 'success',
      message: 'Transaction already processed',
      data: {
        transaction: existingTransaction,
        wallet: await walletService.getWalletBalance(existingTransaction.user),
      },
    });
  }

  // Verify with Paystack
  const { paystackApi } = require('../../config/paystack');
  
  try {
    const response = await paystackApi.get(`/transaction/verify/${reference}`);

    // Paystack returns: { status: true, message: "...", data: { ...transaction data... } }
    if (!response.data || response.data.status === false) {
      const errorMessage = response.data?.message || 'Payment verification failed';
      console.error('[Wallet] Paystack verification failed:', response.data);
      return next(new AppError(errorMessage, 400));
    }

    // Transaction data is in response.data.data
    const transaction = response.data.data;
    
    if (!transaction) {
      console.error('[Wallet] Paystack response missing transaction data:', response.data);
      return next(new AppError('Invalid response from payment service', 500));
    }

    // Check if transaction was successful
    if (transaction.status !== 'success') {
      const statusMessage = transaction.gateway_response || transaction.message || 'Payment not successful';
      console.error('[Wallet] Transaction not successful:', {
        status: transaction.status,
        message: statusMessage,
        reference,
      });
      return next(new AppError(`Payment verification failed: ${statusMessage}`, 400));
    }

    // Get amount and convert from kobo to GHS
    const amount = transaction.amount ? transaction.amount / 100 : 0;
    
    // Get userId from metadata
    const userId = transaction.metadata?.userId || req.user?.id;

    if (!userId) {
      console.error('[Wallet] User ID not found in transaction metadata:', transaction.metadata);
      return next(new AppError('User ID not found in transaction metadata', 400));
    }

    if (amount <= 0) {
      console.error('[Wallet] Invalid amount in transaction:', amount);
      return next(new AppError('Invalid transaction amount', 400));
    }

    console.log('[Wallet] Verifying transaction:', {
      reference,
      amount,
      userId,
      transactionStatus: transaction.status,
    });

    // Credit wallet
    const result = await walletService.creditWallet(
      userId,
      amount,
      'CREDIT_TOPUP',
      `Wallet top-up via Paystack - ${reference}`,
      reference,
      {
        paystackReference: reference,
        paystackTransactionId: transaction.id?.toString(),
        email: transaction.customer?.email,
        paidAt: transaction.paid_at,
        channel: transaction.channel,
        currency: transaction.currency,
      }
    );

    res.status(200).json({
      status: 'success',
      message: 'Top-up successful',
      data: {
        transaction: result.transaction,
        wallet: result.wallet,
      },
    });
  } catch (error) {
    // Enhanced error logging
    console.error('[Wallet] Paystack verification error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      reference,
      stack: error.stack,
    });

    // Extract error message from Paystack response
    let errorMessage = 'Failed to verify payment';
    if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    // Check for specific error types
    if (error.response?.status === 401) {
      return next(new AppError('Payment service authentication failed. Please contact support.', 500));
    } else if (error.response?.status === 404) {
      return next(new AppError('Transaction not found. Please check the reference and try again.', 404));
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return next(new AppError('Payment service is temporarily unavailable. Please try again later.', 503));
    }

    return next(new AppError(errorMessage, 500));
  }
});

/**
 * GET /api/v1/wallet/history
 * Get wallet balance history with pagination and filters
 */
exports.getWalletHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 10,
    type = null,
    startDate = null,
    endDate = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

  const query = { userId };

  // Filter by type
  if (type) {
    query.type = type;
  }

  // Filter by date range
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const [history, total] = await Promise.all([
    WalletHistory.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('orderId', 'orderNumber')
      .populate('refundId', 'status')
      .lean(),
    WalletHistory.countDocuments(query),
  ]);

  res.status(200).json({
    status: 'success',
    results: history.length,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
    data: {
      history,
    },
  });
});

/**
 * POST /api/v1/wallet/adjust
 * Admin adjustment (credit or debit)
 */
exports.adjustWallet = catchAsync(async (req, res, next) => {
  const { userId, amount, type, description } = req.body;

  if (!userId || !amount || !type || !description) {
    return next(new AppError('userId, amount, type, and description are required', 400));
  }

  if (!['CREDIT_ADJUSTMENT', 'DEBIT_ADJUSTMENT'].includes(type)) {
    return next(new AppError('Invalid adjustment type', 400));
  }

  const reference = `ADJUST-${userId}-${Date.now()}`;

  let result;
  if (type === 'CREDIT_ADJUSTMENT') {
    result = await walletService.creditWallet(
      userId,
      amount,
      'CREDIT_ADJUSTMENT',
      description,
      reference,
      {
        adjustedBy: req.user.id,
        adjustedByRole: req.user.role,
      }
    );
  } else {
    result = await walletService.debitWallet(
      userId,
      amount,
      'DEBIT_ADJUSTMENT',
      description,
      reference,
      {
        adjustedBy: req.user.id,
        adjustedByRole: req.user.role,
      }
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Wallet adjusted successfully',
    data: {
      transaction: result.transaction,
      wallet: result.wallet,
    },
  });
});

