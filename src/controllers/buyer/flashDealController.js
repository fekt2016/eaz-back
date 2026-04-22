const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const FlashDeal = require('../../models/product/dealsModel');
const FlashDealProduct = require('../../models/product/flashDealProductModel');
const { effectiveDiscountPercent } = require('../../utils/flashDealHelpers');

const productSelect =
  'name images price promoPrice slug status seller variants description';

const sortSubmissions = (items, sortKey) => {
  const arr = [...items];
  const key = sortKey || 'discount-high';

  const discountPct = (sub) => {
    const o = Number(sub.originalPrice) || 0;
    const f = Number(sub.flashPrice) || 0;
    if (o <= 0) return 0;
    return ((o - f) / o) * 100;
  };

  if (key === 'price-low') {
    arr.sort((a, b) => Number(a.flashPrice) - Number(b.flashPrice));
  } else if (key === 'price-high') {
    arr.sort((a, b) => Number(b.flashPrice) - Number(a.flashPrice));
  } else if (key === 'newest') {
    arr.sort(
      (a, b) =>
        new Date(b.submittedAt || b.createdAt).getTime() -
        new Date(a.submittedAt || a.createdAt).getTime(),
    );
  } else {
    arr.sort((a, b) => discountPct(b) - discountPct(a));
  }
  return arr;
};

exports.getActiveFlashDeals = catchAsync(async (req, res) => {
  const now = new Date();

  const deals = await FlashDeal.find({
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gt: now },
  }).sort({ endTime: 1 });

  const dealIds = deals.map((d) => d._id);

  const submissions = await FlashDealProduct.find({
    flashDeal: { $in: dealIds },
    status: 'approved',
  })
    .populate({
      path: 'product',
      match: { status: 'active', isDeleted: { $ne: true } },
      select: productSelect,
    })
    .populate({
      path: 'seller',
      select: 'shopName businessName avatar',
    });

  const byDeal = {};
  dealIds.forEach((id) => {
    byDeal[String(id)] = [];
  });

  submissions.forEach((sub) => {
    if (!sub.product) return;
    const list = byDeal[String(sub.flashDeal)];
    if (!list) return;
    const o = sub.toObject({ virtuals: true });
    o.discountPercentEffective = effectiveDiscountPercent(
      o.originalPrice,
      o.flashPrice,
    );
    list.push(o);
  });

  Object.keys(byDeal).forEach((k) => {
    byDeal[k] = sortSubmissions(byDeal[k], 'discount-high');
  });

  const payload = deals.map((d) => {
    const id = String(d._id);
    const products = byDeal[id] || [];
    return {
      ...(d.toObject({ virtuals: true })),
      products,
      approvedProductCount: products.length,
    };
  });

  res.status(200).json({
    status: 'success',
    data: { flashDeals: payload },
  });
});

exports.getFlashDealProducts = catchAsync(async (req, res, next) => {
  const { slug } = req.params;
  if (!slug || typeof slug !== 'string') {
    return next(new AppError('Invalid slug.', 400));
  }

  const now = new Date();
  const flashDeal = await FlashDeal.findOne({
    slug: String(slug).trim(),
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gt: now },
  });

  if (!flashDeal) {
    return next(new AppError('Flash deal not found or not active.', 404));
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const sort = req.query.sort || 'discount-high';

  const all = await FlashDealProduct.find({
    flashDeal: flashDeal._id,
    status: 'approved',
  })
    .populate({
      path: 'product',
      match: { status: 'active', isDeleted: { $ne: true } },
      select: productSelect,
    })
    .populate({
      path: 'seller',
      select: 'shopName businessName avatar',
    });

  const filtered = all.filter((s) => s.product);
  const sorted = sortSubmissions(filtered, sort);
  const total = sorted.length;
  const start = (page - 1) * limit;
  const slice = sorted.slice(start, start + limit).map((sub) => {
    const o = sub.toObject({ virtuals: true });
    o.discountPercentEffective = effectiveDiscountPercent(
      o.originalPrice,
      o.flashPrice,
    );
    return o;
  });

  res.status(200).json({
    status: 'success',
    data: {
      flashDeal: flashDeal.toObject({ virtuals: true }),
      products: slice,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
});
