const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const mongoose = require('mongoose');
// Reuse shared payout helper so onboarding steps and admin payout
// approval logic always stay in sync.
const { hasVerifiedPayoutMethod } = require('../../utils/helpers/paymentMethodHelpers');

/**
 * Get seller onboarding status
 * GET /seller/status
 * Returns the current onboarding status, including verification status
 */
exports.getOnboardingStatus = catchAsync(async (req, res, next) => {
  try {
    // Ensure req.user exists (should be set by protectSeller middleware)
    if (!req.user) {
      console.error('[getOnboardingStatus] ❌ req.user is missing:', {
        hasUser: !!req.user,
        path: req.path,
        method: req.method,
      });
      return next(new AppError('Authentication required. Please log in to access this resource.', 401));
    }

    // Get seller ID - Mongoose documents have _id, but also expose id as a getter
    // Handle both _id and id for robustness
    const sellerId = req.user._id || req.user.id;
    
    if (!sellerId) {
      console.error('[getOnboardingStatus] ❌ Seller ID is missing:', {
        hasUser: !!req.user,
        hasId: !!req.user.id,
        hasUnderscoreId: !!req.user._id,
        path: req.path,
        method: req.method,
      });
      return next(new AppError('Invalid seller session. Please log in again.', 401));
    }

    // Validate that sellerId is a valid MongoDB ObjectId
    const sellerIdString = sellerId.toString();
    if (!mongoose.Types.ObjectId.isValid(sellerIdString)) {
      console.error('[getOnboardingStatus] ❌ Invalid seller ID format:', {
        sellerId: sellerIdString,
        type: typeof sellerId,
        path: req.path,
        method: req.method,
      });
      return next(new AppError('Invalid seller ID format', 400));
    }
  } catch (validationError) {
    console.error('[getOnboardingStatus] ❌ Error in validation:', validationError);
    return next(new AppError('Invalid request data', 400));
  }

  // Get seller ID for query (use _id if available, otherwise id)
  const sellerId = req.user._id || req.user.id;

  // Fetch fresh seller data to ensure we get the latest status
  // Include verificationDocuments to check document verification status
  const seller = await Seller.findById(sellerId).select(
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
  // Safely check phone - handle cases where phone might not be a string
  const isPhoneVerified = seller.phone && typeof seller.phone === 'string' && seller.phone.trim() !== '';

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

  // Check payment method verification status using shared helper so
  // admin approval and seller setup step use the exact same rules.
  const payoutCheck = hasVerifiedPayoutMethod(seller);
  const hasPaymentMethod = !!(seller.paymentMethods?.bankAccount || seller.paymentMethods?.mobileMoney);
  let hasPaymentMethodVerified = payoutCheck.hasVerified;

  // Fallback: if embedded seller.paymentMethods haven't been updated yet
  // (e.g. older approvals that only touched PaymentMethod records), also
  // look at PaymentMethod model to see if this seller has any verified methods.
  if (!hasPaymentMethodVerified) {
    try {
      const PaymentMethod = require('../../models/payment/PaymentMethodModel');
      const User = require('../../models/user/userModel');
      const userAccount = await User.findOne({ email: seller.email }).select('_id');
      if (userAccount) {
        const hasVerifiedFromMethods = await PaymentMethod.exists({
          user: userAccount._id,
          $or: [
            { verificationStatus: 'verified' },
            { status: { $in: ['verified', 'active'] } },
          ],
        });
        if (hasVerifiedFromMethods) {
          hasPaymentMethodVerified = true;
        }
      }
    } catch (pmError) {
      console.error('[getOnboardingStatus] Error checking PaymentMethod model for verified methods:', pmError);
      // Non-critical: if this fallback fails, we just rely on embedded paymentMethods.
    }
  }

  // ✅ BACKEND-DRIVEN: Compute isSetupComplete using model method
  // Wrap in try-catch to handle any errors gracefully
  let isSetupComplete = false;
  try {
    isSetupComplete = seller.computeIsSetupComplete();
  } catch (computeError) {
    console.error('[getOnboardingStatus] Error computing isSetupComplete:', computeError);
    // Fallback: compute manually if method fails
    isSetupComplete = 
      allDocumentsVerified && 
      allDocumentsUploaded &&
      isEmailVerified &&
      isPhoneVerified &&
      hasPaymentMethodVerified;
  }

  // CRITICAL: Check if ALL requirements are met for seller verification
  // This matches the pre-save hook logic to ensure consistency
  // Requirements:
  // 1. All 3 documents verified and uploaded
  // 2. Email verified (verified during registration)
  // 3. Phone verified (phone exists)
  // 4. Payment method verified (at least one payment method is verified)
  const allRequirementsMet = 
    allDocumentsVerified && 
    allDocumentsUploaded &&
    isEmailVerified &&
    isPhoneVerified &&
    hasPaymentMethodVerified;

  // If all requirements are met, ensure onboardingStage is 'verified'
  // This ensures consistency even if pre-save hook didn't run
  // The pre-save hook will also run on save, but this provides immediate consistency
  if (allRequirementsMet) {
    if (seller.onboardingStage !== 'verified' || seller.verificationStatus !== 'verified') {
      try {
        seller.onboardingStage = 'verified';
        seller.verificationStatus = 'verified';
        seller.verification = seller.verification || {};
        seller.verification.businessVerified = true;
        seller.verification.emailVerified = true; // Ensure email is marked as verified
        
        // Set verifiedBy and verifiedAt if not already set
        if (!seller.verifiedBy) {
          const getVerifiedBy = (doc) => {
            if (typeof doc === 'string') return null;
            return doc?.verifiedBy || null;
          };
          
          const businessCertAdmin = getVerifiedBy(seller.verificationDocuments.businessCert);
          const idProofAdmin = getVerifiedBy(seller.verificationDocuments.idProof);
          const addresProofAdmin = getVerifiedBy(seller.verificationDocuments.addresProof);
          
          seller.verifiedBy = addresProofAdmin || idProofAdmin || businessCertAdmin;
        }
        
        if (!seller.verifiedAt) {
          const getVerifiedAt = (doc) => {
            if (typeof doc === 'string') return null;
            if (!doc?.verifiedAt) return null;
            try {
              const date = new Date(doc.verifiedAt);
              // Check if date is valid
              if (isNaN(date.getTime())) return null;
              return date;
            } catch (e) {
              return null;
            }
          };
          
          const dates = [
            getVerifiedAt(seller.verificationDocuments.businessCert),
            getVerifiedAt(seller.verificationDocuments.idProof),
            getVerifiedAt(seller.verificationDocuments.addresProof),
          ].filter(Boolean);
          
          if (dates.length > 0) {
            const timestamps = dates.map(d => d.getTime()).filter(t => !isNaN(t));
            if (timestamps.length > 0) {
              seller.verifiedAt = new Date(Math.max(...timestamps));
            } else {
              seller.verifiedAt = new Date();
            }
          } else {
            seller.verifiedAt = new Date();
          }
        }
        
        await seller.save({ validateBeforeSave: false });
        console.log('[getOnboardingStatus] ✅ All requirements met - updated seller to verified status');
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
        bankAccountStatus: payoutCheck.bankStatus,
        mobileMoneyStatus: payoutCheck.mobileStatus,
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

  // Check payment method verification status using shared helper so
  // admin approval and seller setup step use the exact same rules.
  const payoutCheck = hasVerifiedPayoutMethod(seller);
  const bankAccountPayoutStatus = payoutCheck.bankStatus;
  const mobileMoneyPayoutStatus = payoutCheck.mobileStatus;
  const hasPaymentMethodVerified = payoutCheck.hasVerified;

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

  // CRITICAL: Use save() instead of findByIdAndUpdate to trigger pre-save hook
  // The pre-save hook will validate ALL requirements (documents, email, phone, payment method)
  // and only set to verified if all are met
  seller.verificationStatus = 'verified';
  seller.onboardingStage = 'verified';
  seller.status = 'active'; // So seller table shows "active" when verification is approved
  seller.verification = seller.verification || {};
  seller.verification.businessVerified = true;
  seller.verification.emailVerified = true; // CRITICAL: Mark email as verified when admin approves
  seller.verifiedBy = req.user.id; // Track which admin verified the seller
  seller.verifiedAt = new Date(); // Track when verification happened
  
  // Mark verification field as modified so Mongoose saves it
  seller.markModified('verification');
  
  // Save seller - this will trigger the pre-save hook which validates all requirements
  // The hook will ensure phone and payment method are also verified before finalizing
  const updatedSeller = await seller.save({ validateBeforeSave: false });

  if (!updatedSeller) {
    return next(new AppError('Seller not found', 404));
  }
  
  // Verify that the seller was actually verified (pre-save hook may have reverted if requirements not met)
  if (updatedSeller.onboardingStage !== 'verified' || updatedSeller.verificationStatus !== 'verified') {
    console.warn('[Approve Seller Verification] ⚠️ Seller was not verified - requirements not met:', {
      sellerId: updatedSeller._id,
      onboardingStage: updatedSeller.onboardingStage,
      verificationStatus: updatedSeller.verificationStatus,
      emailVerified: updatedSeller.verification?.emailVerified,
      phoneVerified: updatedSeller.phone && updatedSeller.phone.trim() !== '',
      hasPaymentMethod: !!(updatedSeller.paymentMethods?.bankAccount || updatedSeller.paymentMethods?.mobileMoney),
    });
    
    // Check what's missing
    const { hasVerifiedPayoutMethod } = require('../../utils/helpers/paymentMethodHelpers');
    const payoutCheck = hasVerifiedPayoutMethod(updatedSeller);
    const hasPaymentMethodVerified = payoutCheck.hasVerified;
    const isPhoneVerified = updatedSeller.phone && updatedSeller.phone.trim() !== '';
    
    const missingRequirements = [];
    if (!updatedSeller.verification?.emailVerified) missingRequirements.push('Email verification');
    if (!isPhoneVerified) missingRequirements.push('Phone number');
    if (!hasPaymentMethodVerified) missingRequirements.push('Payment method verification');
    
    return next(new AppError(
      `Cannot approve seller verification. Missing requirements: ${missingRequirements.join(', ')}. All requirements (email, phone, payment method) must be met before approval.`,
      400
    ));
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

  // Fetch seller with minimal fields for better performance
  const seller = await Seller.findById(id).select('verificationDocuments requiredSetup onboardingStage');
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check if document exists
  const document = seller.verificationDocuments?.[documentType];
  if (!document) {
    return next(new AppError(`Document ${documentType} not found`, 404));
  }

  // Handle backward compatibility: if document is stored as string, convert to new structure
  if (typeof document === 'string' && document) {
    // Replace entire document object to ensure Mongoose detects the change
    seller.verificationDocuments[documentType] = {
      url: document,
      status: status,
      verifiedBy: status === 'verified' || status === 'rejected' ? req.user.id : null,
      verifiedAt: status === 'verified' || status === 'rejected' ? new Date() : null,
    };
  } else if (document && document.url) {
    // CRITICAL: Replace entire document object instead of modifying nested properties
    // This ensures Mongoose properly detects the change for Mixed type fields
    seller.verificationDocuments[documentType] = {
      ...document, // Preserve existing fields (url, etc.)
      status: status,
      verifiedBy: status === 'verified' || status === 'rejected' ? req.user.id : (document.verifiedBy || null),
      verifiedAt: status === 'verified' || status === 'rejected' ? new Date() : (document.verifiedAt || null),
    };
  } else {
    return next(new AppError(`Document ${documentType} not found`, 404));
  }

  // CRITICAL: Mark verificationDocuments as modified
  // Mongoose doesn't automatically detect changes to Mixed type fields
  // Without this, the changes won't be saved to the database!
  seller.markModified('verificationDocuments');
  
  // Double-check that Mongoose recognizes the change
  if (!seller.isModified('verificationDocuments')) {
    console.error('[updateDocumentStatus] WARNING: verificationDocuments not marked as modified after markModified() call!');
    // Force mark as modified by setting the entire object
    const currentDocs = seller.verificationDocuments.toObject ? seller.verificationDocuments.toObject() : seller.verificationDocuments;
    seller.verificationDocuments = { ...currentDocs };
    seller.markModified('verificationDocuments');
  }

  // If business certificate is verified, set hasAddedBusinessInfo to true
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

  // Log before save
  console.log('[updateDocumentStatus] Before save:', {
    documentType,
    status,
    documentStatus: seller.verificationDocuments[documentType]?.status,
    verifiedBy: seller.verificationDocuments[documentType]?.verifiedBy,
    verifiedAt: seller.verificationDocuments[documentType]?.verifiedAt,
    isModified: seller.isModified('verificationDocuments'),
  });

  // Prepare update data for findByIdAndUpdate (includes verificationStatus if all docs verified)
  const updateData = {
    [`verificationDocuments.${documentType}`]: seller.verificationDocuments[documentType],
  };

  // If all 3 documents are verified, also update verificationStatus and onboardingStage
  if (status === 'verified') {
    const getDocumentStatus = (doc) => {
      if (!doc) return null;
      if (typeof doc === 'string') return null;
      return doc.status || null;
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

    if (allDocumentsVerified && allDocumentsUploaded) {
      updateData.verificationStatus = 'verified';
      updateData.onboardingStage = 'verified';
      updateData.status = 'active'; // So seller table shows "active" when all verifications pass
      updateData['verification.businessVerified'] = true;
      // CRITICAL: When all documents are verified by admin, also mark email as verified
      // This ensures seller setup page recognizes email verification
      updateData['verification.emailVerified'] = true;
      
      // Also update seller object in memory for save() method
      seller.verificationStatus = 'verified';
      seller.onboardingStage = 'verified';
      seller.status = 'active';
      if (!seller.verification) {
        seller.verification = {};
      }
      seller.verification.businessVerified = true;
      seller.verification.emailVerified = true;
      
      // Mark verification field as modified so Mongoose saves it
      seller.markModified('verification');

      // Set verifiedBy if not already set
      if (!seller.verifiedBy) {
        const getVerifiedBy = (doc) => {
          if (typeof doc === 'string') return null;
          return doc?.verifiedBy || null;
        };
        
        const businessCertAdmin = getVerifiedBy(seller.verificationDocuments.businessCert);
        const idProofAdmin = getVerifiedBy(seller.verificationDocuments.idProof);
        const addresProofAdmin = getVerifiedBy(seller.verificationDocuments.addresProof);
        
        updateData.verifiedBy = addresProofAdmin || idProofAdmin || businessCertAdmin || req.user.id;
      }

      // Set verifiedAt if not already set
      if (!seller.verifiedAt) {
        const getVerifiedAt = (doc) => {
          if (typeof doc === 'string') return null;
          return doc?.verifiedAt ? new Date(doc.verifiedAt) : null;
        };
        
        const dates = [
          getVerifiedAt(seller.verificationDocuments.businessCert),
          getVerifiedAt(seller.verificationDocuments.idProof),
          getVerifiedAt(seller.verificationDocuments.addresProof),
        ].filter(Boolean);
        
        if (dates.length > 0) {
          updateData.verifiedAt = new Date(Math.max(...dates.map(d => d.getTime())));
        } else {
          updateData.verifiedAt = new Date();
        }
      }

      console.log('[updateDocumentStatus] ✅ All 3 documents verified - will update verificationStatus to verified');
    }
  }

  // Save with minimal validation for better performance
  try {
    // First attempt: Use save() method
    await seller.save({ validateBeforeSave: false });
    
    // Verify the save worked by fetching again (include verificationStatus and onboardingStage)
    let savedSeller = await Seller.findById(id).select('verificationDocuments verificationStatus onboardingStage verifiedBy verifiedAt');
    console.log('[updateDocumentStatus] After save - verification:', {
      documentType,
      savedStatus: savedSeller?.verificationDocuments?.[documentType]?.status,
      verificationStatus: savedSeller?.verificationStatus,
      onboardingStage: savedSeller?.onboardingStage,
      statusMatches: savedSeller?.verificationDocuments?.[documentType]?.status === status,
    });
    
    // If save didn't work, use findByIdAndUpdate as fallback
    if (savedSeller?.verificationDocuments?.[documentType]?.status !== status) {
      console.warn('[updateDocumentStatus] WARNING: Save() didn\'t persist changes, trying findByIdAndUpdate...');
      
      // Use findByIdAndUpdate to directly update the database
      savedSeller = await Seller.findByIdAndUpdate(
        id,
        { $set: updateData },
        {
          new: true,
          runValidators: false,
        }
      ).select('verificationDocuments verificationStatus onboardingStage verifiedBy verifiedAt');
      
      console.log('[updateDocumentStatus] After findByIdAndUpdate - verification:', {
        documentType,
        savedStatus: savedSeller?.verificationDocuments?.[documentType]?.status,
        verificationStatus: savedSeller?.verificationStatus,
        onboardingStage: savedSeller?.onboardingStage,
        statusMatches: savedSeller?.verificationDocuments?.[documentType]?.status === status,
      });
      
      if (savedSeller?.verificationDocuments?.[documentType]?.status !== status) {
        console.error('[updateDocumentStatus] ❌ CRITICAL: Status mismatch after both save methods!', {
          expected: status,
          actual: savedSeller?.verificationDocuments?.[documentType]?.status,
          documentType,
        });
        return next(new AppError('Failed to save document status to database', 500));
      }
    }

    // Update seller object with saved data for response
    seller.verificationStatus = savedSeller.verificationStatus;
    seller.onboardingStage = savedSeller.onboardingStage;
    seller.verifiedBy = savedSeller.verifiedBy;
    seller.verifiedAt = savedSeller.verifiedAt;
    if (savedSeller.verification) {
      seller.verification = savedSeller.verification;
    }
  } catch (saveError) {
    console.error('[updateDocumentStatus] ❌ Error saving seller:', {
      error: saveError.message,
      stack: saveError.stack,
      documentType,
      status,
    });
    return next(new AppError('Failed to save document status', 500));
  }

  // CRITICAL: Compute derived fields for frontend
  // These fields are computed from status and must be included in response
  const updatedDocument = seller.verificationDocuments[documentType];
  const computedFields = {
    status: updatedDocument.status,
    isVerified: updatedDocument.status === 'verified',
    isProcessed: updatedDocument.status === 'verified' || updatedDocument.status === 'rejected',
    shouldShowButtons: updatedDocument.status === 'pending' && !!updatedDocument.url,
  };

  // Merge computed fields into the document for response
  const documentWithComputedFields = {
    ...updatedDocument,
    ...computedFields,
  };

  // Update the verificationDocuments with computed fields
  const responseVerificationDocuments = {
    ...seller.verificationDocuments,
    [documentType]: documentWithComputedFields,
  };

  res.status(200).json({
    status: 'success',
    data: {
      message: `Document ${documentType} status updated to ${status}`,
      seller: {
        id: seller._id,
        verificationDocuments: responseVerificationDocuments,
        // Include updated verificationStatus and onboardingStage in response
        // This allows frontend to immediately reflect the seller's verification status
        verificationStatus: seller.verificationStatus,
        onboardingStage: seller.onboardingStage,
        verifiedBy: seller.verifiedBy,
        verifiedAt: seller.verifiedAt,
        verification: seller.verification,
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
