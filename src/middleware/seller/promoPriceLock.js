const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const {
  getActiveApprovedPromoSubmissionForProduct,
} = require('../../services/promo/promoService');

const isSellerRole = (role) => ['seller', 'official_store'].includes(role);

const bodyHasPriceEdit = (body) => {
  if (!body || typeof body !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(body, 'price')) return true;
  if (Object.prototype.hasOwnProperty.call(body, 'defaultPrice')) return true;

  const variants = body.variants;
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

const enforceLockError = (submission) =>
  new AppError(
    `Price is locked while product is in active approved promo "${
      submission?.promo?.name || 'promo'
    }".`,
    409,
  );

exports.blockProductPriceEditDuringActivePromo = catchAsync(
  async (req, res, next) => {
    if (!isSellerRole(req.user?.role)) return next();
    if (!bodyHasPriceEdit(req.body)) return next();

    const submission = await getActiveApprovedPromoSubmissionForProduct({
      productId: req.params.id,
      sellerId: req.user.id,
    });
    if (submission) {
      return next(enforceLockError(submission));
    }
    return next();
  },
);

exports.blockVariantPriceEditDuringActivePromo = catchAsync(
  async (req, res, next) => {
    if (!isSellerRole(req.user?.role)) return next();
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'price')) {
      return next();
    }

    const submission = await getActiveApprovedPromoSubmissionForProduct({
      productId: req.params.id,
      sellerId: req.user.id,
    });
    if (submission) {
      return next(enforceLockError(submission));
    }
    return next();
  },
);
