const Review = require('../../models/product/reviewModel');
const handleFactory = require('../shared/handleFactory');
const catchAsync = require('../../utils/helpers/catchAsync');
const Product = require('../../models/product/productModel');
const AppError = require('../../utils/errors/appError');

exports.setProductUserIds = (req, res, next) => {
  if (!req.body.product) req.body.product = req.params.productId;
  if (!req.body.user) req.body.user = req.user.id;
  next();
};
exports.getAllReview = handleFactory.getAll(Review);
exports.getReview = handleFactory.getOne(Review, {
  path: 'product',
  select: 'names',
  path: 'user',
  select: 'name photo',
});
exports.createUserReview = catchAsync(async (req, res, next) => {
  // Allow nested routes

  if (!req.body.product) req.body.product = req.params.productId;
  if (!req.body.user) req.body.user = req.user.id;

  // Validate required fields
  const { rating, review, title, product, user } = req.body;
  if (!rating || !review || !title) {
    return next(new AppError('Please provide rating, title, and comment', 400));
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    return next(new AppError('Product not found', 404));
  }

  // Check if user already reviewed this product
  const existingReview = await Review.findOne({ product, user: req.user.id });

  if (existingReview) {
    return next(new AppError('You have already reviewed this product', 400));
  }

  try {
    const newReview = await Review.create({
      rating,
      review,
      title,
      product,
      user,
    });
    res.status(201).json({
      status: 'success',
      data: {
        review: newReview,
      },
    });
  } catch (error) {
    console.log(error.message);
  }
});

// Update and delete controllers remain simple as hooks handle updates
exports.updateReview = catchAsync(async (req, res, next) => {
  const updatedReview = await Review.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true },
  );

  if (!updatedReview) {
    return next(new AppError('Review not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

exports.deleteReview = catchAsync(async (req, res, next) => {
  const review = await Review.findByIdAndDelete(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
exports.createReview = handleFactory.createOne(Review);
exports.updateReview = handleFactory.updateOne(Review);
exports.deleteReview = handleFactory.deleteOne(Review);
