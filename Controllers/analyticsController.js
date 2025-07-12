const ProductView = require('../Models/productViewModel');
const catchAsync = require('../utils/catchAsync');

exports.getSellerProductViews = catchAsync(async (req, res, next) => {
  console.log(req.params.sellerId);
  try {
    const sellerId = req.params.sellerId;
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
      { $match: { 'product.seller': sellerId } },
      { $sort: { viewedAt: -1 } },
    ]);
    console.log('views', views);
    res.status(200).json({ status: 'success', data: { views } });
  } catch (error) {
    console.log(error);
  }
});

exports.recordView = catchAsync(async (req, res, next) => {
  try {
    const { productId, sessionId } = req.body;

    const view = await ProductView.create({
      product: productId,
      sessionId,
      viewedAt: new Date(),
    });

    res.status(201).json({ status: 'success', data: { view } });
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message,
    });
  }
});
