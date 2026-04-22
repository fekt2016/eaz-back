const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/**
 * Middleware to restrict access to verified sellers only
 * Blocks access if seller.onboardingStage !== "verified"
 */
const SELLER_ROLES = ['seller', 'official_store'];

/** Stages allowed for dashboard-visible features (matches eazseller SellerProtectedRoute). */
const DASHBOARD_ALLOWED_STAGES = new Set(['verified', 'pending_verification']);

const sendOnboardingBlocked = (res, seller) =>
  res.status(403).json({
    status: 'blocked',
    reason: 'seller_not_verified',
    requiredSetup: seller.requiredSetup,
    onboardingStage: seller.onboardingStage,
    verification: seller.verification,
    message: 'You must complete your onboarding before accessing this feature.',
  });

const loadSellerForOnboardingGate = async (req) => {
  if (!req.user || !SELLER_ROLES.includes(req.user.role)) {
    return {
      error: new AppError('You do not have permission to perform this action', 403),
    };
  }

  const seller = await Seller.findById(req.user.id).select(
    'onboardingStage requiredSetup verification'
  );

  if (!seller) {
    return { error: new AppError('Seller not found', 404) };
  }

  return { seller };
};

/**
 * Same gate as eazseller SellerProtectedRoute for sellers who finished setup but are
 * still awaiting admin verification (pending_verification). Full verification-only
 * flows should use requireVerifiedSeller instead.
 */
exports.requireSellerDashboardAccess = catchAsync(async (req, res, next) => {
  const result = await loadSellerForOnboardingGate(req);
  if (result.error) return next(result.error);

  if (!DASHBOARD_ALLOWED_STAGES.has(result.seller.onboardingStage)) {
    return sendOnboardingBlocked(res, result.seller);
  }

  next();
});

exports.requireVerifiedSeller = catchAsync(async (req, res, next) => {
  const result = await loadSellerForOnboardingGate(req);
  if (result.error) return next(result.error);

  if (result.seller.onboardingStage !== 'verified') {
    return sendOnboardingBlocked(res, result.seller);
  }

  next();
});
