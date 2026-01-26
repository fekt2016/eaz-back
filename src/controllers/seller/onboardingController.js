const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const mongoose = require('mongoose');

/**
 * Get seller onboarding status
 * GET /seller/status
 * Returns the current onboarding status, including verification status
 */
exports.getOnboardingStatus = catchAsync(async (req, res, next) => {
  // Ensure req.user exists (should be set by protectSeller middleware)
  if (!req.user || !req.user.id) {
    console.error('[getOnboardingStatus] ❌ req.user is missing:', {
      hasUser: !!req.user,
      userId: req.user?.id,
      path: req.path,
      method: req.method,
    });
    return next(new AppError('Authentication required. Please log in to access this resource.', 401));
  }

  // Validate that req.user.id is a valid MongoDB ObjectId
  if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
    console.error('[getOnboardingStatus] ❌ Invalid seller ID format:', {
      userId: req.user.id,
      type: typeof req.user.id,
    });
    return next(new AppError('Invalid seller ID format', 400));
  }

  // Fetch fresh seller data to ensure we get the latest status
  // Include verificationDocuments to check document verification status
  const seller = await Seller.findById(req.user.id).select(
    'onboardingStage verification verificationStatus verificationDocuments requiredSetup shopName shopLocation shopAddress email verifiedBy verifiedAt paymentMethods phone'
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
  
  // Check if phone is verified (if phone exists and is not empty, consider it verified for now)
  // TODO: Add phone verification system if needed
  const isPhoneVerified = seller.phone && seller.phone.trim() !== '';

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

  // Check payment method verification status
  const bankAccountPayoutStatus = seller.paymentMethods?.bankAccount?.payoutStatus;
  const mobileMoneyPayoutStatus = seller.paymentMethods?.mobileMoney?.payoutStatus;
  const hasPaymentMethod = !!(seller.paymentMethods?.bankAccount || seller.paymentMethods?.mobileMoney);
  const hasPaymentMethodVerified = 
    bankAccountPayoutStatus === 'verified' || 
    mobileMoneyPayoutStatus === 'verified';

  // ✅ BACKEND-DRIVEN: Compute isSetupComplete using model method
  const isSetupComplete = seller.computeIsSetupComplete();

  // If email is verified AND all documents are verified and uploaded, ensure onboardingStage is 'verified'
  // This ensures consistency even if middleware didn't run
  if (isEmailVerified && allDocumentsVerified && allDocumentsUploaded) {
    if (seller.onboardingStage !== 'verified' || seller.verificationStatus !== 'verified') {
      try {
        seller.onboardingStage = 'verified';
        seller.verificationStatus = 'verified';
        seller.verification.businessVerified = true;
        await seller.save({ validateBeforeSave: false });
      } catch (saveError) {
        console.error('[getOnboardingStatus] Error saving seller:', saveError);
        // Don't fail the request if save fails - just log and continue
      }
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      onboardingStage: seller.onboardingStage,
      verificationStatus: seller.verificationStatus,
      // ✅ BACKEND-DRIVEN: Return isSetupComplete from backend
      isSetupComplete, // Single source of truth
      verification: {
        ...seller.verification,
        emailVerified: isEmailVerified,
        phoneVerified: isPhoneVerified,
        contactVerified: isEmailVerified || isPhoneVerified, // Either email or phone verified
      },
      requiredSetup: {
        ...seller.requiredSetup,
        hasPaymentMethodVerified: hasPaymentMethodVerified,
        hasBusinessDocumentsVerified: allDocumentsVerified && allDocumentsUploaded,
      },
      paymentMethodStatus: {
        hasAdded: hasPaymentMethod,
        isVerified: hasPaymentMethodVerified,
        bankAccountStatus: bankAccountPayoutStatus,
        mobileMoneyStatus: mobileMoneyPayoutStatus,
      },
      businessDocumentsStatus: {
        hasUploaded: allDocumentsUploaded,
        isVerified: allDocumentsVerified,
        businessCertStatus,
        idProofStatus,
        addresProofStatus,
      },
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

  // FIXED: Check verification status, not just if things are added
  // Get document verification status
  const getDocumentStatus = (document) => {
    if (!document) return null;
    if (typeof document === 'string') return null;
    return document.status || null;
  };

  const businessCertStatus = getDocumentStatus(seller.verificationDocuments?.businessCert);
  const idProofStatus = getDocumentStatus(seller.verificationDocuments?.idProof);
  const addresProofStatus = getDocumentStatus(seller.verificationDocuments?.addresProof);

  const allDocumentsVerified =  
    businessCertStatus === 'verified' &&
    idProofStatus === 'verified' &&
    addresProofStatus === 'verified';

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

  // Check payment method verification status
  const bankAccountPayoutStatus = seller.paymentMethods?.bankAccount?.payoutStatus;
  const mobileMoneyPayoutStatus = seller.paymentMethods?.mobileMoney?.payoutStatus;
  const hasPaymentMethodVerified = 
    bankAccountPayoutStatus === 'verified' || 
    mobileMoneyPayoutStatus === 'verified';

  // Check contact verification
  const isEmailVerified = seller.verification?.emailVerified === true;
  const isPhoneVerified = seller.phone && seller.phone.trim() !== '';
  const isContactVerified = isEmailVerified || isPhoneVerified;

  // Update requiredSetup with actual verification status
  seller.requiredSetup.hasBusinessDocumentsVerified = allDocumentsVerified && allDocumentsUploaded;
  seller.requiredSetup.hasPaymentMethodVerified = hasPaymentMethodVerified;

  // Check if all required setup is complete (product not required for verification)
  // FIXED: Now checks actual verification status, not just if things are added
  const allSetupComplete =
    seller.requiredSetup.hasAddedBusinessInfo &&
    seller.requiredSetup.hasAddedBankDetails &&
    allDocumentsVerified &&
    allDocumentsUploaded &&
    hasPaymentMethodVerified &&
    isContactVerified;

  // Auto-update onboardingStage
  const wasPendingVerification = seller.onboardingStage === 'pending_verification';
  if (allSetupComplete && seller.onboardingStage === 'profile_incomplete') {
    seller.onboardingStage = 'pending_verification';
    
    // Notify admins when seller submits verification documents
    if (!wasPendingVerification) {
      try {
        const notificationService = require('../../services/notification/notificationService');
        await notificationService.createSellerVerificationSubmissionNotification(
          seller._id,
          seller.shopName || seller.name
        );
        logger.info(`[Onboarding] Admin notification created for seller verification submission ${seller._id}`);
      } catch (notificationError) {
        logger.error('[Onboarding] Error creating admin notification:', notificationError);
        // Don't fail onboarding if notification fails
      }
    }
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
  const docs = seller.verificationDocuments || {};
  const missingDocs = [];
  
  // Check business certificate
  const hasBusinessCert = docs.businessCert && 
    (typeof docs.businessCert === 'string' || (docs.businessCert && docs.businessCert.url));
  if (!hasBusinessCert) {
    missingDocs.push('Business Certificate');
  }
  
  // Check ID proof
  const hasIdProof = docs.idProof && 
    (typeof docs.idProof === 'string' || (docs.idProof && docs.idProof.url));
  if (!hasIdProof) {
    missingDocs.push('ID Proof');
  }
  
  // Check address proof
  const hasAddressProof = docs.addresProof && 
    (typeof docs.addresProof === 'string' || (docs.addresProof && docs.addresProof.url));
  if (!hasAddressProof) {
    missingDocs.push('Address Proof');
  }

  if (missingDocs.length > 0) {
    return next(new AppError(
      `Cannot approve seller verification. Missing required documents: ${missingDocs.join(', ')}. All documents (Business Certificate, ID Proof, Address Proof) must be uploaded before approval.`,
      400
    ));
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

  // Make all seller's products visible to buyers
  try {
    const { updateSellerProductsVisibility } = require('../../utils/helpers/productVisibility');
    const visibilityResult = await updateSellerProductsVisibility(updatedSeller._id, 'verified');
    console.log(`[Approve Seller Verification] Product visibility updated:`, visibilityResult);
  } catch (visibilityError) {
    console.error('[Approve Seller Verification] Error updating product visibility:', visibilityError);
    // Don't fail verification approval if visibility update fails
  }

  // Notify seller about verification approval
  try {
    const notificationService = require('../../services/notification/notificationService');
    await notificationService.createVerificationNotification(
      updatedSeller._id,
      'seller',
      updatedSeller._id,
      'approved'
    );
    logger.info(`[Approve Seller Verification] Notification created for seller ${updatedSeller._id}`);
  } catch (notificationError) {
    logger.error('[Approve Seller Verification] Error creating notification:', notificationError);
    // Don't fail verification approval if notification fails
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

  // Notify seller about verification rejection
  try {
    const notificationService = require('../../services/notification/notificationService');
const logger = require('../../utils/logger');
    await notificationService.createVerificationNotification(
      seller._id,
      'seller',
      seller._id,
      'rejected'
    );
    logger.info(`[Reject Seller Verification] Notification created for seller ${seller._id}`);
  } catch (notificationError) {
    logger.error('[Reject Seller Verification] Error creating notification:', notificationError);
    // Don't fail verification rejection if notification fails
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

/**
 * NOTE: Payout verification functions have been moved to:
 * backend/src/controllers/admin/payoutVerificationController.js
 * 
 * This separation ensures payout verification is completely independent
 * from document verification (onboarding).
 * 
 * New routes:
 * - GET /api/v1/admin/sellers/:id/payout
 * - PATCH /api/v1/admin/sellers/:id/payout/approve
 * - PATCH /api/v1/admin/sellers/:id/payout/reject
 * 
 * This controller now handles ONLY document verification (onboarding).
 */
