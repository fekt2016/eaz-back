const Seller = require('../../models/user/sellerModel');
const handleFactory = require('../shared/handleFactory');
const catchAsync = require('../../utils/helpers/catchAsync');
const stream = require('stream');
const Product = require('../../models/product/productModel');
const APIFeature = require('../../utils/helpers/apiFeatures');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const multer = require('multer');
const mongoose = require('mongoose');
const { uploadMultipleFields } = require('../../middleware/upload/cloudinaryUpload');

exports.getSellerProducts = catchAsync(async (req, res, next) => {
  const features = new APIFeature(
    Product.find({ seller: req.user.id }), // Use the filter object
    req.query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // Ensure variants are included in the response (needed for stock calculation)
  // If fields are specified, make sure variants is included
  if (req.query.fields && !req.query.fields.includes('variants')) {
    features.query = features.query.select(req.query.fields + ' variants');
  }

  const sellerProducts = await features.query.populate({
    path: 'parentCategory subCategory',
    select: 'name slug',
  });

  if (!sellerProducts) {
    return next(new AppError('No product found on this Seller Id', 400));
  }

  // Calculate totalStock for each product if not already calculated (virtual should handle this)
  // But ensure variants are included in the response
  const productsWithStock = sellerProducts.map((product) => {
    const productObj = product.toObject ? product.toObject() : product;
    // Calculate totalStock from variants if virtual didn't work
    if (productObj.variants && Array.isArray(productObj.variants)) {
      productObj.totalStock = productObj.variants.reduce(
        (sum, variant) => sum + (variant.stock || 0),
        0
      );
    } else if (productObj.totalStock === undefined) {
      productObj.totalStock = 0;
    }
    return productObj;
  });

  res.status(200).json({
    status: 'success',
    result: productsWithStock.length,
    data: {
      data: productsWithStock,
    },
  });
});
exports.getSellerProductById = catchAsync(async (req, res, next) => {
  // Route uses :productId, but we'll check both for compatibility
  const productId = req.params.productId || req.params.id;
  
  if (!productId) {
    return next(new AppError('Product ID is required', 400));
  }

  // Verify the product belongs to the seller (unless admin)
  const product = await Product.findById(productId)
    .populate({
      path: 'parentCategory',
      select: 'name slug',
    })
    .populate({
      path: 'subCategory',
      select: 'name slug',
    });

  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to access this product', 403));
  }

  res.status(200).json({ status: 'success', data: { product } });
});
exports.SellerDeleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to delete this product', 403));
  }

  // Check if product has orders - if yes, use soft delete; if no, use hard delete
  const OrderItem = require('../../models/order/OrderItemModel');
  const orderCount = await OrderItem.countDocuments({ product: req.params.id })
    .maxTimeMS(10000); // 10 seconds max for order count

  if (orderCount > 0) {
    // Product has orders - use soft delete to preserve order history
    product.status = 'archived';
    product.isDeleted = true;
    product.isDeletedBySeller = true;
    product.isDeletedByAdmin = false; // Ensure admin flag is false
    product.deletedAt = new Date();
    product.deletedBy = req.user.id;
    product.deletedByRole = 'seller';
    product.isVisible = false; // Ensure archived products are hidden
    await product.save();
    
    return res.status(200).json({ 
      status: 'success', 
      message: 'Product archived (preserved due to order history)',
      data: { product } 
    });
  } else {
    // No orders - safe to hard delete
    await Product.findByIdAndDelete(req.params.id);
    return res.status(200).json({ 
      status: 'success', 
      message: 'Product permanently deleted',
      data: { product } 
    });
  }
});

// Multer configuration for file uploads
const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  // Allow images and PDFs
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new AppError('Only images and PDF files are allowed', 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Middleware to conditionally handle file uploads
exports.uploadBusinessDocuments = (req, res, next) => {
  // Check if request contains multipart/form-data
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    return upload.fields([
      { name: 'businessCert', maxCount: 1 },
      { name: 'idProof', maxCount: 1 },
      { name: 'addressProof', maxCount: 1 },
    ])(req, res, next);
  }
  next();
};

// Middleware to upload business documents to Cloudinary
// Note: addressProof is mapped to addresProof (model typo) in updateMe
exports.uploadBusinessDocumentsToCloudinary = uploadMultipleFields([
  { 
    name: 'businessCert', 
    folder: 'seller-documents', 
    resourceType: 'auto',
    storeIn: 'verificationDocuments',
    // Map to correct field name in model
    fieldMapping: 'businessCert'
  },
  { 
    name: 'idProof', 
    folder: 'seller-documents', 
    resourceType: 'auto',
    storeIn: 'verificationDocuments',
    fieldMapping: 'idProof'
  },
  { 
    name: 'addressProof', 
    folder: 'seller-documents', 
    resourceType: 'auto',
    storeIn: 'verificationDocuments',
    // Map addressProof to addresProof (model uses addresProof with typo)
    fieldMapping: 'addresProof'
  },
]);

exports.updateSellerImage = catchAsync(async (req, res, next) => {
  // 1. Check if file exists
  if (!req.file) return next(new AppError('No image file uploaded', 400));

  // // 2. Initialize Cloudinary
  const cloudinary = req.app.get('cloudinary');

  // 3. Process and upload image
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'seller-avatars',
        transformation: [{ width: 500, height: 500, crop: 'fill' }],
      },
      (error, result) => {
        if (error) {
          return reject(
            new AppError(`Image upload failed: ${error.message}`, 500),
          );
        }
        resolve(result);
      },
    );

    // Create buffer stream from file
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);
    bufferStream.pipe(uploadStream);
  });

  // 4. Update request body with Cloudinary URL
  req.body.avatar = result.secure_url;

  // 5. Validate request body
  if (!req.body || Object.keys(req.body).length === 0) {
    return next(new AppError('Request body cannot be empty', 400));
  }

  // 6. Update seller document
  const seller = await Seller.findByIdAndUpdate(
    req.user.id, // Ensure this matches your authentication setup
    { avatar: req.body.avatar },
    {
      new: true,
      runValidators: true,
      context: 'query', // Ensures validators run properly
    },
  );

  // 7. Handle case where seller not found
  if (!seller) {
    return next(new AppError('No seller found with that ID', 404));
  }

  // 8. Send response
  res.status(200).json({
    status: 'success',
    data: {
      seller,
      imageInfo: {
        url: result.secure_url,
        publicId: result.public_id,
      },
    },
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  console.log("body",req.body);
  let { name, email, phone, shopAddress, shopName, shopDescription, location, shopLocation, digitalAddress, socialMediaLinks, paymentMethods } = req.body;

  // Parse JSON strings if they exist (from FormData)
  // Support shopAddress, location (legacy), and shopLocation (new) for backward compatibility
  let addressData = shopLocation || location || shopAddress;
  if (typeof addressData === 'string') {
    try {
      addressData = JSON.parse(addressData);
    } catch (e) {
      addressData = undefined;
    }
  }
  if (typeof socialMediaLinks === 'string') {
    try {
      socialMediaLinks = JSON.parse(socialMediaLinks);
    } catch (e) {
      socialMediaLinks = undefined;
    }
  }
  // Parse paymentMethods if it's a string
  if (typeof paymentMethods === 'string') {
    try {
      paymentMethods = JSON.parse(paymentMethods);
    } catch (e) {
      paymentMethods = undefined;
    }
  }

  // Build update object
  const updateData = {};
  
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  // Phone: always update if provided (even if empty string, to allow clearing)
  if (phone !== undefined) {
    const trimmedPhone = phone ? phone.toString().trim() : '';
    if (trimmedPhone) {
      updateData.phone = trimmedPhone;
    } else {
      // Allow setting phone to empty string to clear it
      updateData.phone = '';
    }
  }
  if (shopName !== undefined) updateData.shopName = shopName;
  if (shopDescription !== undefined) updateData.shopDescription = shopDescription;
  if (digitalAddress !== undefined) updateData.digitalAddress = digitalAddress;
  
  console.log('[updateMe] Request body phone:', phone, 'Type:', typeof phone);
  console.log('[updateMe] Update data:', JSON.stringify(updateData, null, 2));
  console.log('[updateMe] Phone in updateData:', updateData.phone);
  
  // Update shopLocation (shop address) if provided
  if (addressData && typeof addressData === 'object') {
    // Normalize city to lowercase
    let normalizedCity = addressData.city;
    if (normalizedCity) {
      normalizedCity = normalizedCity.toLowerCase().trim();
    }
    
    // Normalize region to lowercase and handle "greater accra region" -> "greater accra"
    let normalizedRegion = addressData.region;
    if (normalizedRegion) {
      const normalizedRegionLower = normalizedRegion.toLowerCase().trim();
      if (normalizedRegionLower === 'greater accra region') {
        normalizedRegion = 'greater accra';
      } else {
        normalizedRegion = normalizedRegionLower;
      }
    }
    
    // Normalize country to lowercase
    let normalizedCountry = addressData.country || 'Ghana';
    if (normalizedCountry) {
      normalizedCountry = normalizedCountry.toLowerCase().trim();
    }
    
    // Normalize town to lowercase
    let normalizedTown = addressData.town;
    if (normalizedTown) {
      normalizedTown = normalizedTown.toLowerCase().trim();
    }
    
    // Normalize street to lowercase
    let normalizedStreet = addressData.street;
    if (normalizedStreet) {
      normalizedStreet = normalizedStreet.toLowerCase().trim();
    }
    
    updateData.shopLocation = {
      street: normalizedStreet || undefined,
      city: normalizedCity || undefined,
      town: normalizedTown || undefined,
      state: addressData.state || undefined,
      region: normalizedRegion || undefined,
      zipCode: addressData.zipCode || undefined,
      postalCode: addressData.postalCode || undefined,
      country: normalizedCountry,
    };
  }

  // Handle social media links
  if (socialMediaLinks && typeof socialMediaLinks === 'object') {
    updateData.socialMediaLinks = {
      facebook: socialMediaLinks.facebook || undefined,
      instagram: socialMediaLinks.instagram || undefined,
      twitter: socialMediaLinks.twitter || undefined,
      TikTok: socialMediaLinks.TikTok || undefined,
    };
  }

  // Handle payment methods update
  // Sellers can update their payment methods even when deactivated/rejected
  // The pre-save hook will automatically reset individual payment method payoutStatus to 'pending' if payment methods change
  if (paymentMethods && typeof paymentMethods === 'object') {
    const { bankAccount, mobileMoney } = paymentMethods;
    
    // Initialize paymentMethods object if not exists
    if (!updateData.paymentMethods) {
      updateData.paymentMethods = {};
    }
    
    // Clean and validate bank account data
    if (bankAccount !== undefined) {
      const hasBankData = bankAccount && (bankAccount.bankName || bankAccount.accountNumber || bankAccount.accountName);
      if (hasBankData) {
        // SECURITY: Check for duplicate bank account across all sellers (only if account number changed)
        if (bankAccount.accountNumber) {
          const normalizedAccountNumber = bankAccount.accountNumber.replace(/\s+/g, '').toLowerCase();
          const originalAccountNumber = (originalBankAccount?.accountNumber || '').replace(/\s+/g, '').toLowerCase();
          
          // Only check for duplicates if the account number is different from current
          if (normalizedAccountNumber !== originalAccountNumber) {
            const Seller = require('../../models/user/sellerModel');
            const otherSeller = await Seller.findOne({
              _id: { $ne: sellerId },
              'paymentMethods.bankAccount.accountNumber': { $exists: true },
            }).select('paymentMethods name shopName');
            
            if (otherSeller?.paymentMethods?.bankAccount?.accountNumber) {
              const otherAccountNumber = otherSeller.paymentMethods.bankAccount.accountNumber.replace(/\s+/g, '').toLowerCase();
              if (otherAccountNumber === normalizedAccountNumber) {
                return next(new AppError(
                  `This bank account number is already registered to another seller (${otherSeller.name || otherSeller.shopName}). Each seller must use a unique bank account.`,
                  400
                ));
              }
            }
          }
        }
        
        updateData.paymentMethods.bankAccount = {
          accountNumber: bankAccount.accountNumber || '',
          accountName: bankAccount.accountName || '',
          bankName: bankAccount.bankName || undefined,
          bankCode: bankAccount.bankCode || '',
          branch: bankAccount.branch || '',
        };
      } else {
        // If all bank fields are empty, remove bank account
        updateData.paymentMethods.bankAccount = undefined;
      }
    }
    
    // Clean and validate mobile money data
    if (mobileMoney !== undefined) {
      const hasMobileData = mobileMoney && (mobileMoney.phone || mobileMoney.network || mobileMoney.accountName);
      if (hasMobileData) {
        // SECURITY: Check for duplicate mobile money number across all sellers (only if phone changed)
        if (mobileMoney.phone) {
          const normalizedPhone = mobileMoney.phone.replace(/\D/g, '').toLowerCase();
          const originalPhone = (originalMobileMoney?.phone || '').replace(/\D/g, '').toLowerCase();
          
          // Only check for duplicates if the phone number is different from current
          if (normalizedPhone !== originalPhone) {
            const Seller = require('../../models/user/sellerModel');
            const otherSeller = await Seller.findOne({
              _id: { $ne: sellerId },
              'paymentMethods.mobileMoney.phone': { $exists: true },
            }).select('paymentMethods name shopName');
            
            if (otherSeller?.paymentMethods?.mobileMoney?.phone) {
              const otherPhone = otherSeller.paymentMethods.mobileMoney.phone.replace(/\D/g, '').toLowerCase();
              if (otherPhone === normalizedPhone) {
                return next(new AppError(
                  `This mobile money number is already registered to another seller (${otherSeller.name || otherSeller.shopName}). Each seller must use a unique mobile money number.`,
                  400
                ));
              }
            }
          }
        }
        
        updateData.paymentMethods.mobileMoney = {
          accountName: mobileMoney.accountName || '',
          phone: mobileMoney.phone || undefined,
          network: mobileMoney.network || undefined,
        };
      } else {
        // If all mobile fields are empty, remove mobile money
        updateData.paymentMethods.mobileMoney = undefined;
      }
    }
  }

  // Handle file uploads - files are already uploaded by middleware
  // URLs are stored in req.body.verificationDocuments by the cloudinaryUpload middleware
  // The middleware already maps addressProof to addresProof (model field name)
  if (req.body.verificationDocuments && typeof req.body.verificationDocuments === 'object') {
    // Initialize verificationDocuments if not already in updateData
    if (!updateData.verificationDocuments) {
      updateData.verificationDocuments = {};
    }

    // Copy all verification documents with new structure (url and status)
    // When a new document is uploaded, set status to 'pending'
    if (req.body.verificationDocuments.businessCert) {
      const url = typeof req.body.verificationDocuments.businessCert === 'string' 
        ? req.body.verificationDocuments.businessCert 
        : req.body.verificationDocuments.businessCert.url || req.body.verificationDocuments.businessCert;
      updateData.verificationDocuments.businessCert = {
        url: url,
        status: 'pending'
      };
    }
    if (req.body.verificationDocuments.idProof) {
      const url = typeof req.body.verificationDocuments.idProof === 'string' 
        ? req.body.verificationDocuments.idProof 
        : req.body.verificationDocuments.idProof.url || req.body.verificationDocuments.idProof;
      updateData.verificationDocuments.idProof = {
        url: url,
        status: 'pending'
      };
    }
    // Middleware maps addressProof to addresProof, so check for addresProof
    if (req.body.verificationDocuments.addresProof) {
      const url = typeof req.body.verificationDocuments.addresProof === 'string' 
        ? req.body.verificationDocuments.addresProof 
        : req.body.verificationDocuments.addresProof.url || req.body.verificationDocuments.addresProof;
      updateData.verificationDocuments.addresProof = {
        url: url,
        status: 'pending'
      };
    }
  }

  // Get current seller first
  const currentSeller = await Seller.findById(sellerId);
  if (!currentSeller) return next(new AppError('No seller found with that ID', 404));

  // Check if payment methods are being updated
  const isUpdatingPaymentMethods = updateData.paymentMethods !== undefined;
  
  // Store original payment methods for duplicate checking
  const originalBankAccount = currentSeller.paymentMethods?.bankAccount;
  const originalMobileMoney = currentSeller.paymentMethods?.mobileMoney;

  // If updating payment methods, we need to use save() to trigger pre-save hooks
  // which will reset individual payment method payoutStatus to 'pending' if details changed
  if (isUpdatingPaymentMethods) {
    // Update payment methods directly on the document
    if (updateData.paymentMethods.bankAccount !== undefined) {
      currentSeller.paymentMethods = currentSeller.paymentMethods || {};
      currentSeller.paymentMethods.bankAccount = updateData.paymentMethods.bankAccount;
    }
    if (updateData.paymentMethods.mobileMoney !== undefined) {
      currentSeller.paymentMethods = currentSeller.paymentMethods || {};
      currentSeller.paymentMethods.mobileMoney = updateData.paymentMethods.mobileMoney;
    }
    
    // Remove paymentMethods from updateData since we're handling it separately
    delete updateData.paymentMethods;
    
    // Update other fields
    Object.keys(updateData).forEach(key => {
      if (key !== 'paymentMethods') {
        currentSeller[key] = updateData[key];
      }
    });
    
    // Save to trigger pre-save hooks (which will reset payoutStatus if payment methods changed)
    await currentSeller.save({ validateBeforeSave: true });
    
    // Return updated seller
    const updatedSeller = await Seller.findById(sellerId);
    res.status(200).json({ status: 'success', data: { seller: updatedSeller } });
    return;
  }

  // Standard update for non-paymentMethods fields
  console.log('[updateMe] About to update seller with data:', JSON.stringify(updateData, null, 2));
  console.log('[updateMe] Phone field in updateData:', updateData.phone);
  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    updateData,
    {
      new: true,
      runValidators: true,
    },
  );
  if (!seller) return next(new AppError('No seller found with that ID', 404));
  
  console.log('[updateMe] Seller updated successfully. New phone value:', seller.phone);
  console.log('[updateMe] Full seller object phone:', JSON.stringify(seller.phone));

  // Auto-update onboarding if business info is complete
  const hasBusinessInfo =
    seller.shopName &&
    seller.shopLocation &&
    seller.shopLocation.city &&
    seller.shopDescription;

  if (hasBusinessInfo && !seller.requiredSetup.hasAddedBusinessInfo) {
    seller.requiredSetup.hasAddedBusinessInfo = true;
    
    // Check if all setup is complete (product not required for verification)
    const allSetupComplete =
      seller.requiredSetup.hasAddedBusinessInfo &&
      seller.requiredSetup.hasAddedBankDetails;

    if (allSetupComplete && seller.onboardingStage === 'profile_incomplete') {
      seller.onboardingStage = 'pending_verification';
    }
    
    await seller.save({ validateBeforeSave: false });
  }

  res.status(200).json({ status: 'success', data: { seller } });
});
exports.deleteMe = catchAsync(async (req, res, next) => {
  const seller = await Seller.findByIdAndUpdate(req.user.id, { active: false });
  if (!seller) return next(new AppError('No seller found with that ID', 404));
  res.status(204).json({ data: null, status: 'success' });
});
exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};
exports.sellerStatus = catchAsync(async (req, res, next) => {
  const seller = await Seller.findByIdAndUpdate(
    req.params.id,
    { status: req.body.newStatus },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!seller) return next(new AppError('No seller found with that ID', 404));
  logger.info('Updated seller:', seller);
  res.status(200).json({ status: 'success', data: { seller } });
});
exports.getPublicSeller = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return next(new AppError('No seller found with that ID', 404));
  res.status(200).json({ status: 'success', data: { seller } });
});
exports.getFeaturedSellers = catchAsync(async (req, res, next) => {
  // Get query parameters with defaults
  const limit = parseInt(req.query.limit) || 10;
  const minRating = parseFloat(req.query.minRating);
  const useMinRating = Number.isFinite(minRating) && minRating > 0;
  const productsPerSeller = parseInt(req.query.productsPerSeller) || 4; // Number of products to include per seller

  // Aggregate does not run Mongoose pre('find'), so we must filter active explicitly
  const matchStage = {
    $match: {
      active: { $ne: false },
      $or: [
        { status: 'active' },
        { status: 'pending' },
        { status: { $exists: false } },
      ],
    },
  };
  if (useMinRating) {
    matchStage.$match.$expr = {
      $gte: [{ $ifNull: [{ $toDouble: '$ratings.average' }, 0] }, minRating],
    };
  }

  // Fetch featured sellers: include active/pending sellers, sort by rating (best first)
  const sellers = await Seller.aggregate([
    matchStage,
    // Convert ratings to numbers for proper sorting
    {
      $addFields: {
        'ratings.average': { $ifNull: [{ $toDouble: '$ratings.average' }, 0] },
        'ratings.count': {
          $cond: [
            { $ifNull: ['$ratings.count', false] },
            { $toInt: '$ratings.count' },
            0,
          ],
        },
      },
    },
    { $sort: { 'ratings.average': -1, 'ratings.count': -1, createdAt: -1 } },
    { $limit: limit },
    // Lookup products for each seller
    {
      $lookup: {
        from: 'products',
        let: { sellerId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$seller', '$$sellerId'] },
                  { $eq: ['$status', 'active'] }, // Only include active products
                ],
              },
            },
          },
          { $limit: productsPerSeller },
          {
            $project: {
              name: 1,
              price: 1,
              images: 1,
              ratings: 1,
              slug: 1,
              category: 1,
            },
          },
        ],
        as: 'sellerProducts',
      },
    },
    // Project required fields
    {
      $project: {
        _id: 1,
        shopName: 1,
        avatar: 1,
        createdAt: 1,
        products: 1,
        productCount: 1,
        rating: '$ratings.average',
        reviewCount: '$ratings.count',
        sellerProducts: 1,
      },
    },
  ]);

  // Transform to final response format
  const transformedSellers = sellers.map((seller) => ({
    id: seller._id,
    shopName: seller.shopName,
    avatar: seller.avatar,
    joinedDate: seller.createdAt,
    rating: seller.rating,
    reviewCount: seller.reviewCount,
    productCount: seller.productCount,
    products: seller.sellerProducts.map((product) => ({
      id: product._id,
      name: product.name,
      price: product.price,
      images: product.images, // Default image if none exists
      rating: product.ratings?.average || 0,
      slug: product.slug,
      category: product.parentCategory,
    })),
  }));
  res.status(200).json({
    status: 'success',
    results: transformedSellers.length,
    data: {
      sellers: transformedSellers,
    },
  });
});

exports.getBestSellers = catchAsync(async (req, res, next) => {
  const SellerOrder = require('../../models/order/sellerOrderModel');
  
  // Get query parameters with defaults
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const sort = req.query.sort || 'orders';
  const skip = (page - 1) * limit;

  // First, try to get sellers with orders
  let sellersWithOrders = [];
  let total = 0;

  try {
    // Aggregate sellers by order count
    // Include all non-cancelled orders to count total orders per seller
    sellersWithOrders = await SellerOrder.aggregate([
      {
        $match: {
          status: { $nin: ['cancelled', 'returned'] }, // Count all non-cancelled orders
        },
      },
      {
        $group: {
          _id: '$seller',
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalBasePrice' },
        },
      },
      { $sort: { totalOrders: -1 } },
      {
        $lookup: {
          from: 'sellers',
          localField: '_id',
          foreignField: '_id',
          as: 'sellerInfo',
        },
      },
      {
        $match: {
          'sellerInfo': { $ne: [] }, // Only include sellers that exist
        },
      },
      { $unwind: '$sellerInfo' },
      {
        $match: {
          $or: [
            { 'sellerInfo.status': 'active' },
            { 'sellerInfo.status': { $exists: false } },
          ],
        },
      },
      {
        $project: {
          _id: '$sellerInfo._id',
          shopName: '$sellerInfo.shopName',
          name: '$sellerInfo.name',
          avatar: '$sellerInfo.avatar',
          location: '$sellerInfo.location',
          createdAt: '$sellerInfo.createdAt',
          totalOrders: 1,
          totalRevenue: 1,
          rating: { $ifNull: [{ $toDouble: '$sellerInfo.ratings.average' }, 0] },
          reviewCount: { $ifNull: [{ $toInt: '$sellerInfo.ratings.count' }, 0] },
        },
      },
      { $sort: sort === 'orders' ? { totalOrders: -1 } : { rating: -1 } },
      {
        $facet: {
          sellers: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    const sellers = sellersWithOrders[0]?.sellers || [];
    total = sellersWithOrders[0]?.total[0]?.count || 0;

    logger.info('[getBestSellers] Sellers with orders:', sellers.length, 'Total:', total);

    // If we have sellers with orders, use them
    if (sellers.length > 0) {
      const transformedSellers = sellers.map((seller) => ({
        _id: seller._id,
        id: seller._id,
        shopName: seller.shopName || seller.name,
        name: seller.name,
        avatar: seller.avatar,
        location: seller.location,
        totalOrders: seller.totalOrders || 0,
        orderCount: seller.totalOrders || 0,
        ordersCount: seller.totalOrders || 0,
        totalRevenue: seller.totalRevenue || 0,
        rating: seller.rating || 0,
        averageRating: seller.rating || 0,
        reviewCount: seller.reviewCount || 0,
        reviewsCount: seller.reviewCount || 0,
        createdAt: seller.createdAt,
      }));

      return res.status(200).json({
        status: 'success',
        data: {
          sellers: transformedSellers,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  } catch (aggError) {
    logger.error('[getBestSellers] Aggregation error:', aggError);
  }

  // Fallback: Get all active sellers if no orders found
  logger.info('[getBestSellers] No sellers with orders found, falling back to all active sellers');
  try {
    const allSellers = await Seller.find({
      $or: [
        { status: 'active' },
        { status: { $exists: false } },
      ],
    })
      .select('_id shopName name avatar location createdAt ratings')
      .sort(sort === 'orders' ? { createdAt: -1 } : { 'ratings.average': -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalSellers = await Seller.countDocuments({
      $or: [
        { status: 'active' },
        { status: { $exists: false } },
      ],
    });

    logger.info('[getBestSellers] Found active sellers:', allSellers.length, 'Total:', totalSellers);

    const transformedSellers = allSellers.map((seller) => ({
      _id: seller._id,
      id: seller._id,
      shopName: seller.shopName || seller.name,
      name: seller.name,
      avatar: seller.avatar,
      location: seller.location,
      totalOrders: 0,
      orderCount: 0,
      ordersCount: 0,
      totalRevenue: 0,
      rating: seller.ratings?.average ? parseFloat(seller.ratings.average) : 0,
      averageRating: seller.ratings?.average ? parseFloat(seller.ratings.average) : 0,
      reviewCount: seller.ratings?.count ? parseInt(seller.ratings.count) : 0,
      reviewsCount: seller.ratings?.count ? parseInt(seller.ratings.count) : 0,
      createdAt: seller.createdAt,
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        sellers: transformedSellers,
        total: totalSellers,
        page,
        limit,
        totalPages: Math.ceil(totalSellers / limit),
      },
    });
  } catch (fallbackError) {
    logger.error('[getBestSellers] Fallback error:', fallbackError);
    return next(new AppError('Failed to fetch sellers', 500));
  }
});
// export const getFeaturedSellers = catchAsync(async (req, res, next) => {
//   // Get query parameters with defaults
//   const limit = parseInt(req.query.limit) || 10;
//   const minRating = parseFloat(req.query.minRating) || 4.0;

//   // Fetch featured sellers from database with flexible filtering
//   const sellers = await Seller.aggregate([
//     {
//       $match: {
//         // Handle missing status field
//         $or: [
//           { status: 'active' },
//           { status: { $exists: false } }, // Include documents without status field
//         ],
//         // Convert string ratings to numbers for comparison
//         $expr: {
//           $gte: [
//             { $toDouble: '$ratings.average' }, // Convert string to number
//             minRating,
//           ],
//         },
//       },
//     },
//     // Convert ratings to numbers for proper sorting
//     {
//       $addFields: {
//         'ratings.average': { $toDouble: '$ratings.average' },
//         'ratings.count': {
//           $cond: [
//             { $ifNull: ['$ratings.count', false] },
//             { $toInt: '$ratings.count' },
//             0, // Default to 0 if missing
//           ],
//         },
//       },
//     },
//     // Sort by the converted numeric values
//     { $sort: { 'ratings.average': -1, 'ratings.count': -1 } },
//     { $limit: limit },
//     // Project required fields
//     {
//       $project: {
//         _id: 1,
//         shopName: 1,
//         avatar: 1,
//         createdAt: 1,
//         products: 1,
//         productCount: 1,
//         rating: '$ratings.average',
//         reviewCount: '$ratings.count',
//       },
//     },
//   ]);
//   logger.info(sellers);

//   // Transform to final response format
//   const transformedSellers = sellers.map((seller) => ({
//     id: seller._id,
//     shopName: seller.shopName,
//     avatar: seller.avatar,
//     joinedDate: seller.createdAt,
//     rating: seller.rating,
//     reviewCount: seller.reviewCount,
//     productCount: seller.productCount,
//     products: seller.products,
//   }));
//   res.status(200).json({
//     status: 'success',
//     results: transformedSellers.length,
//     data: {
//       sellers: transformedSellers,
//     },
//   });
// });
exports.getMySellerProfile = catchAsync(async (req, res, next) => {
  // req.user is set by auth middleware
  const seller = await Seller.findById(req.user.id)
    .select('-__v -passwordChangedAt')
    .lean();

  if (!seller) return next(new AppError('Seller not found', 404));

  // Transform data
  const result = {
    ...seller,
    rating: seller.ratings?.average ? parseFloat(seller.ratings.average) : 0,
    reviewCount: seller.ratings?.count ? parseInt(seller.ratings.count) : 0,
    joinedDate: seller.createdAt,
  };

  delete result.ratings;
  delete result.createdAt;
  delete result.password;

  res.status(200).json({
    status: 'success',
    data: { seller: result },
  });
});
// Override getAllSeller to include balance fields and verification status
exports.getAllSeller = catchAsync(async (req, res, next) => {
  let filter = {};
  
  // Search filter
  if (req.query.search) {
    const search = req.query.search;
    filter = {
      ...filter,
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { shopName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ],
    };
  }
  
  // Verification status filter
  if (req.query.verificationStatus) {
    filter.verificationStatus = req.query.verificationStatus;
  }
  
  // Onboarding stage filter
  if (req.query.onboardingStage) {
    filter.onboardingStage = req.query.onboardingStage;
  }

  // Build select fields - include verification status fields for admin UI
  const selectFields = 'name shopName email balance lockedBalance pendingBalance withdrawableBalance status role createdAt lastLogin verificationStatus onboardingStage verifiedBy verifiedAt verificationDocuments';
  
  let query = Seller.find(filter).select(selectFields);

  const features = new APIFeature(query, req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const results = await features.query;
  
  // Calculate withdrawableBalance for each seller
  results.forEach(seller => {
    seller.calculateWithdrawableBalance();
  });

  // Get order counts for all sellers
  const SellerOrder = require('../../models/order/sellerOrderModel');
  const sellerIds = results.map(seller => seller._id);
  
  // Aggregate order counts per seller
  const orderCounts = await SellerOrder.aggregate([
    {
      $match: {
        seller: { $in: sellerIds }
      }
    },
    {
      $group: {
        _id: '$seller',
        orderCount: { $sum: 1 }
      }
    }
  ]);

  // Create a map of sellerId -> orderCount
  const orderCountMap = {};
  orderCounts.forEach(item => {
    orderCountMap[item._id.toString()] = item.orderCount;
  });

  // Add orderCount to each seller result
  const resultsWithOrderCount = results.map(seller => {
    const sellerDoc = seller.toObject ? seller.toObject() : seller;
    sellerDoc.orderCount = orderCountMap[seller._id.toString()] || 0;
    return sellerDoc;
  });

  const meta = await features.getMeta();

  res.status(200).json({
    status: 'success',
    results: resultsWithOrderCount.length,
    meta,
    data: {
      results: resultsWithOrderCount,
    },
  });
});
// Override getSeller to include computed isSetupComplete field
exports.getSeller = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid ID format', 400));
  }

  const id = req.params.id;
  let seller = await Seller.findById(id)
    .populate({
      path: 'verifiedBy',
      select: 'name email',
    })
    .select('+verificationDocuments +paymentMethods +active'); // Include fields needed for isSetupComplete and admin reactivate UI

  // If not found (seller may be deactivated: active=false), allow admin to fetch for order detail / reactivate
  if (!seller && ['admin', 'superadmin', 'moderator'].includes(req.user?.role)) {
    const docs = await Seller.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      { $project: { name: 1, email: 1, shopName: 1, active: 1, status: 1 } },
    ]);
    if (docs.length > 0) seller = docs[0];
  }

  if (!seller) {
    return next(new AppError('Seller with this ID is not found', 404));
  }

  const isAggregateResult = seller && !seller.toObject && !seller.computeIsSetupComplete;
  const sellerData = isAggregateResult
    ? {
        _id: seller._id?.toString ? seller._id.toString() : seller._id,
        name: seller.name,
        email: seller.email,
        shopName: seller.shopName,
        active: seller.active,
        status: seller.status,
      }
    : (seller.toObject ? seller.toObject() : seller);

  if (!isAggregateResult) {
    sellerData.isSetupComplete = seller.computeIsSetupComplete();
  } else {
    sellerData.isSetupComplete = false;
  }

  // Log response for debugging (production)
  if (process.env.NODE_ENV === 'production') {
    logger.info('[getSeller] Sending seller data response', {
      sellerId: sellerData._id || sellerData.id,
      hasData: !!sellerData,
      isSetupComplete: sellerData.isSetupComplete,
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      data: sellerData,
      isSetupComplete: sellerData.isSetupComplete,
    },
  });
});

/**
 * Admin: Reactivate a seller (set active: true).
 * Uses updateOne so the pre('find') hook does not filter out inactive sellers.
 */
exports.reactivateSeller = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError('Invalid seller ID', 400));
  }
  const result = await Seller.updateOne(
    { _id: id },
    { $set: { active: true } }
  );
  if (!result.matchedCount) {
    return next(new AppError('Seller not found', 404));
  }
  const seller = await Seller.findById(id)
    .select('+verificationDocuments +paymentMethods +active')
    .populate({ path: 'verifiedBy', select: 'name email' });
  res.status(200).json({
    status: 'success',
    data: { doc: seller },
  });
});

exports.updateSeller = handleFactory.updateOne(Seller);
exports.deleteSeller = handleFactory.deleteOne(Seller);
