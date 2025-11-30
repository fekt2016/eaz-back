const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/**
 * Middleware to restrict access to verified sellers only
 * Blocks access if seller.onboardingStage !== "verified"
 */
exports.requireVerifiedSeller = catchAsync(async (req, res, next) => {
  // req.user should be set by the protect middleware
  if (!req.user || req.user.role !== 'seller') {
    return next(
      new AppError('You do not have permission to perform this action', 403)
    );
  }

  // Fetch seller with onboarding data
  const seller = await Seller.findById(req.user.id).select(
    'onboardingStage requiredSetup verification'
  );

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check if seller is verified
  if (seller.onboardingStage !== 'verified') {
    return res.status(403).json({
      status: 'blocked',
      reason: 'seller_not_verified',
      requiredSetup: seller.requiredSetup,
      onboardingStage: seller.onboardingStage,
      verification: seller.verification,
      message:
        'You must complete your onboarding before accessing this feature.',
    });
  }

  // Seller is verified, proceed
  next();
});

