const Discount = require('../../models/product/discountModel');
const FlashDealProduct = require('../../models/product/flashDealProductModel');

const normalizePromotionKey = (value) =>
  value == null ? '' : String(value).trim().toLowerCase();

const toDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const rangesOverlap = (startA, endA, startB, endB) =>
  startA <= endB && startB <= endA;

const discountAppliesToProduct = (discount, product) => {
  const productId = String(product._id);
  const productParentCategory = product.parentCategory
    ? String(product.parentCategory)
    : '';
  const productSubCategory = product.subCategory ? String(product.subCategory) : '';
  const productPromotionKey = normalizePromotionKey(product.promotionKey);

  const discountProductIds = Array.isArray(discount.products)
    ? discount.products.map((id) => String(id))
    : [];
  const discountCategoryIds = Array.isArray(discount.categories)
    ? discount.categories.map((id) => String(id))
    : [];
  const discountPromotionKey = normalizePromotionKey(discount.promotionKey);

  if (discountProductIds.includes(productId)) return true;

  if (
    discountCategoryIds.length > 0 &&
    (discountCategoryIds.includes(productParentCategory) ||
      discountCategoryIds.includes(productSubCategory))
  ) {
    return true;
  }

  if (discountPromotionKey && productPromotionKey) {
    return discountPromotionKey === productPromotionKey;
  }

  // Store-wide discount (explicitly no products/categories/promotionKey).
  if (
    discountProductIds.length === 0 &&
    discountCategoryIds.length === 0 &&
    !discountPromotionKey
  ) {
    return true;
  }

  return false;
};

const findConflictingDiscounts = async ({
  sellerId,
  products,
  startDate,
  endDate,
  excludeDiscountId,
}) => {
  if (!Array.isArray(products) || products.length === 0) return [];

  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) return [];

  const query = {
    seller: sellerId,
    active: true,
    endDate: { $gte: start },
    startDate: { $lte: end },
  };

  if (excludeDiscountId) {
    query._id = { $ne: excludeDiscountId };
  }

  const discounts = await Discount.find(query).select(
    '_id name code startDate endDate products categories promotionKey',
  );

  const conflicts = [];
  for (const product of products) {
    const conflict = discounts.find((discount) =>
      discountAppliesToProduct(discount, product),
    );

    if (conflict) {
      conflicts.push({
        productId: String(product._id),
        productName: product.name || 'Product',
        discountId: String(conflict._id),
        discountName: conflict.name || conflict.code || 'Discount',
      });
    }
  }

  return conflicts;
};

const findConflictingFlashDeals = async ({
  sellerId,
  productIds,
  startDate,
  endDate,
  excludeFlashDealId,
}) => {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];

  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) return [];

  const submissions = await FlashDealProduct.find({
    seller: sellerId,
    product: { $in: productIds },
    status: { $in: ['pending', 'approved'] },
  })
    .populate('flashDeal', '_id title status startTime endTime')
    .select('product flashDeal status');

  const conflicts = [];

  submissions.forEach((submission) => {
    const deal = submission.flashDeal;
    if (!deal) return;

    if (excludeFlashDealId && String(deal._id) === String(excludeFlashDealId)) {
      return;
    }

    if (!['scheduled', 'active'].includes(deal.status)) return;

    const dealStart = toDate(deal.startTime);
    const dealEnd = toDate(deal.endTime);
    if (!dealStart || !dealEnd) return;

    if (!rangesOverlap(start, end, dealStart, dealEnd)) return;

    conflicts.push({
      productId: String(submission.product),
      flashDealId: String(deal._id),
      flashDealTitle: deal.title || 'Flash deal',
      submissionStatus: submission.status,
    });
  });

  return conflicts;
};

module.exports = {
  findConflictingDiscounts,
  findConflictingFlashDeals,
};
