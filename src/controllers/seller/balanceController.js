const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Seller = require('../../models/user/sellerModel');
const Transaction = require('../../models/transaction/transactionModel');
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
    console.log(`[getSellerBalance] Corrected withdrawableBalance for seller ${sellerId}: ${seller.withdrawableBalance}`);
  }

  res.status(200).json({
    status: 'success',
    data: {
      balance: seller.balance || 0, // Total balance
      lockedBalance: seller.lockedBalance || 0, // Funds locked by admin due to disputes/issues
      pendingBalance: seller.pendingBalance || 0, // Funds in withdrawal requests awaiting approval/OTP
      withdrawableBalance: seller.withdrawableBalance || 0, // Available balance
      availableBalance: seller.withdrawableBalance || 0, // Alias for backward compatibility
      seller: {
        name: seller.name,
        shopName: seller.shopName,
      },
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
      path: 'order',
      select: 'orderNumber totalPrice createdAt',
    })
    .populate({
      path: 'sellerOrder',
      select: 'subtotal shippingCost tax',
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

module.exports = exports;

