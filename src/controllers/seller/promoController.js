const mongoose = require('mongoose');
const Promo = require('../../models/promo/promoModel');
const PromoProduct = require('../../models/promo/promoProductModel');
const Product = require('../../models/product/productModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const {
  parsePagination,
  syncPromoStatuses,
  findPromoByIdentifier,
  findOverlappingSubmission,
  getProductRegularPrice,
  getProductAvailableStock,
  calculateEffectiveDiscountPercent,
  isObjectId,
} = require('../../services/promo/promoService');

const SELLER_ALLOWED_STATUSES = ['scheduled', 'active', 'ended', 'cancelled'];
const SUBMISSION_STATUS_FILTERS = ['pending', 'approved', 'rejected', 'withdrawn'];
const DISCOUNT_TYPES = ['percentage', 'fixed'];

const toRegex = (value) => new RegExp(String(value || '').trim(), 'i');

const buildSellerUsageMap = async ({ promoIds, sellerId }) => {
  if (!promoIds.length) return {};

  const rows = await PromoProduct.aggregate([
    {
      $match: {
        promo: { $in: promoIds },
        seller: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ['pending', 'approved'] },
      },
    },
    {
      $group: {
        _id: '$promo',
        used: { $sum: 1 },
      },
    },
  ]);

  return rows.reduce((acc, row) => {
    acc[String(row._id)] = Number(row.used || 0);
    return acc;
  }, {});
};

const parsePromoTabFilter = (tab) => {
  const normalized = String(tab || '').toLowerCase().trim();
  if (normalized === 'upcoming') return ['scheduled'];
  if (normalized === 'past') return ['ended', 'cancelled'];
  if (normalized === 'active') return ['active'];
  return ['scheduled', 'active'];
};

const parseEligibleCategories = (promo) => {
  const categories = Array.isArray(promo?.eligibleCategories)
    ? promo.eligibleCategories
    : [];
  return categories.map((item) => String(item?._id || item));
};

const formatSellerSubmission = (submission) => {
  const plain =
    typeof submission.toObject === 'function'
      ? submission.toObject()
      : submission;
  return plain;
};

exports.getSellerPromos = catchAsync(async (req, res) => {
  await syncPromoStatuses();

  const sellerId = req.user.id;
  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
  const statuses = parsePromoTabFilter(req.query.tab);

  const filter = {
    status: { $in: statuses },
  };

  const [promos, total] = await Promise.all([
    Promo.find(filter).sort({ startDate: 1, createdAt: -1 }).skip(skip).limit(limit),
    Promo.countDocuments(filter),
  ]);

  const usageByPromo = await buildSellerUsageMap({
    promoIds: promos.map((promo) => promo._id),
    sellerId,
  });

  const payload = promos.map((promo) => {
    const plain = promo.toObject();
    const used = usageByPromo[String(promo._id)] || 0;
    const maxProducts = Number(plain.maxProductsPerSeller || 0);
    const remainingSlots = maxProducts > 0 ? Math.max(maxProducts - used, 0) : 0;
    return {
      ...plain,
      submittedCount: used,
      sellerSubmissionCount: used,
      remainingSlots,
      sellerUsage: {
        used,
        remaining: remainingSlots,
      },
      sellerSubmissionStats: {
        used,
        remaining: remainingSlots,
      },
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      promos: payload,
      items: payload,
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      limit,
    },
  });
});

exports.getSellerPromo = catchAsync(async (req, res, next) => {
  await syncPromoStatuses();
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo || !SELLER_ALLOWED_STATUSES.includes(promo.status)) {
    return next(new AppError('Promo not found', 404));
  }

  const submissions = await PromoProduct.find({
    promo: promo._id,
    seller: req.user.id,
  })
    .populate('product', 'name imageCover price stock parentCategory subCategory')
    .sort({ createdAt: -1 });

  const used = submissions.filter((row) =>
    ['pending', 'approved'].includes(row.status),
  ).length;

  const maxProducts = Number(promo.maxProductsPerSeller || 0);
  const remainingSlots = maxProducts > 0 ? Math.max(maxProducts - used, 0) : 0;

  res.status(200).json({
    status: 'success',
    data: {
      promo: {
        ...promo.toObject(),
        sellerUsage: {
          used,
          remaining: remainingSlots,
        },
        sellerSubmissionStats: {
          used,
          remaining: remainingSlots,
        },
      },
      submissions: submissions.map(formatSellerSubmission),
    },
  });
});

const evaluateEligibility = async ({ product, promo, includePromoId }) => {
  const regularPrice = getProductRegularPrice(product);
  if (!regularPrice || regularPrice <= 0) {
    return { eligible: false, reason: 'Product price is invalid.' };
  }

  const stock = getProductAvailableStock(product);
  if (stock <= 0) {
    return { eligible: false, reason: 'Out of stock.' };
  }

  const eligibleCategoryIds = parseEligibleCategories(promo);
  if (eligibleCategoryIds.length > 0) {
    const parentCategory = String(product.parentCategory?._id || product.parentCategory || '');
    const subCategory = String(product.subCategory?._id || product.subCategory || '');
    const isAllowed =
      eligibleCategoryIds.includes(parentCategory) ||
      eligibleCategoryIds.includes(subCategory);
    if (!isAllowed) {
      return {
        eligible: false,
        reason: 'Not in eligible category.',
      };
    }
  }

  const conflict = await findOverlappingSubmission({
    productId: product._id,
    promo,
    excludePromoId: includePromoId,
    statuses: ['pending', 'approved'],
  });

  if (conflict) {
    return {
      eligible: false,
      reason: `Already in ${conflict?.promo?.name || 'another promo'}.`,
    };
  }

  return { eligible: true, reason: null };
};

exports.getSellerPromoEligibleProducts = catchAsync(async (req, res, next) => {
  await syncPromoStatuses();
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo) {
    return next(new AppError('Promo not found', 404));
  }
  if (!['scheduled', 'active'].includes(promo.status)) {
    return next(new AppError('Promo is not open for submissions', 409));
  }

  const includeIneligible =
    String(req.query.includeIneligible || '').toLowerCase() === 'true';
  const sellerId = req.user.id;
  const { page, limit } = parsePagination(req.query.page, req.query.limit);
  const search = String(req.query.search || '').trim();

  const productFilter = {
    seller: sellerId,
    isDeleted: { $ne: true },
  };
  if (search) {
    productFilter.name = toRegex(search);
  }

  const products = await Product.find(productFilter)
    .select(
      'name imageCover images price stock variants parentCategory subCategory',
    )
    .sort({ createdAt: -1 })
    .limit(300);

  const evaluatedRows = [];
  for (const product of products) {
    const eligibility = await evaluateEligibility({
      product,
      promo,
      includePromoId: promo._id,
    });
    if (!includeIneligible && !eligibility.eligible) continue;

    const regularPrice = getProductRegularPrice(product);
    const productPayload = product.toObject();
    evaluatedRows.push({
      _id: product._id,
      id: product._id,
      productId: product._id,
      product: productPayload,
      name: product.name,
      imageCover: product.imageCover,
      regularPrice,
      price: regularPrice,
      eligible: eligibility.eligible,
      isEligible: eligibility.eligible,
      reason: eligibility.reason,
      ineligibleReason: eligibility.reason,
    });
  }

  const total = evaluatedRows.length;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const start = (page - 1) * limit;
  const items = evaluatedRows.slice(start, start + limit);

  res.status(200).json({
    status: 'success',
    data: {
      eligibleProducts: items,
      items,
      total,
      page,
      totalPages,
      limit,
    },
  });
});

exports.submitSellerPromoProducts = catchAsync(async (req, res, next) => {
  await syncPromoStatuses();
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo) {
    return next(new AppError('Promo not found', 404));
  }
  if (!['scheduled', 'active'].includes(promo.status)) {
    return next(new AppError('Promo is not open for submissions', 409));
  }

  const rows = Array.isArray(req.body?.products) ? req.body.products : [];
  if (!rows.length) {
    return next(new AppError('At least one product submission is required', 400));
  }

  const sellerId = req.user.id;
  const maxProductsPerSeller = Number(promo.maxProductsPerSeller || 0);
  const existingActiveCount = await PromoProduct.countDocuments({
    promo: promo._id,
    seller: sellerId,
    status: { $in: ['pending', 'approved'] },
  });
  let remainingSlots =
    maxProductsPerSeller > 0
      ? Math.max(maxProductsPerSeller - existingActiveCount, 0)
      : 0;

  const productIds = rows
    .map((row) => row?.productId)
    .filter((id) => isObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const products = await Product.find({
    _id: { $in: productIds },
    seller: sellerId,
    isDeleted: { $ne: true },
  }).select('name imageCover price stock variants parentCategory subCategory');
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const errors = [];
  const created = [];

  for (const row of rows) {
    const productId = String(row?.productId || '');
    if (!isObjectId(productId)) {
      errors.push({ productId, message: 'Invalid product ID.' });
      continue;
    }

    const product = productById.get(productId);
    if (!product) {
      errors.push({ productId, message: 'Product not found for this seller.' });
      continue;
    }

    const existingSubmission = await PromoProduct.findOne({
      promo: promo._id,
      product: product._id,
      seller: sellerId,
    });

    if (
      existingSubmission &&
      ['pending', 'approved'].includes(existingSubmission.status)
    ) {
      errors.push({
        productId,
        message: 'Product is already submitted to this promo.',
      });
      continue;
    }

    if (!existingSubmission && maxProductsPerSeller > 0 && remainingSlots <= 0) {
      errors.push({
        productId,
        message: `Submission cap reached (${maxProductsPerSeller}).`,
      });
      continue;
    }

    const eligibility = await evaluateEligibility({
      product,
      promo,
      includePromoId: promo._id,
    });
    if (!eligibility.eligible) {
      errors.push({ productId, message: eligibility.reason });
      continue;
    }

    const discountType = String(row?.discountType || '').toLowerCase().trim();
    const discountValue = Number(row?.discountValue || 0);
    const stockForPromo =
      row?.stockForPromo === undefined || row?.stockForPromo === null || row?.stockForPromo === ''
        ? null
        : Number(row.stockForPromo);

    if (!DISCOUNT_TYPES.includes(discountType)) {
      errors.push({ productId, message: 'Discount type must be percentage or fixed.' });
      continue;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      errors.push({ productId, message: 'Discount value must be greater than 0.' });
      continue;
    }

    const regularPrice = getProductRegularPrice(product);
    if (!regularPrice || regularPrice <= 0) {
      errors.push({ productId, message: 'Product regular price is invalid.' });
      continue;
    }

    const effectivePercent = calculateEffectiveDiscountPercent({
      discountType,
      discountValue,
      regularPrice,
    });
    if (effectivePercent < Number(promo.minDiscountPercent || 0)) {
      errors.push({
        productId,
        message: `Discount must be at least ${promo.minDiscountPercent}%.`,
      });
      continue;
    }

    const payload = {
      promo: promo._id,
      seller: sellerId,
      product: product._id,
      discountType,
      discountValue,
      regularPrice,
      stockForPromo: Number.isFinite(stockForPromo) ? stockForPromo : null,
      status: 'pending',
      submittedAt: new Date(),
      rejectionReason: '',
      approvedAt: null,
      approvedBy: null,
    };

    let submission;
    if (existingSubmission) {
      Object.assign(existingSubmission, payload);
      submission = await existingSubmission.save();
    } else {
      submission = await PromoProduct.create(payload);
      if (maxProductsPerSeller > 0) {
        remainingSlots -= 1;
      }
      await Promo.updateOne(
        { _id: promo._id },
        { $inc: { 'analytics.submissionCount': 1 } },
      );
    }

    created.push({
      productId,
      submissionId: submission._id,
      status: submission.status,
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      created,
      errors,
      createdCount: created.length,
      errorCount: errors.length,
    },
  });
});

exports.getMyPromoSubmissions = catchAsync(async (req, res) => {
  await syncPromoStatuses();
  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
  const filter = {
    seller: req.user.id,
  };

  if (req.query.status && SUBMISSION_STATUS_FILTERS.includes(req.query.status)) {
    filter.status = req.query.status;
  }
  if (req.query.promoId && isObjectId(req.query.promoId)) {
    filter.promo = req.query.promoId;
  }

  const [submissions, total, pendingCount] = await Promise.all([
    PromoProduct.find(filter)
      .populate('promo', 'name slug type status startDate endDate')
      .populate('product', 'name imageCover price stock')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    PromoProduct.countDocuments(filter),
    PromoProduct.countDocuments({
      seller: req.user.id,
      status: 'pending',
    }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      submissions: submissions.map(formatSellerSubmission),
      items: submissions.map(formatSellerSubmission),
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      limit,
      pendingCount,
    },
  });
});

exports.withdrawSubmission = catchAsync(async (req, res, next) => {
  const { submissionId } = req.params;
  if (!isObjectId(submissionId)) {
    return next(new AppError('Invalid submission ID', 400));
  }

  const submission = await PromoProduct.findOne({
    _id: submissionId,
    seller: req.user.id,
  });
  if (!submission) {
    return next(new AppError('Submission not found', 404));
  }

  if (!['pending', 'approved'].includes(submission.status)) {
    return next(
      new AppError('Only pending or approved submissions can be withdrawn', 409),
    );
  }

  const wasApproved = submission.status === 'approved';
  submission.status = 'withdrawn';
  await submission.save();

  if (wasApproved) {
    await Promo.updateOne(
      {
        _id: submission.promo,
        'analytics.approvedCount': { $gt: 0 },
      },
      { $inc: { 'analytics.approvedCount': -1 } },
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      submission,
    },
  });
});

exports.updateSellerPromoSubmission = catchAsync(async (req, res, next) => {
  const { submissionId } = req.params;
  if (!isObjectId(submissionId)) {
    return next(new AppError('Invalid submission ID', 400));
  }

  const allowedFields = new Set(['discountType', 'discountValue', 'stockForPromo']);
  const payloadKeys = Object.keys(req.body || {});
  const unknownField = payloadKeys.find((field) => !allowedFields.has(field));
  if (unknownField) {
    return next(new AppError(`Field "${unknownField}" is not allowed.`, 400));
  }

  const submission = await PromoProduct.findOne({
    _id: submissionId,
    seller: req.user.id,
  });
  if (!submission) {
    return next(new AppError('Submission not found', 404));
  }

  const promo = await Promo.findById(submission.promo);
  if (!promo) {
    return next(new AppError('Promo not found', 404));
  }
  if (!['scheduled', 'active'].includes(promo.status)) {
    return next(new AppError('Promo is not open for submissions', 409));
  }

  const nowMs = Date.now();
  const promoStartMs = promo?.startDate ? new Date(promo.startDate).getTime() : null;
  const promoNotYetStarted =
    promo?.status === 'scheduled' &&
    Number.isFinite(promoStartMs) &&
    promoStartMs > nowMs;

  const isEditableStatus =
    submission.status === 'pending' ||
    (submission.status === 'approved' && promoNotYetStarted);

  if (!isEditableStatus) {
    if (submission.status === 'approved') {
      return next(
        new AppError(
          "Approved submissions can only be edited before the promo starts. Use 'Remove from promo' instead.",
          409,
        ),
      );
    }
    return next(
      new AppError('Only pending submissions can be edited.', 409),
    );
  }

  const product = await Product.findOne({
    _id: submission.product,
    seller: req.user.id,
    isDeleted: { $ne: true },
  }).select('name imageCover price stock variants parentCategory subCategory');
  if (!product) {
    return next(new AppError('Product not found for this seller.', 404));
  }

  const discountType = String(req.body?.discountType || '').toLowerCase().trim();
  const discountValue = Number(req.body?.discountValue || 0);
  const stockForPromo =
    req.body?.stockForPromo === undefined ||
    req.body?.stockForPromo === null ||
    req.body?.stockForPromo === ''
      ? null
      : Number(req.body.stockForPromo);

  if (!DISCOUNT_TYPES.includes(discountType)) {
    return next(
      new AppError('Discount type must be percentage or fixed.', 400),
    );
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return next(new AppError('Discount value must be greater than 0.', 400));
  }

  const regularPrice = getProductRegularPrice(product);
  if (!regularPrice || regularPrice <= 0) {
    return next(new AppError('Product regular price is invalid.', 400));
  }

  const eligibility = await evaluateEligibility({
    product,
    promo,
    includePromoId: promo._id,
  });
  if (!eligibility.eligible) {
    return next(new AppError(eligibility.reason, 409));
  }

  const effectivePercent = calculateEffectiveDiscountPercent({
    discountType,
    discountValue,
    regularPrice,
  });
  if (effectivePercent < Number(promo.minDiscountPercent || 0)) {
    return next(
      new AppError(`Discount must be at least ${promo.minDiscountPercent}%.`, 400),
    );
  }

  submission.discountType = discountType;
  submission.discountValue = discountValue;
  submission.stockForPromo = Number.isFinite(stockForPromo) ? stockForPromo : null;
  submission.regularPrice = regularPrice;

  const wasApprovedTransition =
    submission.status === 'approved' && promoNotYetStarted;
  await submission.save();

  if (wasApprovedTransition) {
    submission.status = 'pending';
    submission.approvedAt = null;
    submission.approvedBy = null;
    await submission.save();

    await Promo.updateOne(
      { _id: promo._id, 'analytics.approvedCount': { $gt: 0 } },
      { $inc: { 'analytics.approvedCount': -1 } },
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      submission,
    },
  });
});
