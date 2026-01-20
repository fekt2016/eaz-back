const Creditbalance = require('../../models/user/creditbalanceModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');

// Get user's credit balance (READ-ONLY: no writes inside GET)
exports.getCreditBalance = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const creditbalance = await Creditbalance.findOne({ user: userId });

  if (!creditbalance) {
    // Do NOT create a new document in a GET route.
    // Return a synthetic zero-balance object so callers can render safely.
    return res.json({
      status: 'success',
      data: {
        creditbalance: {
          user: userId,
          balance: 0,
          availableBalance: 0,
          holdAmount: 0,
          currency: 'GHS',
        },
      },
    });
  }

  res.json({
    status: 'success',
    data: { creditbalance },
  });
});

// Add credit to user's account (Admin adjustment - uses walletService)
exports.addCredit = catchAsync(async (req, res, next) => {
  const { amount, description, reference, user } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Invalid amount', 400));
  }

  const userId = new mongoose.Types.ObjectId(user);
  const walletService = require('../../services/walletService');
const logger = require('../../utils/logger');
  
  const finalReference = reference || `ADMIN-ADJUST-${userId}-${Date.now()}`;
  const finalDescription = description || `Admin credit adjustment`;

  // Use walletService for proper transaction logging
  const result = await walletService.creditWallet(
    userId,
    amount,
    'CREDIT_ADJUSTMENT',
    finalDescription,
    finalReference,
    {
      adjustedBy: req.user.id,
      adjustedByRole: req.user.role,
    }
  );

  res.json({
    status: 'success',
    data: {
      creditbalance: result.wallet,
      transaction: result.transaction,
    },
  });
});

// Get transaction history
exports.getTransactions = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  const credit = await Creditbalance.findOne({ user: req.user.id })
    .select('transactions')
    .slice('transactions', [skip, parseInt(limit)])
    .sort({ 'transactions.date': -1 });

  const totalTransactions = credit.transactions.length;

  res.json({
    status: 'success',
    results: totalTransactions,
    page: parseInt(page),
    pages: Math.ceil(totalTransactions / limit),
    data: { transactions: credit.transactions },
  });
});
