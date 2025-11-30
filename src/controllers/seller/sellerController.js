const Seller = require('../../models/user/sellerModel');
const handleFactory = require('../shared/handleFactory');
const catchAsync = require('../../utils/helpers/catchAsync');
const stream = require('stream');
const Product = require('../../models/product/productModel');
const APIFeature = require('../../utils/helpers/apiFeatures');
const AppError = require('../../utils/errors/appError');
const multer = require('multer');
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

  const sellerProducts = await features.query.populate({
    path: 'parentCategory subCategory',
    select: 'name slug',
  });

  if (!sellerProducts) {
    return next(new AppError('No product found on this Seller Id', 400));
  }

  res.status(200).json({
    status: 'success',
    result: sellerProducts.length,
    data: {
      data: sellerProducts,
    },
  });
});
exports.getSellerProductById = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }
  res.status(200).json({ status: 'success', data: { product } });
});
exports.SellerDeleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }
  res.status(200).json({ status: 'success', data: { product } });
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
  let { name, email, phone, shopAddress, shopName, shopDescription, location, shopLocation, digitalAddress, socialMediaLinks } = req.body;

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

  // Build update object
  const updateData = {};
  
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  if (shopName !== undefined) updateData.shopName = shopName;
  if (shopDescription !== undefined) updateData.shopDescription = shopDescription;
  if (digitalAddress !== undefined) updateData.digitalAddress = digitalAddress;
  
  // Update shopLocation (shop address) if provided
  if (addressData && typeof addressData === 'object') {
    updateData.shopLocation = {
      street: addressData.street || undefined,
      city: addressData.city || undefined,
      town: addressData.town || undefined,
      state: addressData.state || undefined,
      region: addressData.region || undefined,
      zipCode: addressData.zipCode || undefined,
      postalCode: addressData.postalCode || undefined,
      country: addressData.country || 'Ghana',
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

  // Update seller
  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    updateData,
    {
      new: true,
      runValidators: true,
    },
  );
  if (!seller) return next(new AppError('No seller found with that ID', 404));

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
  console.log('Updated seller:', seller);
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
  const minRating = parseFloat(req.query.minRating) || 4.0;
  const productsPerSeller = parseInt(req.query.productsPerSeller) || 4; // Number of products to include per seller

  // Fetch featured sellers from database with flexible filtering
  const sellers = await Seller.aggregate([
    {
      $match: {
        // Handle missing status field
        $or: [
          { status: 'active' },
          { status: { $exists: false } }, // Include documents without status field
        ],
        // Convert string ratings to numbers for comparison
        $expr: {
          $gte: [
            { $toDouble: '$ratings.average' }, // Convert string to number
            minRating,
          ],
        },
      },
    },
    // Convert ratings to numbers for proper sorting
    {
      $addFields: {
        'ratings.average': { $toDouble: '$ratings.average' },
        'ratings.count': {
          $cond: [
            { $ifNull: ['$ratings.count', false] },
            { $toInt: '$ratings.count' },
            0, // Default to 0 if missing
          ],
        },
      },
    },
    // Sort by the converted numeric values
    { $sort: { 'ratings.average': -1, 'ratings.count': -1 } },
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
  console.log('transformedSellers', transformedSellers);
  res.status(200).json({
    status: 'success',
    results: transformedSellers.length,
    data: {
      sellers: transformedSellers,
    },
  });
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
//   console.log(sellers);

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
// Override getAllSeller to include balance fields
exports.getAllSeller = catchAsync(async (req, res, next) => {
  let filter = {};
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

  let query = Seller.find(filter).select('name shopName email balance lockedBalance pendingBalance withdrawableBalance status role createdAt lastLogin');

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

  const meta = await features.getMeta();

  res.status(200).json({
    status: 'success',
    results: results.length,
    meta,
    data: {
      results,
    },
  });
});
exports.getSeller = handleFactory.getOne(Seller, {
  path: 'verifiedBy',
  select: 'name email',
});
exports.updateSeller = handleFactory.updateOne(Seller);
exports.deleteSeller = handleFactory.deleteOne(Seller);
