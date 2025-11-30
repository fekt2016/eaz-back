const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');

/**
 * Get seller onboarding status
 * GET /seller/status
 * Returns the current onboarding status, including verification status
 */
exports.getOnboardingStatus = catchAsync(async (req, res, next) => {
  // Fetch fresh seller data to ensure we get the latest status
  // Include verificationDocuments to check document verification status
  const seller = await Seller.findById(req.user.id).select(
    'onboardingStage verification verificationStatus verificationDocuments requiredSetup shopName shopLocation shopAddress email verifiedBy verifiedAt'
  );

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // The middleware should have already updated onboardingStage to 'verified' if all conditions are met
  // But we can also check here to ensure consistency
  // Helper function to get document status
  const getDocumentStatus = (document) => {
    if (!document) return null;
    if (typeof document === 'string') return null; // Old format, can't determine status
    return document.status || null;
  };

  // Check if email is verified
  const isEmailVerified = seller.verification?.emailVerified === true;

  // Check if all three documents exist and are verified
  const businessCertStatus = getDocumentStatus(seller.verificationDocuments?.businessCert);
  const idProofStatus = getDocumentStatus(seller.verificationDocuments?.idProof);
  const addresProofStatus = getDocumentStatus(seller.verificationDocuments?.addresProof);

  // Check if all documents are verified
  const allDocumentsVerified = 
    businessCertStatus === 'verified' &&
    idProofStatus === 'verified' &&
    addresProofStatus === 'verified';

  // Also check if documents have URLs (they must be uploaded)
  const allDocumentsUploaded = 
    (seller.verificationDocuments?.businessCert && 
     (typeof seller.verificationDocuments.businessCert === 'string' || 
      seller.verificationDocuments.businessCert.url)) &&
    (seller.verificationDocuments?.idProof && 
     (typeof seller.verificationDocuments.idProof === 'string' || 
      seller.verificationDocuments.idProof.url)) &&
    (seller.verificationDocuments?.addresProof && 
     (typeof seller.verificationDocuments.addresProof === 'string' || 
      seller.verificationDocuments.addresProof.url));

  // If email is verified AND all documents are verified and uploaded, ensure onboardingStage is 'verified'
  // This ensures consistency even if middleware didn't run
  if (isEmailVerified && allDocumentsVerified && allDocumentsUploaded) {
    if (seller.onboardingStage !== 'verified' || seller.verificationStatus !== 'verified') {
      seller.onboardingStage = 'verified';
      seller.verificationStatus = 'verified';
      seller.verification.businessVerified = true;
      await seller.save({ validateBeforeSave: false });
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      onboardingStage: seller.onboardingStage,
      verificationStatus: seller.verificationStatus,
      verification: seller.verification,
      requiredSetup: seller.requiredSetup,
      verifiedBy: seller.verifiedBy,
      verifiedAt: seller.verifiedAt,
    },
  });
});

/**
 * Update seller onboarding status
 * PATCH /seller/update-onboarding
 * Automatically updates onboardingStage based on completed steps
 */
exports.updateOnboarding = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.user.id);

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check business info completion
  const hasBusinessInfo =
    seller.shopName &&
    seller.shopAddress &&
    seller.location &&
    seller.shopDescription;

  // Check bank details - check if seller has created a payment request (indicates bank details added)
  // Use countDocuments instead of exists (more compatible)
  const paymentRequestCount = await PaymentRequest.countDocuments({ seller: seller._id });
  const hasPaymentRequest = paymentRequestCount > 0;
  // Also check if seller has payment methods configured
  const hasPaymentMethods = seller.paymentMethods && (
    (seller.paymentMethods.bankAccount && Object.keys(seller.paymentMethods.bankAccount).length > 0) ||
    (seller.paymentMethods.mobileMoney && Object.keys(seller.paymentMethods.mobileMoney).length > 0)
  );
  const hasBankDetails = hasPaymentRequest || hasPaymentMethods || seller.balance !== undefined; // Check if payment request exists, payment methods are set, or balance is set

  // Check if seller has at least one product (for tracking, but not required for verification)
  const productCount = await Product.countDocuments({ seller: seller._id });
  const hasFirstProduct = productCount > 0;

  // Update requiredSetup
  seller.requiredSetup = {
    hasAddedBusinessInfo: hasBusinessInfo,
    hasAddedBankDetails: hasBankDetails,
    hasAddedFirstProduct: hasFirstProduct,
  };

  // Check if all required setup is complete (product not required for verification)
  const allSetupComplete =
    seller.requiredSetup.hasAddedBusinessInfo &&
    seller.requiredSetup.hasAddedBankDetails;

  // Auto-update onboardingStage
  if (allSetupComplete && seller.onboardingStage === 'profile_incomplete') {
    seller.onboardingStage = 'pending_verification';
  }

  await seller.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: {
      onboardingStage: seller.onboardingStage,
      verification: seller.verification,
      requiredSetup: seller.requiredSetup,
      message: allSetupComplete
        ? 'All setup steps completed. Your account is pending verification.'
        : 'Onboarding status updated.',
    },
  });
});

/**
 * Admin: Approve seller verification
 * PATCH /seller/:id/approve-verification
 */
exports.approveSellerVerification = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.params.id);
  
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check if email is verified (required for full verification)
  if (!seller.verification?.emailVerified) {
    return next(new AppError('Cannot approve seller verification. Email must be verified first.', 400));
  }

  // Check if all documents are uploaded
  const hasAllDocuments = 
    seller.verificationDocuments?.businessCert && 
    (typeof seller.verificationDocuments.businessCert === 'string' || seller.verificationDocuments.businessCert.url) &&
    seller.verificationDocuments?.idProof && 
    (typeof seller.verificationDocuments.idProof === 'string' || seller.verificationDocuments.idProof.url) &&
    seller.verificationDocuments?.addresProof && 
    (typeof seller.verificationDocuments.addresProof === 'string' || seller.verificationDocuments.addresProof.url);

  if (!hasAllDocuments) {
    return next(new AppError('Cannot approve seller verification. All required documents must be uploaded first.', 400));
  }

  // Update seller - middleware will automatically set to verified if all conditions are met
  const updatedSeller = await Seller.findByIdAndUpdate(
    req.params.id,
    {
      verificationStatus: 'verified',
      onboardingStage: 'verified',
      'verification.businessVerified': true,
      verifiedBy: req.user.id, // Track which admin verified the seller
      verifiedAt: new Date(), // Track when verification happened
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedSeller) {
    return next(new AppError('Seller not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      seller: {
        id: updatedSeller._id,
        shopName: updatedSeller.shopName,
        onboardingStage: updatedSeller.onboardingStage,
        verificationStatus: updatedSeller.verificationStatus,
      },
      message: 'Seller verification approved successfully',
    },
  });
});

/**
 * Admin: Reject seller verification
 * PATCH /seller/:id/reject-verification
 */
exports.rejectSellerVerification = catchAsync(async (req, res, next) => {
  const { reason } = req.body;

  const seller = await Seller.findByIdAndUpdate(
    req.params.id,
    {
      verificationStatus: 'rejected',
      onboardingStage: 'profile_incomplete',
      'verification.businessVerified': false,
      verifiedBy: null, // Clear verifiedBy when rejected
      verifiedAt: null, // Clear verifiedAt when rejected
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      seller: {
        id: seller._id,
        shopName: seller.shopName,
        onboardingStage: seller.onboardingStage,
      },
      rejectionReason: reason || 'Verification requirements not met',
      message: 'Seller verification rejected',
    },
  });
});

/**
 * Update individual document status
 * PATCH /seller/:id/document-status
 * Body: { documentType: 'businessCert' | 'idProof' | 'addresProof', status: 'verified' | 'rejected' }
 */
exports.updateDocumentStatus = catchAsync(async (req, res, next) => {
  const { documentType, status } = req.body;
  const { id } = req.params;

  if (!documentType || !status) {
    return next(new AppError('documentType and status are required', 400));
  }

  if (!['businessCert', 'idProof', 'addresProof'].includes(documentType)) {
    return next(new AppError('Invalid document type', 400));
  }

  if (!['verified', 'rejected'].includes(status)) {
    return next(new AppError('Invalid status. Must be "verified" or "rejected"', 400));
  }

  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Handle backward compatibility: if document is stored as string, convert to new structure
  const document = seller.verificationDocuments[documentType];
  if (typeof document === 'string' && document) {
    seller.verificationDocuments[documentType] = {
      url: document,
      status: status,
      verifiedBy: status === 'verified' || status === 'rejected' ? req.user.id : null,
      verifiedAt: status === 'verified' || status === 'rejected' ? new Date() : null,
    };
  } else if (document && document.url) {
    // Update status for existing document
    seller.verificationDocuments[documentType].status = status;
    // Track which admin verified/rejected the document
    if (status === 'verified' || status === 'rejected') {
      seller.verificationDocuments[documentType].verifiedBy = req.user.id;
      seller.verificationDocuments[documentType].verifiedAt = new Date();
    }
  } else {
    return next(new AppError(`Document ${documentType} not found`, 404));
  }

  // If business certificate is verified, set hasAddedBusinessInfo to true
  // Business certificate verification indicates business information is complete
  if (documentType === 'businessCert' && status === 'verified') {
    seller.requiredSetup.hasAddedBusinessInfo = true;
    
    // Check if all setup is complete (product not required for verification)
    const allSetupComplete =
      seller.requiredSetup.hasAddedBusinessInfo &&
      seller.requiredSetup.hasAddedBankDetails;

    // Auto-update onboardingStage if all setup is complete
    if (allSetupComplete && seller.onboardingStage === 'profile_incomplete') {
      seller.onboardingStage = 'pending_verification';
    }
  }

  await seller.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: {
      message: `Document ${documentType} status updated to ${status}`,
      seller: {
        id: seller._id,
        verificationDocuments: seller.verificationDocuments,
      },
    },
  });
});

