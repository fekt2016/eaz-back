const mongoose = require('mongoose');
const Promo = require('../../models/promo/promoModel');
const PromoProduct = require('../../models/promo/promoProductModel');

const ACTIVE_PROMO_STATUSES = ['scheduled', 'active'];
const BLOCKING_SUBMISSION_STATUSES = ['pending', 'approved'];

const parsePagination = (pageInput, limitInput) => {
  const page = Math.max(Number(pageInput) || 1, 1);
  const limit = Math.min(Math.max(Number(limitInput) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toObjectId = (value) => {
  if (!isObjectId(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const hasDateOverlap = (rangeA, rangeB) => {
  const aStart = new Date(rangeA.startDate).getTime();
  const aEnd = new Date(rangeA.endDate).getTime();
  const bStart = new Date(rangeB.startDate).getTime();
  const bEnd = new Date(rangeB.endDate).getTime();

  if (
    Number.isNaN(aStart) ||
    Number.isNaN(aEnd) ||
    Number.isNaN(bStart) ||
    Number.isNaN(bEnd)
  ) {
    return false;
  }
  return aStart <= bEnd && bStart <= aEnd;
};

const getProductRegularPrice = (product) => {
  const directPrice = Number(product?.price);
  if (Number.isFinite(directPrice) && directPrice > 0) return directPrice;

  const fallback = Number(product?.defaultPrice);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
};

const getProductAvailableStock = (product) => {
  if (!product) return 0;

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.reduce((sum, variant) => {
      const variantStock = Number(variant?.stock || 0);
      const sold = Number(variant?.sold || 0);
      return sum + Math.max(variantStock - sold, 0);
    }, 0);
  }

  const stock = Number(product.stock || 0);
  const sold = Number(product.sold || 0);
  return Math.max(stock - sold, 0);
};

const calculateEffectiveDiscountPercent = ({
  discountType,
  discountValue,
  regularPrice,
}) => {
  const safeRegularPrice = Number(regularPrice || 0);
  const safeDiscountValue = Number(discountValue || 0);
  if (safeRegularPrice <= 0 || safeDiscountValue <= 0) return 0;

  if (discountType === 'fixed') {
    return (safeDiscountValue / safeRegularPrice) * 100;
  }
  return safeDiscountValue;
};

const resolvePromoIdentifierFilter = (identifier) => {
  if (isObjectId(identifier)) {
    return { _id: toObjectId(identifier) };
  }
  return { slug: String(identifier || '').toLowerCase().trim() };
};

const syncPromoStatuses = async () => {
  const now = new Date();

  const draftToActive = await Promo.updateMany(
    {
      status: 'draft',
      startDate: { $lte: now },
      endDate: { $gt: now },
    },
    { $set: { status: 'active' } },
  );

  const draftToScheduled = await Promo.updateMany(
    {
      status: 'draft',
      startDate: { $gt: now },
    },
    { $set: { status: 'scheduled' } },
  );

  const draftToEnded = await Promo.updateMany(
    {
      status: 'draft',
      endDate: { $lte: now },
    },
    { $set: { status: 'ended' } },
  );

  const scheduledToActive = await Promo.updateMany(
    {
      status: 'scheduled',
      startDate: { $lte: now },
      endDate: { $gt: now },
    },
    { $set: { status: 'active' } },
  );

  const activeToEnded = await Promo.updateMany(
    {
      status: 'active',
      endDate: { $lte: now },
    },
    { $set: { status: 'ended' } },
  );

  const staleScheduledToEnded = await Promo.updateMany(
    {
      status: 'scheduled',
      endDate: { $lte: now },
    },
    { $set: { status: 'ended' } },
  );

  return {
    draftToActive: draftToActive.modifiedCount || 0,
    draftToScheduled: draftToScheduled.modifiedCount || 0,
    draftToEnded: draftToEnded.modifiedCount || 0,
    scheduledToActive: scheduledToActive.modifiedCount || 0,
    activeToEnded: activeToEnded.modifiedCount || 0,
    staleScheduledToEnded: staleScheduledToEnded.modifiedCount || 0,
  };
};

const findPromoByIdentifier = async (identifier) => {
  const filter = resolvePromoIdentifierFilter(identifier);
  return Promo.findOne(filter);
};

const findOverlappingSubmission = async ({
  productId,
  promo,
  excludePromoId = null,
  statuses = BLOCKING_SUBMISSION_STATUSES,
}) => {
  const submissions = await PromoProduct.find({
    product: productId,
    status: { $in: statuses },
  }).populate('promo', 'name status startDate endDate');

  for (const submission of submissions) {
    const candidatePromo = submission?.promo;
    if (!candidatePromo) continue;
    if (!ACTIVE_PROMO_STATUSES.includes(candidatePromo.status)) continue;

    if (
      excludePromoId &&
      String(candidatePromo._id) === String(excludePromoId)
    ) {
      continue;
    }

    if (
      hasDateOverlap(
        { startDate: promo.startDate, endDate: promo.endDate },
        {
          startDate: candidatePromo.startDate,
          endDate: candidatePromo.endDate,
        },
      )
    ) {
      return submission;
    }
  }
  return null;
};

const getActiveApprovedPromoSubmissionForProduct = async ({
  productId,
  sellerId = null,
}) => {
  const query = {
    product: productId,
    status: 'approved',
  };
  if (sellerId) query.seller = sellerId;

  const submissions = await PromoProduct.find(query).populate(
    'promo',
    'name status startDate endDate',
  );
  const now = new Date();

  for (const submission of submissions) {
    const promo = submission?.promo;
    if (!promo) continue;
    if (promo.status !== 'active') continue;

    const start = new Date(promo.startDate).getTime();
    const end = new Date(promo.endDate).getTime();
    const current = now.getTime();

    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (current >= start && current <= end) {
      return submission;
    }
  }

  return null;
};

/**
 * Resolve per-unit promo discount for checkout / order creation.
 *
 * @returns {Promise<{
 *   promoDiscount: number,
 *   promoSubmission: object | null,
 *   promoProductId: object | null,
 * }>}
 *   `promoProductId` is the PromoProduct submission `_id` when a promo price applies; otherwise `null`.
 *   Same submission as `promoSubmission` when present — additive alias for callers that only need the id.
 */
const resolveOrderItemPromoDiscount = async ({
  productId,
  sellerId = null,
  basePriceInclVat,
  taxService,
  platformSettings,
}) => {
  const submission = await getActiveApprovedPromoSubmissionForProduct({
    productId,
    sellerId,
  });
  if (!submission) {
    return { promoDiscount: 0, promoSubmission: null, promoProductId: null };
  }

  const promoBasePrice = Number(submission.promoPrice || 0);
  if (!Number.isFinite(promoBasePrice) || promoBasePrice <= 0) {
    return { promoDiscount: 0, promoSubmission: null, promoProductId: null };
  }

  const promoVatComputed = await taxService.addVatToBase(
    promoBasePrice,
    platformSettings,
  );
  const promoInclVat = Number(promoVatComputed?.priceInclVat || 0);
  const standardInclVat = Number(basePriceInclVat || 0);

  if (
    !Number.isFinite(promoInclVat) ||
    !Number.isFinite(standardInclVat) ||
    promoInclVat >= standardInclVat
  ) {
    return { promoDiscount: 0, promoSubmission: null, promoProductId: null };
  }

  return {
    promoDiscount: Math.max(0, standardInclVat - promoInclVat),
    promoSubmission: submission,
    promoProductId: submission._id,
  };
};

module.exports = {
  ACTIVE_PROMO_STATUSES,
  BLOCKING_SUBMISSION_STATUSES,
  parsePagination,
  isObjectId,
  toObjectId,
  hasDateOverlap,
  getProductRegularPrice,
  getProductAvailableStock,
  calculateEffectiveDiscountPercent,
  resolvePromoIdentifierFilter,
  syncPromoStatuses,
  findPromoByIdentifier,
  findOverlappingSubmission,
  getActiveApprovedPromoSubmissionForProduct,
  resolveOrderItemPromoDiscount,
};
