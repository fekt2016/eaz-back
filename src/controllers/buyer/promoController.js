const Promo = require('../../models/promo/promoModel');
const PromoProduct = require('../../models/promo/promoProductModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const {
  parsePagination,
  syncPromoStatuses,
  findPromoByIdentifier,
} = require('../../services/promo/promoService');

const toRegex = (value) => new RegExp(String(value || '').trim(), 'i');

const isPromoPubliclyVisible = (promo) =>
  promo && ['active', 'scheduled'].includes(String(promo.status || ''));

const addSubmissionCounts = async (promos) => {
  if (!promos.length) return {};
  const promoIds = promos.map((promo) => promo._id);
  const rows = await PromoProduct.aggregate([
    {
      $match: {
        promo: { $in: promoIds },
        status: 'approved',
      },
    },
    {
      $group: {
        _id: '$promo',
        approvedCount: { $sum: 1 },
      },
    },
  ]);
  return rows.reduce((acc, row) => {
    acc[String(row._id)] = Number(row.approvedCount || 0);
    return acc;
  }, {});
};

exports.getPublicPromos = catchAsync(async (req, res) => {
  await syncPromoStatuses();
  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
  const now = new Date();

  const filter = {
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  if (req.query.type) {
    filter.type = req.query.type;
  }
  if (req.query.search) {
    const regex = toRegex(req.query.search);
    filter.$or = [{ name: regex }, { slug: regex }, { description: regex }];
  }
  if (String(req.query.showOnHomepage || '').toLowerCase() === 'true') {
    filter.showOnHomepage = true;
  }

  const [promos, total] = await Promise.all([
    Promo.find(filter)
      .sort({ featuredSlot: 1, startDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Promo.countDocuments(filter),
  ]);

  const countsByPromo = await addSubmissionCounts(promos);
  const payload = promos.map((promo) => {
    const plain = promo.toObject();
    const approvedCount = countsByPromo[String(promo._id)] || 0;
    return {
      ...plain,
      approvedProductCount: approvedCount,
      analytics: {
        ...(plain.analytics || {}),
        approvedCount:
          plain?.analytics?.approvedCount == null
            ? approvedCount
            : plain.analytics.approvedCount,
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

exports.getPublicPromoById = catchAsync(async (req, res, next) => {
  await syncPromoStatuses();
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo || !isPromoPubliclyVisible(promo)) {
    return next(new AppError('Promo not found', 404));
  }

  const approvedCount = await PromoProduct.countDocuments({
    promo: promo._id,
    status: 'approved',
  });

  res.status(200).json({
    status: 'success',
    data: {
      promo: {
        ...promo.toObject(),
        approvedProductCount: approvedCount,
      },
    },
  });
});

exports.getPublicPromoProducts = catchAsync(async (req, res, next) => {
  await syncPromoStatuses();
  const promo = await findPromoByIdentifier(req.params.id);
  if (!promo || !isPromoPubliclyVisible(promo)) {
    return next(new AppError('Promo not found', 404));
  }

  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);

  const [submissions, total] = await Promise.all([
    PromoProduct.find({
      promo: promo._id,
      status: 'approved',
    })
      .populate({
        path: 'product',
        select:
          'name slug imageCover images price defaultPrice minPrice maxPrice promoPrice originalPrice ratingsAverage totalSold totalViews moderationStatus isDeleted seller',
        match: {
          moderationStatus: 'approved',
          isDeleted: { $ne: true },
        },
      })
      .sort({ approvedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    PromoProduct.countDocuments({
      promo: promo._id,
      status: 'approved',
    }),
  ]);

  const products = submissions
    .filter((row) => row.product)
    .map((row) => {
      const product = row.product.toObject
        ? row.product.toObject()
        : row.product;
      const regularPrice = Number(row.regularPrice || product.price || 0);
      const promoPrice = Number(row.promoPrice || 0);
      return {
        ...product,
        promoPrice: promoPrice > 0 ? promoPrice : product.promoPrice,
        originalPrice:
          regularPrice > 0 ? regularPrice : product.originalPrice || product.price,
        promoSubmission: {
          _id: row._id,
          discountType: row.discountType,
          discountValue: row.discountValue,
          status: row.status,
        },
      };
    });

  res.status(200).json({
    status: 'success',
    data: {
      promo: promo.toObject(),
      products,
      items: products,
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      limit,
    },
  });
});
