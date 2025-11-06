const BrowserHistory = require('../../models/user/browserHistoryModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');

exports.getMyHistory = catchAsync(async (req, res, next) => {
  const history = await BrowserHistory.find({ user: req.user.id })
    .sort('-viewedAt')
    .lean();

  res.status(200).json({
    status: 'success',
    results: history.length,
    data: {
      history,
    },
  });
});

exports.addHistoryItem = catchAsync(async (req, res, next) => {
  // This would be called from product/seller view pages

  const { type, itemId, itemData } = req.body;
  // Prevent duplicate entries for the same item in a short time
  const existingEntry = await BrowserHistory.findOne({
    user: req.user.id,
    itemId: new mongoose.Types.ObjectId(itemId),
    viewedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // 24 hours
  });

  if (!existingEntry) {
    await BrowserHistory.create({
      user: req.user.id,
      type,
      itemId,
      itemData,
    });
  }

  if (existingEntry) {
    return next(
      new AppError(
        'You have already viewed this item in the last 24 hours',
        400,
      ),
    );
  }

  res.status(201).json({
    status: 'success',
    data: null,
  });
});

exports.deleteHistoryItem = catchAsync(async (req, res, next) => {
  const historyItem = await BrowserHistory.findOneAndDelete({
    _id: req.params.id,
    user: req.user.id,
  });

  if (!historyItem) {
    return next(new AppError('History item not found', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

exports.deleteMultipleHistoryItems = catchAsync(async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!ids || ids.length === 0) {
      return next(new AppError('No ids provided', 400));
    }

    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

    await BrowserHistory.deleteMany({ _id: { $in: objectIds } });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to delete items',
      error: error.message,
    });
  }
});

exports.clearMyHistory = catchAsync(async (req, res, next) => {
  await BrowserHistory.deleteMany({ user: req.user.id });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
