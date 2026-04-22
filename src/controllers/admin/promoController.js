const slugify = require('slugify');
const mongoose = require('mongoose');
const multer = require('multer');
const Promo = require('../../models/promo/promoModel');
const PromoProduct = require('../../models/promo/promoProductModel');
const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const {
  parsePagination,
  syncPromoStatuses,
  findPromoByIdentifier,
  findOverlappingSubmission,
  isObjectId,
} = require('../../services/promo/promoService');

const ALLOWED_UPDATE_STATUSES = ['draft', 'scheduled'];
const ALLOWED_REVIEW_ACTIONS = ['approve', 'reject'];
const ALLOWED_REVIEW_STATUSES = ['approved', 'rejected'];

const toRegex = (value) => new RegExp(String(value || '').trim(), 'i');

const normalizeSlug = (slug, fallbackName = '') => {
  const raw = String(slug || fallbackName || '').trim();
  return slugify(raw, { lower: true, strict: true, trim: true });
};

const derivePromoStatusFromDates = (startDate, endDate) => {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'draft';
  }

  if (end <= now) return 'ended';
  if (start <= now && end > now) return 'active';
  return 'scheduled';
};

const parseEligibleCategories = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => mongoose.Types.ObjectId.isValid(item));
};

const formatPromo = (promo, countsByPromoId = {}) => {
  const plain = typeof promo.toObject === 'function' ? promo.toObject() : promo;
  const countInfo = countsByPromoId[String(plain._id)] || {
    total: 0,
    approved: 0,
  };

  return {
    ...plain,
    submissionCount: countInfo.total,
    approvedCount: countInfo.approved,
    analytics: {
      ...(plain.analytics || {}),
      submissionCount:
        plain?.analytics?.submissionCount ?? countInfo.total ?? 0,
      approvedCount: plain?.analytics?.approvedCount ?? countInfo.approved ?? 0,
    },
  };
};

const buildCountsByPromoId = async (promoIds) => {
  if (!promoIds.length) return {};
  const rows = await PromoProduct.aggregate([
    {
      $match: {
        promo: { $in: promoIds },
      },
    },
    {
      $group: {
        _id: '$promo',
        total: { $sum: 1 },
        approved: {
          $sum: {
            $cond: [{ $eq: ['$status', 'approved'] }, 1, 0],
          },
        },
      },
    },
  ]);

  return rows.reduce((acc, row) => {
    acc[String(row._id)] = {
      total: Number(row.total || 0),
      approved: Number(row.approved || 0),
    };
    return acc;
  }, {});
};

exports.getPromos = catchAsync(async (req, res) => {
  await syncPromoStatuses();

  const { status, type, search } = req.query;
  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
  const filter = {};

  if (status) filter.status = status;
  if (type) filter.type = type;
  if (search) {
    const regex = toRegex(search);
    filter.$or = [{ name: regex }, { slug: regex }, { description: regex }];
  }

  const [promos, total] = await Promise.all([
    Promo.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Promo.countDocuments(filter),
  ]);

  const promoIds = promos.map((promo) => promo._id);
  const countsByPromoId = await buildCountsByPromoId(promoIds);

  res.status(200).json({
    status: 'success',
    data: {
      promos: promos.map((promo) => formatPromo(promo, countsByPromoId)),
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      limit,
    },
  });
});

exports.createPromo = catchAsync(async (req, res, next) => {
  const payload = { ...req.body };
  payload.createdBy = req.user.id;
  payload.slug = normalizeSlug(payload.slug, payload.name);
  payload.eligibleCategories = parseEligibleCategories(payload.eligibleCategories);
  if (!payload.status) {
    payload.status = derivePromoStatusFromDates(payload.startDate, payload.endDate);
  }

  if (!payload.slug) {
    return next(new AppError('Promo slug is required', 400));
  }

  const existing = await Promo.findOne({ slug: payload.slug });
  if (existing) {
    return next(new AppError('Promo slug already exists', 409));
  }

  const promo = await Promo.create(payload);

  res.status(201).json({
    status: 'success',
    data: {
      promo,
    },
  });
});

exports.getPromoById = catchAsync(async (req, res, next) => {
  await syncPromoStatuses();
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo) {
    return next(new AppError('Promo not found', 404));
  }

  const countsByPromoId = await buildCountsByPromoId([promo._id]);
  const formattedPromo = formatPromo(promo, countsByPromoId);

  res.status(200).json({
    status: 'success',
    data: {
      promo: formattedPromo,
      counts: {
        submissions: formattedPromo.submissionCount || 0,
        approved: formattedPromo.approvedCount || 0,
      },
    },
  });
});

exports.updatePromo = catchAsync(async (req, res, next) => {
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo) {
    return next(new AppError('Promo not found', 404));
  }

  if (!ALLOWED_UPDATE_STATUSES.includes(promo.status)) {
    return next(
      new AppError(
        'Only draft or scheduled promos can be updated',
        409,
      ),
    );
  }

  const updates = { ...req.body };
  if (Object.prototype.hasOwnProperty.call(updates, 'slug')) {
    updates.slug = normalizeSlug(updates.slug, promo.name);
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, 'name') &&
    !Object.prototype.hasOwnProperty.call(updates, 'slug')
  ) {
    updates.slug = normalizeSlug(undefined, updates.name);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'eligibleCategories')) {
    updates.eligibleCategories = parseEligibleCategories(updates.eligibleCategories);
  }

  if (updates.slug && updates.slug !== promo.slug) {
    const existing = await Promo.findOne({ slug: updates.slug, _id: { $ne: promo._id } });
    if (existing) {
      return next(new AppError('Promo slug already exists', 409));
    }
  }

  Object.assign(promo, updates);
  await promo.save();

  res.status(200).json({
    status: 'success',
    data: {
      promo,
    },
  });
});

exports.cancelPromo = catchAsync(async (req, res, next) => {
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo) {
    return next(new AppError('Promo not found', 404));
  }

  if (promo.status === 'cancelled') {
    return res.status(200).json({
      status: 'success',
      data: {
        promo,
        rejectedPendingSubmissions: 0,
      },
    });
  }

  promo.status = 'cancelled';
  await promo.save();

  const rejectResult = await PromoProduct.updateMany(
    { promo: promo._id, status: 'pending' },
    {
      $set: {
        status: 'rejected',
        rejectionReason: 'Promo cancelled by admin',
      },
    },
  );

  res.status(200).json({
    status: 'success',
    data: {
      promo,
      rejectedPendingSubmissions: rejectResult.modifiedCount || 0,
    },
  });
});

exports.getPromoSubmissions = catchAsync(async (req, res) => {
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo) {
    throw new AppError('Promo not found', 404);
  }

  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
  const filter = { promo: promo._id };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.seller && isObjectId(req.query.seller)) {
    filter.seller = req.query.seller;
  }

  if (req.query.search) {
    const regex = toRegex(req.query.search);
    const [productIds, sellerIds] = await Promise.all([
      Product.find({ name: regex }).select('_id').limit(100),
      Seller.find({ $or: [{ shopName: regex }, { name: regex }] })
        .select('_id')
        .limit(100),
    ]);
    filter.$or = [
      { product: { $in: productIds.map((row) => row._id) } },
      { seller: { $in: sellerIds.map((row) => row._id) } },
    ];
  }

  const [submissions, total] = await Promise.all([
    PromoProduct.find(filter)
      .populate('product', 'name imageCover price stock parentCategory subCategory')
      .populate('seller', 'name shopName businessName email avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    PromoProduct.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      submissions,
      items: submissions,
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      limit,
    },
  });
});

exports.reviewPromoSubmission = catchAsync(async (req, res, next) => {
  const { submissionId } = req.params;
  if (!isObjectId(submissionId)) {
    return next(new AppError('Invalid submission ID', 400));
  }

  const submission = await PromoProduct.findById(submissionId).populate(
    'promo',
    'name status startDate endDate analytics',
  );
  if (!submission) {
    return next(new AppError('Submission not found', 404));
  }

  const action = String(
    req.body.action ||
      req.body.status ||
      '',
  )
    .toLowerCase()
    .trim();

  if (!ALLOWED_REVIEW_ACTIONS.includes(action) && !ALLOWED_REVIEW_STATUSES.includes(action)) {
    return next(new AppError('Action must be approve or reject', 400));
  }

  const normalizedAction = action === 'approved' ? 'approve' : action === 'rejected' ? 'reject' : action;

  if (normalizedAction === 'reject') {
    const rejectionReason = String(req.body.rejectionReason || '').trim();
    if (!rejectionReason) {
      return next(new AppError('Rejection reason is required', 400));
    }

    submission.status = 'rejected';
    submission.rejectionReason = rejectionReason;
    submission.approvedAt = null;
    submission.approvedBy = null;
    await submission.save();

    return res.status(200).json({
      status: 'success',
      data: {
        submission,
      },
    });
  }

  if (submission.status !== 'pending') {
    return next(new AppError('Only pending submissions can be approved', 409));
  }

  const conflict = await findOverlappingSubmission({
    productId: submission.product,
    promo: submission.promo,
    excludePromoId: submission.promo._id,
    statuses: ['pending', 'approved'],
  });

  if (conflict) {
    return next(
      new AppError(
        `Product already has an overlapping promo submission in "${
          conflict?.promo?.name || 'another promo'
        }"`,
        409,
      ),
    );
  }

  submission.status = 'approved';
  submission.rejectionReason = '';
  submission.approvedAt = new Date();
  submission.approvedBy = req.user.id;
  await submission.save();

  await Promo.updateOne(
    { _id: submission.promo._id },
    { $inc: { 'analytics.approvedCount': 1 } },
  );

  res.status(200).json({
    status: 'success',
    data: {
      submission,
    },
  });
});

exports.checkSlugAvailability = catchAsync(async (req, res) => {
  const slug = normalizeSlug(req.query.slug);
  if (!slug) {
    return res.status(200).json({
      status: 'success',
      data: { available: false },
    });
  }

  const existing = await Promo.exists({ slug });
  res.status(200).json({
    status: 'success',
    data: {
      available: !Boolean(existing),
    },
  });
});

const extractCloudinaryPublicIdFromUrl = (url) => {
  if (!url) return '';
  try {
    const parts = String(url).split('/');
    const uploadIndex = parts.findIndex((part) => part === 'upload');
    if (uploadIndex < 0) return '';
    const afterUpload = parts.slice(uploadIndex + 1);
    const versionIndex = afterUpload.findIndex((part) => /^v\d+$/.test(part));
    const publicParts = versionIndex >= 0 ? afterUpload.slice(versionIndex + 1) : afterUpload;
    return publicParts.join('/').replace(/\.[^.]+$/, '');
  } catch {
    return '';
  }
};

exports.upload = multer({ storage: multer.memoryStorage() });

exports.uploadPromoBanner = catchAsync(async (req, res, next) => {
  const bannerUrl = req.body?.banner || req.body?.image || '';
  if (!bannerUrl) {
    return next(new AppError('Banner upload failed', 400));
  }

  const publicId =
    req.body?.public_id || extractCloudinaryPublicIdFromUrl(bannerUrl);

  res.status(201).json({
    status: 'success',
    data: {
      banner: {
        url: bannerUrl,
        public_id: publicId || '',
      },
      url: bannerUrl,
      public_id: publicId || '',
    },
  });
});
