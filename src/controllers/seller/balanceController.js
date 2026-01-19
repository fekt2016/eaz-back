const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Seller = require('../../models/user/sellerModel');
const Transaction = require('../../models/transaction/transactionModel');
const SellerRevenueHistory = require('../../models/history/sellerRevenueHistoryModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const mongoose = require('mongoose');

/**
 * Get seller balance
 * GET /api/v1/seller/balance
 */
exports.getSellerBalance = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;

  const seller = await Seller.findById(sellerId).select('balance lockedBalance pendingBalance withdrawableBalance name shopName');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Ensure withdrawableBalance is calculated correctly
  // Formula: withdrawableBalance = balance - lockedBalance - pendingBalance
  // lockedBalance = funds locked by admin due to disputes/issues
  // pendingBalance = funds in withdrawal requests awaiting approval/OTP
  seller.calculateWithdrawableBalance();
  
  // Explicitly ensure withdrawableBalance is set correctly (double-check)
  const calculatedWithdrawable = Math.max(0, (seller.balance || 0) - (seller.lockedBalance || 0) - (seller.pendingBalance || 0));
  if (Math.abs((seller.withdrawableBalance || 0) - calculatedWithdrawable) > 0.01) {
    // Only save if there's a significant discrepancy (more than 1 cent)
    seller.withdrawableBalance = calculatedWithdrawable;
    await seller.save(); // Save if there's a discrepancy
    logger.info(`[getSellerBalance] Corrected withdrawableBalance for seller ${sellerId}: ${seller.withdrawableBalance}`);
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

  // Calculate total revenue: balance (current) + totalWithdrawn (all time)
  // This represents all earnings from delivered orders
  const totalRevenue = (seller.balance || 0) + (totalWithdrawn || 0);

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
      seller: {
        name: seller.name,
        shopName: seller.shopName,
      },
      // Verification: totalRevenue = balance + totalWithdrawn
      // Verification: balance = withdrawableBalance + lockedBalance + pendingBalance
    },
  });
});

/**
 * Get seller transactions
 * GET /api/v1/seller/transactions
 */
exports.getSellerTransactions = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  // Build filter
  const filter = { seller: sellerId };
  if (req.query.type) {
    filter.type = req.query.type; // 'credit' or 'debit'
  }
  if (req.query.status) {
    filter.status = req.query.status;
  }

  // Get transactions
  const transactions = await Transaction.find(filter)
    .populate({
      path: 'sellerOrder',
      select: 'subtotal shippingCost tax',
      populate: {
        path: 'order',
        select: 'orderNumber totalPrice createdAt',
      },
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Get total count
  const total = await Transaction.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: transactions.length,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    data: {
      transactions,
    },
  });
});

/**
 * Get seller earnings summary
 * GET /api/v1/seller/earnings
 */
exports.getSellerEarnings = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
  const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

  // Get all credit transactions in date range
  const transactions = await Transaction.find({
    seller: sellerId,
    type: 'credit',
    status: 'completed',
    createdAt: { $gte: startDate, $lte: endDate },
  }).lean();

  // Calculate totals
  const totalEarnings = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalTransactions = transactions.length;

  // Get current balance
  const seller = await Seller.findById(sellerId).select('balance lockedBalance pendingBalance');
  const currentBalance = seller?.balance || 0;
  const lockedBalance = seller?.lockedBalance || 0; // Funds locked by admin due to disputes/issues
  const pendingBalance = seller?.pendingBalance || 0; // Funds in withdrawal requests awaiting approval/OTP
  const availableBalance = Math.max(0, currentBalance - lockedBalance - pendingBalance);

  res.status(200).json({
    status: 'success',
    data: {
      period: {
        startDate,
        endDate,
      },
      earnings: {
        total: totalEarnings,
        transactionCount: totalTransactions,
        averagePerTransaction: totalTransactions > 0 ? totalEarnings / totalTransactions : 0,
      },
      balance: {
        current: currentBalance,
        locked: lockedBalance, // Funds locked by admin due to disputes/issues
        pending: pendingBalance, // Funds in withdrawal requests awaiting approval/OTP
        available: availableBalance,
      },
    },
  });
});

/**
 * Get seller earnings by order
 * GET /api/v1/seller/earnings/order/:orderId
 */
exports.getSellerEarningsByOrder = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const orderId = req.params.orderId;

  // Get transaction for this order and seller
  // Find by sellerOrder which links to the order
  const SellerOrder = require('../../models/order/sellerOrderModel');
const logger = require('../../utils/logger');
  const sellerOrder = await SellerOrder.findOne({ 
    order: orderId, 
    seller: sellerId 
  });

  if (!sellerOrder) {
    return res.status(200).json({
      status: 'success',
      data: {
        earnings: null,
        message: 'No seller order found for this order',
      },
    });
  }

  const transaction = await Transaction.findOne({
    seller: sellerId,
    sellerOrder: sellerOrder._id,
    type: 'credit',
  })
    .populate({
      path: 'sellerOrder',
      select: 'subtotal shippingCost tax commissionRate',
      populate: {
        path: 'order',
        select: 'orderNumber totalPrice createdAt',
      },
    })
    .lean();

  if (!transaction) {
    return res.status(200).json({
      status: 'success',
      data: {
        earnings: null,
        message: 'No earnings found for this order',
      },
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      earnings: transaction,
    },
  });
});

/**
 * Get seller balance/revenue history
 * GET /api/v1/seller/me/revenue-history
 * Tracks all balance changes with balanceBefore and balanceAfter
 */
exports.getSellerRevenueHistory = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id; // Use req.user.id like other seller endpoints
  
  // Validate sellerId
  if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
    return next(new AppError('Invalid seller ID', 400));
  }

  const {
    page = 1,
    limit = 20,
    type = null,
    startDate = null,
    endDate = null,
    minAmount = null,
    maxAmount = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

  // Build query
  const query = { sellerId: new mongoose.Types.ObjectId(sellerId) };

  // Filter by type
  if (type) {
    const validTypes = ['ORDER_EARNING', 'REFUND_DEDUCTION', 'PAYOUT', 'ADMIN_ADJUST', 'CORRECTION', 'REVERSAL'];
    if (validTypes.includes(type.toUpperCase())) {
      query.type = type.toUpperCase();
    }
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

  // Filter by amount range
  if (minAmount !== null || maxAmount !== null) {
    query.amount = {};
    if (minAmount !== null) {
      query.amount.$gte = parseFloat(minAmount);
    }
    if (maxAmount !== null) {
      query.amount.$lte = parseFloat(maxAmount);
    }
  }

  // Get seller info for response
  const seller = await Seller.findById(sellerId).select('name shopName email balance').lean();

  const [history, total] = await Promise.all([
    SellerRevenueHistory.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('orderId', 'orderNumber totalPrice')
      .populate('refundId', 'status totalRefundAmount')
      .populate('payoutRequestId', 'status amount')
      .populate('adminId', 'name email')
      .lean(),
    SellerRevenueHistory.countDocuments(query),
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
      seller: seller ? {
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        currentBalance: seller.balance || 0,
      } : null,
      history: history.map(entry => ({
        ...entry,
        // Add computed fields for easier frontend display
        isCredit: ['ORDER_EARNING', 'ADMIN_ADJUST', 'CORRECTION'].includes(entry.type),
        isDebit: ['REFUND_DEDUCTION', 'PAYOUT', 'REVERSAL'].includes(entry.type),
      })),
    },
  });
});

module.exports = exports;

