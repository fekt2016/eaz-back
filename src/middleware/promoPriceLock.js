const Product = require('../models/product/productModel');
const {
  getActiveApprovedPromoSubmissionForProduct,
} = require('../services/promo/promoService');

const hasPriceFieldInVariants = (variants) => {
  if (Array.isArray(variants)) {
    return variants.some(
      (variant) =>
        variant &&
        typeof variant === 'object' &&
        Object.prototype.hasOwnProperty.call(variant, 'price'),
    );
  }

  if (typeof variants === 'string') {
    try {
      const parsed = JSON.parse(variants);
      if (Array.isArray(parsed)) {
        return parsed.some(
          (variant) =>
            variant &&
            typeof variant === 'object' &&
            Object.prototype.hasOwnProperty.call(variant, 'price'),
        );
      }
    } catch {
      return false;
    }
  }

  return false;
};

const shouldCheckPriceLock = (body = {}) => {
  if (!body || typeof body !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(body, 'price')) return true;
  return hasPriceFieldInVariants(body.variants);
};

module.exports = async (req, res, next) => {
  try {
    if (!shouldCheckPriceLock(req.body)) return next();

    const productId = req.params?.id;
    if (!productId) return next();

    const product = await Product.findById(productId).select('_id');
    if (!product) return next();

    const submission = await getActiveApprovedPromoSubmissionForProduct({
      productId: product._id,
    });

    if (!submission || !submission.promo) return next();

    const promoName = submission.promo.name || 'promo';
    const endDate = submission.promo.endDate || null;

    return res.status(409).json({
      status: 'fail',
      message: `Price is locked — in promo "${promoName}" until ${endDate}.`,
      data: {
        promoId: submission.promo._id,
        promoName,
        endDate,
      },
    });
  } catch (error) {
    return next(error);
  }
};
