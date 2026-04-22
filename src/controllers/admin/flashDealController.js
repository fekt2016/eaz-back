const mongoose = require('mongoose');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const FlashDeal = require('../../models/product/dealsModel');
const FlashDealProduct = require('../../models/product/flashDealProductModel');
const { slugify } = require('../../utils/flashDealHelpers');
const logger = require('../../utils/logger');

const parseDate = (value, label) => {
  if (value === undefined || value === null || value === '') {
    throw new AppError(`${label} is required.`, 400);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`Invalid ${label}.`, 400);
  }
  return d;
};

const ensureUniqueSlug = async (baseSlug, excludeId) => {
  let slug = baseSlug;
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const q = { slug };
    if (excludeId) q._id = { $ne: excludeId };
    const exists = await FlashDeal.findOne(q).select('_id');
    if (!exists) return slug;
    n += 1;
    slug = `${baseSlug}-${n}`;
  }
};

const mapDeal = (doc, extra = {}) => {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
  return { ...o, ...extra };
};

exports.createFlashDeal = catchAsync(async (req, res) => {
  const {
    title,
    description,
    bannerImage,
    startTime: st,
    endTime: et,
    maxProducts = 50,
    discountRules,
  } = req.body || {};

  if (!title || !String(title).trim()) {
    throw new AppError('Title is required.', 400);
  }

  const startTime = parseDate(st, 'Start time');
  const endTime = parseDate(et, 'End time');
  const now = Date.now();

  if (endTime.getTime() <= startTime.getTime()) {
    throw new AppError('End time must be after start time.', 400);
  }

  if (startTime.getTime() <= now) {
    throw new AppError('Start time must be in the future.', 400);
  }

  const minDiscountPercent =
    discountRules?.minDiscountPercent != null
      ? Number(discountRules.minDiscountPercent)
      : 10;
  const maxDiscountPercent =
    discountRules?.maxDiscountPercent != null
      ? Number(discountRules.maxDiscountPercent)
      : 70;

  if (
    minDiscountPercent < 1 ||
    minDiscountPercent > 90 ||
    maxDiscountPercent < 1 ||
    maxDiscountPercent > 90 ||
    minDiscountPercent > maxDiscountPercent
  ) {
    throw new AppError('Invalid discount rule percentages.', 400);
  }

  const baseSlug = slugify(title);
  const slug = await ensureUniqueSlug(baseSlug);

  const status = 'scheduled';

  const adminId = req.user.id || req.user._id;

  const flashDeal = await FlashDeal.create({
    title: String(title).trim(),
    slug,
    description,
    bannerImage,
    startTime,
    endTime,
    status,
    maxProducts: Number(maxProducts) || 50,
    discountRules: {
      minDiscountPercent,
      maxDiscountPercent,
    },
    createdBy: adminId,
  });

  res.status(201).json({
    status: 'success',
    data: { flashDeal: mapDeal(flashDeal) },
  });
});

exports.getAllFlashDeals = catchAsync(async (req, res) => {
  const { status, startFrom, startTo } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (startFrom || startTo) {
    filter.startTime = {};
    if (startFrom) filter.startTime.$gte = new Date(startFrom);
    if (startTo) filter.startTime.$lte = new Date(startTo);
  }

  const deals = await FlashDeal.find(filter)
    .sort({ startTime: -1 })
    .populate('createdBy', 'name email');

  const ids = deals.map((d) => d._id);
  const [approvedAgg, pendingAgg] = await Promise.all([
    FlashDealProduct.aggregate([
      { $match: { flashDeal: { $in: ids }, status: 'approved' } },
      { $group: { _id: '$flashDeal', count: { $sum: 1 } } },
    ]),
    FlashDealProduct.aggregate([
      { $match: { flashDeal: { $in: ids }, status: 'pending' } },
      { $group: { _id: '$flashDeal', count: { $sum: 1 } } },
    ]),
  ]);

  const approvedMap = Object.fromEntries(
    approvedAgg.map((r) => [String(r._id), r.count]),
  );
  const pendingMap = Object.fromEntries(
    pendingAgg.map((r) => [String(r._id), r.count]),
  );

  const data = deals.map((d) => {
    const id = String(d._id);
    return mapDeal(d, {
      approvedProductCount: approvedMap[id] || 0,
      pendingSubmissionCount: pendingMap[id] || 0,
    });
  });

  res.status(200).json({
    status: 'success',
    data: { flashDeals: data },
  });
});

exports.getFlashDeal = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }

  const flashDeal = await FlashDeal.findById(req.params.id).populate(
    'createdBy',
    'name email',
  );

  if (!flashDeal) return next(new AppError('Flash deal not found.', 404));

  const approved = await FlashDealProduct.find({
    flashDeal: flashDeal._id,
    status: 'approved',
  })
    .populate({
      path: 'product',
      select: 'name images price status moderationStatus seller',
    })
    .populate({
      path: 'seller',
      select: 'shopName avatar businessName',
    });

  const approvedProductCount = approved.length;

  res.status(200).json({
    status: 'success',
    data: {
      flashDeal: mapDeal(flashDeal, { approvedProductCount }),
      approvedProducts: approved,
    },
  });
});

exports.updateFlashDeal = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }

  const flashDeal = await FlashDeal.findById(req.params.id);
  if (!flashDeal) return next(new AppError('Flash deal not found.', 404));

  if (flashDeal.status === 'ended') {
    throw new AppError('Cannot update a flash deal that has ended.', 400);
  }

  const {
    title,
    description,
    bannerImage,
    startTime: st,
    endTime: et,
    maxProducts,
    discountRules,
    status: bodyStatus,
  } = req.body || {};

  if (title != null) flashDeal.title = String(title).trim();
  if (description !== undefined) flashDeal.description = description;
  if (bannerImage !== undefined) flashDeal.bannerImage = bannerImage;
  if (maxProducts != null) flashDeal.maxProducts = Number(maxProducts) || 50;

  if (discountRules) {
    const minDiscountPercent =
      discountRules.minDiscountPercent != null
        ? Number(discountRules.minDiscountPercent)
        : flashDeal.discountRules.minDiscountPercent;
    const maxDiscountPercent =
      discountRules.maxDiscountPercent != null
        ? Number(discountRules.maxDiscountPercent)
        : flashDeal.discountRules.maxDiscountPercent;
    if (
      minDiscountPercent < 1 ||
      minDiscountPercent > 90 ||
      maxDiscountPercent < 1 ||
      maxDiscountPercent > 90 ||
      minDiscountPercent > maxDiscountPercent
    ) {
      throw new AppError('Invalid discount rule percentages.', 400);
    }
    flashDeal.discountRules = {
      minDiscountPercent,
      maxDiscountPercent,
    };
  }

  if (st != null || et != null) {
    const startTime = st != null ? parseDate(st, 'Start time') : flashDeal.startTime;
    const endTime = et != null ? parseDate(et, 'End time') : flashDeal.endTime;
    if (endTime.getTime() <= startTime.getTime()) {
      throw new AppError('End time must be after start time.', 400);
    }
    flashDeal.startTime = startTime;
    flashDeal.endTime = endTime;
  }

  if (title && String(title).trim()) {
    const baseSlug = slugify(title);
    flashDeal.slug = await ensureUniqueSlug(baseSlug, flashDeal._id);
  }

  if (bodyStatus && ['draft', 'scheduled', 'cancelled'].includes(bodyStatus)) {
    flashDeal.status = bodyStatus;
  }

  await flashDeal.save();

  res.status(200).json({
    status: 'success',
    data: { flashDeal: mapDeal(flashDeal) },
  });
});

exports.deleteFlashDeal = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }

  const flashDeal = await FlashDeal.findById(req.params.id);
  if (!flashDeal) return next(new AppError('Flash deal not found.', 404));

  if (!['draft', 'cancelled'].includes(flashDeal.status)) {
    throw new AppError('Only draft or cancelled flash deals can be deleted.', 400);
  }

  await FlashDealProduct.deleteMany({ flashDeal: flashDeal._id });
  await flashDeal.deleteOne();

  res.status(204).send();
});

exports.cancelFlashDeal = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }

  const flashDeal = await FlashDeal.findById(req.params.id);
  if (!flashDeal) return next(new AppError('Flash deal not found.', 404));

  flashDeal.status = 'cancelled';
  await flashDeal.save();

  res.status(200).json({
    status: 'success',
    data: { flashDeal: mapDeal(flashDeal) },
  });
});

exports.getSubmissions = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }

  const deal = await FlashDeal.findById(req.params.id).select('_id');
  if (!deal) return next(new AppError('Flash deal not found.', 404));

  const { status } = req.query;
  const filter = { flashDeal: deal._id };
  if (status) filter.status = status;

  const submissions = await FlashDealProduct.find(filter)
    .sort({ submittedAt: -1 })
    .populate({
      path: 'product',
      select: 'name images price status moderationStatus seller',
    })
    .populate({
      path: 'seller',
      select: 'shopName avatar businessName email',
    });

  res.status(200).json({
    status: 'success',
    data: { submissions },
  });
});

exports.reviewSubmission = catchAsync(async (req, res, next) => {
  const { submissionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(submissionId)) {
    return next(new AppError('Invalid submission id.', 400));
  }

  const { status, rejectionReason } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    throw new AppError('Status must be approved or rejected.', 400);
  }
  if (status === 'rejected' && (!rejectionReason || !String(rejectionReason).trim())) {
    throw new AppError('Rejection reason is required when rejecting.', 400);
  }

  const submission = await FlashDealProduct.findById(submissionId).populate(
    'flashDeal',
  );
  if (!submission) return next(new AppError('Submission not found.', 404));

  if (status === 'approved') {
    const deal = submission.flashDeal;
    const approvedCount = await FlashDealProduct.countDocuments({
      flashDeal: deal._id,
      status: 'approved',
      _id: { $ne: submission._id },
    });
    if (approvedCount >= (deal.maxProducts || 50)) {
      throw new AppError('Maximum approved products for this deal has been reached.', 400);
    }
  }

  submission.status = status;
  submission.reviewedBy = req.user.id || req.user._id;
  submission.reviewedAt = new Date();
  submission.rejectionReason =
    status === 'rejected' ? String(rejectionReason).trim() : undefined;

  try {
    await submission.save();
  } catch (e) {
    logger.warn('[flashDeal] reviewSubmission save failed', { message: e.message });
    throw new AppError(e.message || 'Could not update submission.', 400);
  }

  const populated = await FlashDealProduct.findById(submission._id)
    .populate({
      path: 'product',
      select: 'name images price status moderationStatus seller',
    })
    .populate({
      path: 'seller',
      select: 'shopName avatar businessName',
    });

  res.status(200).json({
    status: 'success',
    data: { submission: populated },
  });
});

exports.uploadBanner = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid flash deal id.', 400));
  }

  const flashDeal = await FlashDeal.findById(req.params.id);
  if (!flashDeal) return next(new AppError('Flash deal not found.', 404));

  const uploads = req.cloudinaryUploads || {};
  const imageMeta = uploads.banner || uploads.image;
  const bannerImage = imageMeta?.url || req.body?.bannerImage;

  if (!bannerImage) {
    throw new AppError('Banner image upload failed.', 400);
  }

  flashDeal.bannerImage = bannerImage;
  await flashDeal.save();

  res.status(200).json({
    status: 'success',
    data: { flashDeal: mapDeal(flashDeal) },
  });
});
