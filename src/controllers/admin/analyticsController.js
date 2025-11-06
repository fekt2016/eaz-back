const ProductView = require('../../models/product/productViewModel');
const Product = require('../../models/product/productModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const mongoose = require('mongoose');

exports.getSellerProductViews = catchAsync(async (req, res, next) => {
  try {
    const sellerId = req.params.sellerId;

    const sellerIdObj = new mongoose.Types.ObjectId(sellerId);

    const views = await ProductView.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      { $match: { 'product.seller': sellerIdObj } },
      { $sort: { viewedAt: -1 } },
    ]);

    res.status(200).json({ status: 'success', data: { views } });
  } catch (error) {
    console.log(error);
  }
});

exports.recordView = catchAsync(async (req, res) => {
  const { productId, sessionId } = req.body;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Check for existing view in last 24 hours
  const existingView = await ProductView.findOne({
    productId,
    sessionId,
    viewedAt: { $gte: oneDayAgo },
  });

  if (existingView) {
    return res.status(200).json({
      status: 'success',
      message: 'View already recorded within 24 hours',
    });
  }
  // Update the product's totalViews
  await Product.findByIdAndUpdate(productId, { $inc: { totalViews: 1 } });
  // Create new view
  const view = await ProductView.create({
    productId,
    sessionId,
    viewedAt: new Date(),
  });

  res.status(201).json({
    status: 'success',
    data: { view },
  });
});
