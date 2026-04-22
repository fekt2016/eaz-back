const mongoose = require('mongoose');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const FlashDeal = require('../../models/product/dealsModel');
const FlashDealProduct = require('../../models/product/flashDealProductModel');
const Product = require('../../models/product/productModel');
const {
  computeFlashPrice,
  effectiveDiscountPercent,
} = require('../../utils/flashDealHelpers');
const {
  findConflictingDiscounts,
  findConflictingFlashDeals,
} = require('../../services/pricing/productOfferGuardService');

const isProductEligible = (product) => {
  if (!product || product.isDeleted) return false;
  if (product.status !== 'active') return false;
  if (product.moderationStatus && product.moderationStatus !== 'approved') {
    return false;
  }
  return true;
};

exports.getActiveFlashDeals = catchAsync(async (req, res) => {
  const sellerId = req.user.id;
  const now = new Date();

  const deals = await FlashDeal.find({
    status: { $in: ['scheduled', 'active'] },
    endTime: { $gt: now },
  }).sort({ startTime: 1 });

  const dealIds = deals.map((d) => d._id);
  const mySubs = await FlashDealProduct.find({
    seller: sellerId,
    flashDeal: { $in: dealIds },
  }).select('flashDeal status _id');

  const subByDeal = {};
  mySubs.forEach((s) => {
    subByDeal[String(s.flashDeal)] = {
      _id: s._id,
      status: s.status,
    };
  });

  const approvedCounts = await FlashDealProduct.aggregate([
    { $match: { flashDeal: { $in: dealIds }, status: 'approved' } },
    { $group: { _id: '$flashDeal', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(
    approvedCounts.map((r) => [String(r._id), r.count]),
  );

  const payload = deals.map((d) => {
    const o = d.toObject({ virtuals: true });
    const id = String(d._id);
    return {
      ...o,
      approvedProductCount: countMap[id] || 0,
      mySubmission: subByDeal[id] || null,
    };
  });

  res.status(200).json({
    status: 'success',
    data: { flashDeals: payload },
  });
});

exports.submitProduct = catchAsync(async (req, res, next) => {
  const { flashDealId, productId, discountType, discountValue } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(flashDealId)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product id.', 400));
  }
  if (!['percentage', 'fixed'].includes(discountType)) {
    throw new AppError('discountType must be percentage or fixed.', 400);
  }

  const dv = Number(discountValue);
  if (!Number.isFinite(dv) || dv < 1) {
    throw new AppError('discountValue must be a number >= 1.', 400);
  }

  const deal = await FlashDeal.findById(flashDealId);
  if (!deal) return next(new AppError('Flash deal not found.', 404));

  const now = Date.now();
  if (['ended', 'cancelled'].includes(deal.status) || new Date(deal.endTime).getTime() <= now) {
    throw new AppError('This flash deal is not accepting submissions.', 400);
  }

  const approvedCount = await FlashDealProduct.countDocuments({
    flashDeal: deal._id,
    status: 'approved',
  });
  if (approvedCount >= (deal.maxProducts || 50)) {
    throw new AppError('This flash deal is full.', 400);
  }

  const product = await Product.findById(productId);
  if (!product) return next(new AppError('Product not found.', 404));

  if (String(product.seller) !== String(req.user.id)) {
    throw new AppError('You can only submit your own products.', 403);
  }

  if (!isProductEligible(product)) {
    throw new AppError('Product must be active and approved for sale.', 400);
  }

  const discountConflicts = await findConflictingDiscounts({
    sellerId: req.user.id,
    products: [product],
    startDate: deal.startTime,
    endDate: deal.endTime,
  });

  if (discountConflicts.length > 0) {
    throw new AppError(
      'Product already has an active/upcoming discount in this promo window. Multiple promos/discounts are not allowed.',
      400,
    );
  }

  const flashConflicts = await findConflictingFlashDeals({
    sellerId: req.user.id,
    productIds: [product._id],
    startDate: deal.startTime,
    endDate: deal.endTime,
    excludeFlashDealId: deal._id,
  });

  if (flashConflicts.length > 0) {
    throw new AppError(
      'Product is already submitted to another active/scheduled flash promo in this period.',
      400,
    );
  }

  const originalPrice = Number(product.price);
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new AppError('Product has no valid price.', 400);
  }

  const minP = deal.discountRules?.minDiscountPercent ?? 10;
  const maxP = deal.discountRules?.maxDiscountPercent ?? 70;

  const flashPrice = computeFlashPrice(originalPrice, discountType, dv);
  if (flashPrice == null || flashPrice <= 0 || flashPrice >= originalPrice) {
    throw new AppError('Invalid discount for this product price.', 400);
  }

  if (discountType === 'percentage') {
    if (dv < minP || dv > maxP) {
      throw new AppError(
        `Discount percentage must be between ${minP}% and ${maxP}%.`,
        400,
      );
    }
  } else {
    const eff = effectiveDiscountPercent(originalPrice, flashPrice);
    if (eff + 1e-6 < minP || eff - 1e-6 > maxP) {
      throw new AppError(
        `Fixed discount must be equivalent to between ${minP}% and ${maxP}% off.`,
        400,
      );
    }
  }

  const existing = await FlashDealProduct.findOne({
    flashDeal: deal._id,
    product: product._id,
  });
  if (existing) {
    throw new AppError('This product is already submitted for this flash deal.', 400);
  }

  let submission;
  try {
    submission = await FlashDealProduct.create({
      flashDeal: deal._id,
      product: product._id,
      seller: req.user.id,
      discountType,
      discountValue: dv,
      originalPrice,
      flashPrice,
      status: 'pending',
    });
  } catch (e) {
    throw new AppError(e.message || 'Could not create submission.', 400);
  }

  const populated = await FlashDealProduct.findById(submission._id)
    .populate('flashDeal', 'title slug startTime endTime status discountRules maxProducts')
    .populate('product', 'name images price');

  res.status(201).json({
    status: 'success',
    data: { submission: populated },
  });
});

exports.getMySubmissions = catchAsync(async (req, res) => {
  const filter = { seller: req.user.id };
  if (req.query.flashDeal && mongoose.Types.ObjectId.isValid(req.query.flashDeal)) {
    filter.flashDeal = req.query.flashDeal;
  }
  if (req.query.status) filter.status = req.query.status;

  const submissions = await FlashDealProduct.find(filter)
    .sort({ submittedAt: -1 })
    .populate(
      'flashDeal',
      'title slug description bannerImage startTime endTime status discountRules maxProducts',
    )
    .populate('product', 'name images price status');

  res.status(200).json({
    status: 'success',
    data: { submissions },
  });
});

exports.withdrawSubmission = catchAsync(async (req, res, next) => {
  const { submissionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(submissionId)) {
    return next(new AppError('Invalid submission id.', 400));
  }

  const submission = await FlashDealProduct.findOne({
    _id: submissionId,
    seller: req.user.id,
  });

  if (!submission) return next(new AppError('Submission not found.', 404));

  if (submission.status !== 'pending') {
    throw new AppError('Only pending submissions can be withdrawn.', 400);
  }

  await submission.deleteOne();

  res.status(204).send();
});
