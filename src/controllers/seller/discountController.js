const Discount = require('../../models/product/discountModel');
const Product = require('../../models/product/productModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');

// Helper function to update products when discounts change
const updateAffectedProducts = async (discount) => {
  try {
    let query = {};

    if (discount.products && discount.products.length > 0) {
      // Discount applies to specific products
      query = { _id: { $in: discount.products } };
    } else if (discount.categories && discount.categories.length > 0) {
      // Discount applies to categories
      query = {
        $or: [
          { parentCategory: { $in: discount.categories } },
          { subCategory: { $in: discount.categories } },
        ],
      };
    } else {
      // Store-wide discount
      query = { seller: discount.seller };
    }

    // Find all affected products
    const products = await Product.find(query);

    // Update each product
    for (const product of products) {
      await product.applyDiscounts();
    }

    return products.length;
  } catch (error) {
    logger.error('Error updating affected products:', error);
    throw error;
  }
};

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
    categories, // Array of category IDs
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
    products: products
      ? products.map((id) => new mongoose.Types.ObjectId(id))
      : [],
    categories: categories
      ? categories.map((id) => new mongoose.Types.ObjectId(id))
      : [],
  });
  if (endDate < startDate) {
    return next(new AppError('End date must be greater than start date', 400));
  }
  // Update affected products
  await updateAffectedProducts(discount);

  res.status(201).json({
    status: 'success',
    data: { discount },
  });
});

exports.getAllDiscount = catchAsync(async (req, res) => {
  let discounts;
  if (req.user.role === 'seller') {
    discounts = await Discount.find({ seller: req.user.id }).populate(
      'products categories',
    );
  } else {
    discounts = await Discount.find().populate('products categories');
  }

  res.status(200).json({
    status: 'success',
    data: { discounts },
  });
});

exports.getDiscount = catchAsync(async (req, res) => {
  const discount = await Discount.findById(req.params.id).populate(
    'products categories',
  );
  res.status(200).json({
    status: 'success',
    data: { discount },
  });
});

exports.updateDiscount = catchAsync(async (req, res, next) => {
  const discount = await Discount.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!discount) {
    return next(new AppError('No discount found with that ID', 404));
  }

  if (req.body.endDate < req.body.startDate) {
    return next(new AppError('End date must be greater than start date', 400));
  }

  // Update affected products
  await updateAffectedProducts(discount);

  res.status(200).json({
    status: 'success',
    data: { discount },
  });
});

exports.deleteDiscount = catchAsync(async (req, res) => {
  const discount = await Discount.findById(req.params.id);

  if (!discount) {
    return next(new AppError('No discount found with that ID', 404));
  }

  await Discount.findByIdAndDelete(req.params.id);

  // Update affected products to remove this discount
  await updateAffectedProducts(discount);

  res.status(200).json({
    status: 'success',
    data: { discount },
  });
});

// New endpoint to get active discounts for a product
exports.getProductDiscounts = catchAsync(async (req, res, next) => {
  const productId = req.params.productId;
  const now = new Date();

  const discounts = await Discount.find({
    $or: [
      { products: productId },
      {
        categories: {
          $in: [req.product.parentCategory, req.product.subCategory],
        },
      },
      { products: { $size: 0 }, categories: { $size: 0 } }, // Store-wide discounts
    ],
    active: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  });

  res.status(200).json({
    status: 'success',
    data: { discounts },
  });
});
