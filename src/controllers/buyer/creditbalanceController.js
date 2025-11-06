const Creditbalance = require('../../models/user/creditbalanceModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const mongoose = require('mongoose');

// Get user's credit balance
exports.getCreditBalance = catchAsync(async (req, res, next) => {
  // console.log('user', req.user.id);
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const creditbalance = await Creditbalance.findOne({
    user: userId,
  });

  if (!creditbalance) {
    // Initialize if doesn't exist
    try {
      const newCredit = await Creditbalance.create({ user: userId });
      console.log('newCredit', newCredit);
    } catch (error) {
      console.log('error', error);
    }
    return res.json({
      status: 'success',
      data: { creditbalance: newCredit },
    });
  }

  res.json({
    status: 'success',
    data: { creditbalance },
  });
});

// Add credit to user's account
exports.addCredit = catchAsync(async (req, res, next) => {
  const { amount, description, reference, user } = req.body;

  const userId = new mongoose.Types.ObjectId(user);
  const creditbalance = await Creditbalance.findOneAndUpdate(
    { user: userId },
    {
      $inc: { balance: amount },
      $push: {
        transactions: {
          amount,
          type: 'topup',
          description,
          reference,
        },
      },
      $set: { lastUpdated: Date.now() },
    },
    { new: true, upsert: true },
  );

  res.json({
    status: 'success',
    data: { creditbalance },
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
