const Discount = require('../../models/product/discountModel');
const Product = require('../../models/product/productModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const {
  findConflictingDiscounts,
  findConflictingFlashDeals,
} = require('../../services/pricing/productOfferGuardService');

const getTargetProducts = async ({ sellerId, productIds, categoryIds }) => {
  const query = { seller: sellerId };

  if (Array.isArray(productIds) && productIds.length > 0) {
    query._id = { $in: productIds };
  } else if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    query.$or = [
      { parentCategory: { $in: categoryIds } },
      { subCategory: { $in: categoryIds } },
    ];
  }

  return Product.find(query).select('_id name parentCategory subCategory promotionKey');
};

const enforceSingleOfferPerProduct = async ({
  sellerId,
  products,
  startDate,
  endDate,
  excludeDiscountId,
}) => {
  const discountConflicts = await findConflictingDiscounts({
    sellerId,
    products,
    startDate,
    endDate,
    excludeDiscountId,
  });

  if (discountConflicts.length > 0) {
    const sample = discountConflicts
      .slice(0, 3)
      .map((item) => `${item.productName} -> ${item.discountName}`)
      .join(', ');
    throw new AppError(
      `Cannot apply multiple discounts/promos to the same product. Conflict with existing discount(s): ${sample}`,
      400,
    );
  }

  const flashConflicts = await findConflictingFlashDeals({
    sellerId,
    productIds: products.map((p) => p._id),
    startDate,
    endDate,
  });

  if (flashConflicts.length > 0) {
    const sample = flashConflicts
      .slice(0, 3)
      .map((item) => item.flashDealTitle)
      .join(', ');
    throw new AppError(
      `Cannot apply discount because one or more products already have a flash promo in the same period: ${sample}`,
      400,
    );
  }
};

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

    // Update each product and persist (applyDiscounts only mutates in memory)
    for (const product of products) {
      await product.applyDiscounts();
      await product.save();
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

  if (endDate < startDate) {
    return next(new AppError('End date must be greater than start date', 400));
  }

  const productObjectIds = products
    ? products.map((id) => new mongoose.Types.ObjectId(id))
    : [];
  const categoryObjectIds = categories
    ? categories.map((id) => new mongoose.Types.ObjectId(id))
    : [];

  const targetProducts = await getTargetProducts({
    sellerId: req.user.id,
    productIds: productObjectIds,
    categoryIds: categoryObjectIds,
  });

  await enforceSingleOfferPerProduct({
    sellerId: req.user.id,
    products: targetProducts,
    startDate,
    endDate,
  });

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
    products: productObjectIds,
    categories: categoryObjectIds,
  });

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
  if (req.body.endDate && req.body.startDate && req.body.endDate < req.body.startDate) {
    return next(new AppError('End date must be greater than start date', 400));
  }

  const existing = await Discount.findById(req.params.id);
  if (!existing) {
    return next(new AppError('No discount found with that ID', 404));
  }

  const effectiveProducts = req.body.products
    ? req.body.products.map((id) => new mongoose.Types.ObjectId(id))
    : existing.products;
  const effectiveCategories = req.body.categories
    ? req.body.categories.map((id) => new mongoose.Types.ObjectId(id))
    : existing.categories;
  const effectiveStartDate = req.body.startDate || existing.startDate;
  const effectiveEndDate = req.body.endDate || existing.endDate;
  const effectiveActive =
    typeof req.body.active === 'boolean' ? req.body.active : existing.active;

  if (effectiveActive) {
    const targetProducts = await getTargetProducts({
      sellerId: req.user.id,
      productIds: effectiveProducts,
      categoryIds: effectiveCategories,
    });

    await enforceSingleOfferPerProduct({
      sellerId: req.user.id,
      products: targetProducts,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      excludeDiscountId: req.params.id,
    });
  }

  const discount = await Discount.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

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
