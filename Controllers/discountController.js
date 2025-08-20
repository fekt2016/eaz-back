const Discount = require('../Models/discountModel');
const Product = require('../Models/productModel');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');

exports.createDiscount = catchAsync(async (req, res, next) => {
  const {
    name,
    code,
    type,
    value,
    startDate,
    endDate,
    maxUsage,
    active,
    products, // Array of product IDs
  } = req.body;

  const discount = await Discount.create({
    name,
    code,
    type,
    value,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    maxUsage,
    active,
    seller: req.user.id,
    products: products.map((id) => new mongoose.Types.ObjectId(id)),
  });

  // Apply discount to products
  const updatedProducts = await Product.updateMany(
    { _id: { $in: products } },
    { $push: { discounts: discount._id } },
  );

  res.status(201).json({
    status: 'success',
    data: { discount },
  });
});
exports.getAllDiscount = catchAsync(async (req, res) => {
  let discounts;
  if (req.user.role === 'seller') {
    discounts = await Discount.find({ seller: req.user.id });
  } else {
    discounts = await Discount.find();
  }

  res.status(200).json({
    status: 'success',
    data: { discounts },
  });
});

exports.getDiscount = catchAsync(async (req, res) => {
  const discount = await Discount.findById(req.params.id);
  res.status(200).json({
    status: 'success',
    data: { discount },
  });
});

exports.updateDiscount = catchAsync(async (req, res, next) => {
  // const discountId = new mongoose.Types.ObjectId(req.param.id);
  const discount = await Discount.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!discount) {
    return next(new AppError('No discount found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { discount },
  });
});

exports.deleteDiscount = catchAsync(async (req, res) => {
  const discount = await Discount.findByIdAndDelete(req.params.id);
  res.status(200).json({
    status: 'success',
    data: { discount },
  });
});
