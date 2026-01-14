const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { hasVerifiedPayoutMethod } = require('../../utils/helpers/paymentMethodHelpers');

/**
 * Middleware to restrict withdrawals to sellers with verified payout details
 * Blocks access if seller does not have at least one verified payment method
 * 
 * This ensures sellers cannot withdraw funds until their bank/mobile money
 * account details have been verified by an admin.
 */
exports.requirePayoutVerified = catchAsync(async (req, res, next) => {
  // req.user should be set by the protect middleware
  if (!req.user || req.user.role !== 'seller') {
    return next(
      new AppError('You do not have permission to perform this action', 403)
    );
  }

  // Fetch seller with payout verification data and verification status
  const seller = await Seller.findById(req.user.id).select(
    'paymentMethods name shopName verificationStatus'
  );

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // CRITICAL: Check seller verification status first
  if (seller.verificationStatus !== 'verified') {
    return res.status(403).json({
      status: 'blocked',
      reason: 'seller_not_verified',
      hasVerified: false,
      verificationStatus: seller.verificationStatus,
      message: 'You must be verified as a seller before you can withdraw funds. Please complete the verification process.',
      helpText: 'Please wait for admin verification of your seller account, or contact support if this is taking too long.',
    });
  }

  // Check if seller has at least one verified payment method
  const payoutCheck = hasVerifiedPayoutMethod(seller);
  
  if (!payoutCheck.hasVerified) {
    const reason = payoutCheck.allRejected
      ? payoutCheck.rejectionReasons.join('; ') || 'Payout details were rejected. Please update your payment details and resubmit for verification.'
      : 'Your payout details (bank account or mobile money) must be verified by an admin before you can withdraw funds.';

    return res.status(403).json({
      status: 'blocked',
      reason: 'payout_not_verified',
      hasVerified: false,
      bankStatus: payoutCheck.bankStatus,
      mobileStatus: payoutCheck.mobileStatus,
      rejectionReasons: payoutCheck.rejectionReasons,
      message: reason,
      helpText: payoutCheck.allRejected
        ? 'Please update your payment details and resubmit for verification.'
        : 'Please wait for admin verification of your payout details, or contact support if this is taking too long.',
    });
  }

  // Both seller verification and payout verification are complete, proceed
  next();
});

