const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');
const multer = require('multer');
const stream = require('stream');
const Review = require('../../models/product/reviewModel');
const Product = require('../../models/product/productModel');
const Category = require('../../models/category/categoryModel');
const Seller = require('../../models/user/sellerModel');
const handleFactory = require('../shared/handleFactory');
const APIFeature = require('../../utils/helpers/apiFeatures');

//product middleWare
exports.setProductIds = (req, res, next) => {
  if (!req.body.seller) req.body.seller = req.user.id;

  // If admin is creating an EazShop product, set seller to EazShop seller ID
  const EAZSHOP_SELLER_ID = '000000000000000000000001';
  if (req.user.role === 'admin' && req.body.isEazShopProduct === true) {
    req.body.seller = EAZSHOP_SELLER_ID;
    req.body.isEazShopProduct = true;
  }

  // Set moderation status: pending for sellers, approved for admins
  if (req.user.role === 'seller' && !req.body.moderationStatus) {
    req.body.moderationStatus = 'pending';
  } else if (req.user.role === 'admin' && !req.body.moderationStatus) {
    req.body.moderationStatus = 'approved';
  }

  next();
};

//Create product by seller
const multerStorage = multer.memoryStorage();
const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload an image', 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
exports.conditionalUpload = (req, res, next) => {
  // console.log(req.headers['content-type']);
  // Check if files are present in the request
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    return upload.fields([
      { name: 'imageCover', maxCount: 1 },
      { name: 'newImages', maxCount: 10 },
    ])(req, res, next);
  }
  next();
};

exports.uploadProductImage = upload.fields([
  { name: 'imageCover', maxCount: 1 },
  { name: 'newImages', maxCount: 10 },
]);

exports.resizeProductImages = catchAsync(async (req, res, next) => {
  // console.log(req);
  req.body = { ...req.body };
  req.files = { ...req.files };
  console.log('req.files', req.files);
  let parseExistingImages = [];
  let imagesUrls = [];
  try {
    const cloudinary = req.app.get('cloudinary');
    // console.log('cloudinary', cloudinary);
    if (req.files) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);

      const uploadFromBuffer = (buffer, options) => {
        return new Promise((resolve, reject) => {
          const writeStream = cloudinary.uploader.upload_stream(
            options,
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          );

          const bufferStream = new stream.PassThrough();
          bufferStream.end(buffer);
          bufferStream.pipe(writeStream);
        });
      };
      if (req.files.imageCover) {
        const coverFile = req.files.imageCover[0];
        // Process cover image
        const coverResult = await uploadFromBuffer(coverFile.buffer, {
          folder: 'products',
          public_id: `${uniqueSuffix}-cover`,
          transformation: [
            { width: 2000, height: 1333, crop: 'scale' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        });

        req.body.imageCover = coverResult.secure_url;
        console.log('Cover image URL:', req.body.imageCover);
      }

      if (req.files.newImages) {
        const newImages = req.files.newImages;

        const imagesPromises = newImages.map(async (file, i) => {
          const result = await uploadFromBuffer(file.buffer, {
            folder: 'products',
            public_id: `${uniqueSuffix}-image-${i}`,
            transformation: [
              { width: 1000, height: 667, crop: 'fill' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          });
          return result.secure_url;
        });

        imagesUrls = await Promise.all(imagesPromises);
      }

      if (req.body.existingImages) {
        parseExistingImages = JSON.parse(req.body.existingImages);
        delete req.body.existingImages; // Remove from request body
      }

      req.body.images = [...parseExistingImages, ...imagesUrls];
      console.log('All images:', req.body);
    }
  } catch (err) {
    console.log(err.message);
  }

  next();
});

//public route for best product price
exports.bestProductPrice = async () => {
  req.query.limit = '5';
  req.query.sort = '-rating,price';
  req.query.fields = 'name,price, description';
  next();
};
//get product count by category
exports.getProductCountByCategory = catchAsync(async (req, res, next) => {
  const productCounts = await Product.aggregate([
    {
      $group: {
        _id: {
          parentCategory: '$parentCategory',
          subCategory: '$subCategory',
        },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: '_id.parentCategory',
        foreignField: '_id',
        as: 'parentCategoryInfo',
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: '_id.subCategory',
        foreignField: '_id',
        as: 'subCategoryInfo',
      },
    },
    {
      $project: {
        _id: 0,
        parentCategory: { $arrayElemAt: ['$parentCategoryInfo.name', 0] },
        subCategory: { $arrayElemAt: ['$subCategoryInfo.name', 0] },
        count: 1,
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      productCounts,
    },
  });
});
exports.getAllPublicProductsBySeller = catchAsync(async (req, res, next) => {
  const sellerId = req.params.sellerId;
  console.log('🔍 [getAllPublicProductsBySeller] Seller ID:', sellerId);

  // First, check if seller has any products at all (regardless of status)
  const allProducts = await Product.find({ seller: sellerId });
  console.log('🔍 [getAllPublicProductsBySeller] Total products for seller (all statuses):', allProducts.length);
  if (allProducts.length > 0) {
    console.log('🔍 [getAllPublicProductsBySeller] All product statuses:', allProducts.map(p => ({
      id: p._id,
      name: p.name,
      moderationStatus: p.moderationStatus,
      status: p.status
    })));
  }

  // Show approved and pending products (not rejected or inactive)
  // This allows sellers to see their pending products on their public page
  // Status can be: 'active', 'inactive', 'draft', 'out_of_stock'
  // We want to show active and out_of_stock products (not inactive or draft)
  const products = await Product.find({
    seller: sellerId,
    moderationStatus: { $in: ['approved', 'pending'] },
    status: { $in: ['active', 'out_of_stock'] }
  }).populate('parentCategory', 'name slug').populate('subCategory', 'name slug');

  console.log('🔍 [getAllPublicProductsBySeller] Found approved/pending products:', products.length);
  console.log('🔍 [getAllPublicProductsBySeller] Query filter:', {
    seller: sellerId,
    moderationStatus: { $in: ['approved', 'pending'] },
    status: { $in: ['active', 'out_of_stock'] }
  });
  if (products.length > 0) {
    console.log('🔍 [getAllPublicProductsBySeller] Products:', products.map(p => ({
      id: p._id,
      name: p.name,
      moderationStatus: p.moderationStatus,
      status: p.status
    })));
  } else if (allProducts.length > 0) {
    console.log('⚠️ [getAllPublicProductsBySeller] Seller has products but none are approved/pending. Showing all active products instead.');
    // If seller has products but none are approved/pending, show all active products
    // This includes rejected products so seller can see them on their page
    const activeProducts = await Product.find({
      seller: sellerId,
      status: { $in: ['active', 'out_of_stock'] }
    }).populate('parentCategory', 'name slug').populate('subCategory', 'name slug');

    console.log('🔍 [getAllPublicProductsBySeller] Active products (including rejected):', activeProducts.length);
    if (activeProducts.length > 0) {
      console.log('🔍 [getAllPublicProductsBySeller] Active product statuses:', activeProducts.map(p => ({
        id: p._id,
        name: p.name,
        moderationStatus: p.moderationStatus,
        status: p.status
      })));
    }
    const fallbackResponse = { status: 'success', data: { products: activeProducts } };
    console.log("🔍 [getAllPublicProductsBySeller] Fallback response structure:", {
      status: fallbackResponse.status,
      hasData: !!fallbackResponse.data,
      hasProducts: !!fallbackResponse.data.products,
      productsLength: fallbackResponse.data.products?.length,
      productsIsArray: Array.isArray(fallbackResponse.data.products)
    });
    res.status(200).json(fallbackResponse);
    return;
  }
  console.log("🔍 [getAllPublicProductsBySeller] Final products to return:", products.length);
  console.log("🔍 [getAllPublicProductsBySeller] Products array type:", Array.isArray(products));
  console.log("🔍 [getAllPublicProductsBySeller] First product sample:", products[0] ? { id: products[0]._id, name: products[0].name } : 'none');

  // Don't return error if no products - just return empty array
  const response = { status: 'success', data: { products } };
  console.log("🔍 [getAllPublicProductsBySeller] Response structure:", {
    status: response.status,
    hasData: !!response.data,
    hasProducts: !!response.data.products,
    productsLength: response.data.products?.length,
    productsIsArray: Array.isArray(response.data.products)
  });

  res.status(200).json(response);
});

//getting all products by admin
exports.getAllProduct = catchAsync(async (req, res, next) => {
  // Build base filter
  let filter = {};

  // For non-admin users (public access), only show approved products
  if (!req.user || req.user.role !== 'admin') {
    filter.moderationStatus = 'approved';
    filter.status = { $ne: 'inactive' };
  }
  // Admins can see all products (including pending/rejected)
  // Sellers can see their own products regardless of moderation status (handled via filter)

  // Build query with filter
  let query = Product.find(filter);

  // Apply API features (filtering, sorting, pagination)
  const features = new APIFeature(query, req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // Populate related fields
  features.query = features.query.populate([
    { path: 'seller', select: 'name email phone shopName' },
    { path: 'parentCategory', select: 'name slug' },
    { path: 'subCategory', select: 'name slug' },
  ]);

  const products = await features.query;

  // Get total count for pagination (apply same filter)
  const countQuery = Product.find(filter);
  const countFeatures = new APIFeature(countQuery, req.query).filter();
  const total = await countFeatures.query.countDocuments();

  res.status(200).json({
    status: 'success',
    results: products.length,
    total,
    data: {
      data: products,
    },
  });
});

function calculateAverage(reviews) {
  if (reviews.length === 0) return 0;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return total / reviews.length;
}

//get product reviews
exports.getProductReviews = catchAsync(async (req, res, next) => {
  const { id: productId } = req.params;

  // Check if productId exists and is not empty
  if (!productId || productId === 'undefined' || productId === 'null') {
    return next(new AppError('Product ID is required', 400));
  }

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError(`Invalid product ID format: ${productId}`, 400));
  }

  try {
    const productExists = await Product.exists({ _id: productId });
    if (!productExists) {
      return next(new AppError('Product not found', 404));
    }
    // Show approved reviews to public, or all reviews if admin
    // Also show pending reviews to the user who created them
    let statusFilter = {};
    if (req.user && req.user.role === 'admin') {
      // Admin sees all reviews
      statusFilter = {};
    } else if (req.user) {
      // Authenticated users see approved reviews, or their own pending reviews
      statusFilter = {
        $or: [
          { status: 'approved' },
          { status: 'pending', user: mongoose.Types.ObjectId(req.user.id) }
        ]
      };
    } else {
      // Anonymous users only see approved reviews
      statusFilter = { status: 'approved' };
    }

    const reviews = await Review.find({
      product: productId,
      ...statusFilter
    })
      .populate({
        path: 'user',
        select: 'name photo',
      })
      .populate({
        path: 'sellerReply.repliedBy',
        select: 'shopName',
      })
      .sort({ createdAt: -1 })
      .lean();

    // Debug logging
    console.log(`[getProductReviews] Product ID: ${productId}`);
    console.log(`[getProductReviews] User: ${req.user?.id || 'anonymous'}, Role: ${req.user?.role || 'none'}`);
    console.log(`[getProductReviews] Status filter:`, statusFilter);
    console.log(`[getProductReviews] Found ${reviews.length} reviews`);

    res.status(200).json({
      success: true,
      data: {
        count: reviews.length,
        reviews, // Directly return reviews array
        averageRating: calculateAverage(reviews), // Optional
      },
    });
  } catch (error) {
    console.error('Error fetching product reviews:', error);
    res.status(500).json({ error: 'Server error while retrieving reviews' });
  }
});

exports.getProduct = handleFactory.getOne(Product, [
  { path: 'reviews', populate: { path: 'user', select: 'name photo' } },
  { path: 'parentCategory', select: 'id name slug' },
  { path: 'subCategory', select: 'name slug' },
  { path: 'seller', select: 'name email shopName avatar location' },
]);

exports.getProductById = catchAsync(async (req, res, next) => {
  const productId = new mongoose.Types.ObjectId(req.params.id);


  console.log('productId', productId);

  // Fetch product with seller populated, but also get raw seller ID
  const product = await Product.findById(productId)
    .populate({
      path: 'parentCategory',
      select: 'name slug',
    })
    .populate({
      path: 'seller',
      select: '_id',
    })
    .lean(); // Use lean() to get plain object for easier ID access

  if (!product) {
    console.log('[getProductById] Product not found in database:', productId);
    return next(new AppError('Product not found', 404));
  }

  // Get seller ID from product - handle both populated and unpopulated cases
  // If populated, seller will be an object with _id
  // If not populated, seller will be an ObjectId or string
  let productSellerId = null;
  if (product.seller) {
    if (product.seller._id) {
      productSellerId = product.seller._id.toString();
    } else if (product.seller.toString) {
      productSellerId = product.seller.toString();
    } else if (typeof product.seller === 'string') {
      productSellerId = product.seller;
    }
  }

  console.log('[getProductById] Product found:', {
    productId: product._id,
    moderationStatus: product.moderationStatus,
    sellerId: productSellerId,
    sellerType: typeof product.seller,
    sellerIsObject: typeof product.seller === 'object',
    sellerIsString: typeof product.seller === 'string'
  });

  // Access control logic:
  // 1. Admins can see all products
  // 2. Sellers can see their own products regardless of moderation status
  // 3. Everyone else (including unauthenticated) can only see approved products

  const isAdmin = req.user && req.user.role === 'admin';

  // Normalize moderationStatus - handle undefined/null
  // If undefined, treat as potentially visible (might be legacy product without moderation)
  const moderationStatus = product.moderationStatus;
  const isApproved = moderationStatus === 'approved';
  const isRejected = moderationStatus === 'rejected';
  const isPending = moderationStatus === 'pending';
  const isUndefined = moderationStatus === undefined || moderationStatus === null;

  // Allow access if: approved OR (undefined and not rejected) - undefined might be legacy products
  const canAccess = isApproved || (isUndefined && !isRejected);

  if (!isAdmin) {
    // Check if seller owns this product
    // Also check if user might be a seller (even if role shows as 'user')
    let isSellerOwnProduct = false;

    if (req.user && productSellerId) {
      // Get user ID - handle both req.user.id and req.user._id
      let userIdStr = null;
      if (req.user.id) {
        userIdStr = req.user.id.toString();
      } else if (req.user._id) {
        userIdStr = req.user._id.toString();
      }

      // Check if user ID matches seller ID (regardless of role - in case role detection is wrong)
      const isOwner = productSellerId === userIdStr;
      const isSellerRole = req.user.role === 'seller';

      // Seller owns product if IDs match (role check is secondary)
      isSellerOwnProduct = isOwner;

      console.log('[getProductById] Seller ownership check:', {
        productSellerId: productSellerId,
        userIdStr: userIdStr,
        userRole: req.user.role,
        isSellerRole: isSellerRole,
        isOwner: isOwner,
        isSellerOwnProduct: isSellerOwnProduct,
        productModerationStatus: moderationStatus,
        isApproved: isApproved,
        isUndefined: isUndefined,
        canAccess: canAccess,
        comparison: `${productSellerId} === ${userIdStr}`
      });
    }

    // If not seller's own product and cannot access (not approved and not undefined), deny access
    if (!isSellerOwnProduct && !canAccess) {
      console.log('[getProductById] ❌ Access denied:', {
        productId: productId,
        productModerationStatus: moderationStatus,
        originalModerationStatus: product.moderationStatus,
        userRole: req.user?.role,
        userId: req.user?.id || req.user?._id,
        productSellerId: productSellerId,
        isSellerOwnProduct: isSellerOwnProduct,
        isApproved: isApproved,
        hasUser: !!req.user,
        reason: !isSellerOwnProduct ? 'Not seller\'s product' : 'Product not approved'
      });
      return next(new AppError('Product not found or not available', 404));
    }

    console.log('[getProductById] ✅ Access granted');
  } else {
    console.log('[getProductById] ✅ Admin access - granted');
  }

  // Fetch product again as mongoose document for proper response (with all populated fields)
  const productResponse = await Product.findById(productId)
    .populate({
      path: 'parentCategory',
      select: 'name slug',
    })
    .populate({
      path: 'seller',
      select: '_id',
    });

  res.status(200).json({
    status: 'success',
    data: { product: productResponse },
  });
});

exports.getProductsByCategory = catchAsync(async (req, res, next) => {
  const categoryId = req.params.categoryId;

  if (!categoryId) {
    return next(new AppError('Category ID is required', 400));
  }

  // 1. Get category and its subcategories
  const category =
    await Category.findById(categoryId).populate('subcategories');
  if (!category) {
    return next(new AppError('No category found with that ID', 404));
  }

  // 2. Build base query
  const baseQuery = {
    parentCategory: categoryId, // Use string ID directly
  };

  // 3. Handle subcategory filtering
  if (req.query?.subcategories) {
    let selectedSubs = [];
    if (Array.isArray(req.query.subcategories)) {
      selectedSubs = req.query.subcategories;
    } else if (typeof req.query.subcategories === 'string') {
      selectedSubs = req.query.subcategories.split(',');
    }
    const validSubs = selectedSubs.filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );

    if (validSubs.length > 0) {
      baseQuery.subCategory = { $in: validSubs };
    }
  }

  // 4. Handle price filtering
  if (req.query.minPrice || req.query.maxPrice) {
    baseQuery.price = {};
    if (req.query.minPrice) baseQuery.price.$gte = Number(req.query.minPrice);
    if (req.query.maxPrice) baseQuery.price.$lte = Number(req.query.maxPrice);
  }

  const products = await Product.find(baseQuery);
  // console.log(products);
  // console.log(products);
  // 5. Execute query
  // const features = new APIFeatures(Product.find(baseQuery), req.query)
  //   .filter()
  //   .sort()
  //   .limitFields()
  //   .paginate();

  // const products = await features.query;
  // console.log(products);
  const totalCount = await Product.countDocuments(baseQuery);
  // console.log(products);
  // 6. Send response
  res.status(200).json({
    status: 'success',
    results: products.length,
    totalCount,
    // page: req.query.page ? parseInt(req.query.page) : 1,
    // limit: req.query.limit ? parseInt(req.query.limit) : 10,
    data: {
      category: {
        _id: category._id,
        subcategories: category.subcategories || [],
        name: category.name,
        slug: category.slug,
      },
      products,
    },
  });
});
// Custom createProduct with onboarding auto-update
exports.createProduct = catchAsync(async (req, res, next) => {
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

  // Use handleFactory to create product
  const createOneHandler = handleFactory.createOne(Product);

  // Store original json method
  const originalJson = res.json.bind(res);
  let productCreated = false;
  let createdProduct = null;

  // Override res.json to intercept response
  res.json = function (data) {
    productCreated = true;
    if (data?.data?.data) {
      createdProduct = data.data.data;
    } else if (data?.data) {
      createdProduct = data.data;
    }
    originalJson(data);
  };

  // Call the factory handler
  await createOneHandler(req, res, next);

  // Log activity and update onboarding (async, don't block response)
  if (productCreated && req.user && req.user.role === 'seller') {
    setImmediate(async () => {
      try {
        // Log activity
        if (createdProduct) {
          logActivityAsync({
            userId: req.user.id,
            role: 'seller',
            action: 'CREATE_PRODUCT',
            description: `Seller created product: ${createdProduct.name || 'Unknown'}`,
            req,
            metadata: { productId: createdProduct._id },
          });

          // Notify all admins about new product creation
          try {
            const notificationService = require('../../services/notification/notificationService');
            const seller = await Seller.findById(req.user.id).select('shopName name');
            await notificationService.createProductCreationNotification(
              createdProduct._id,
              createdProduct.name,
              req.user.id,
              seller?.shopName || seller?.name || 'Seller'
            );
            console.log(`[Product Creation] Admin notification created for product ${createdProduct._id}`);
          } catch (notificationError) {
            console.error('[Product Creation] Error creating admin notification:', notificationError);
            // Don't fail product creation if notification fails
          }
        }

        const seller = await Seller.findById(req.user.id);
        if (seller) {
          // Check if this is seller's first product
          const productCount = await Product.countDocuments({ seller: seller._id });

          if (productCount > 0 && !seller.requiredSetup.hasAddedFirstProduct) {
            seller.requiredSetup.hasAddedFirstProduct = true;

            // Note: Product is tracked but not required for verification
            // Sellers can add products without being verified
            // Only update onboarding stage if business info and bank details are complete
            const allSetupComplete =
              seller.requiredSetup.hasAddedBusinessInfo &&
              seller.requiredSetup.hasAddedBankDetails;

            if (allSetupComplete && seller.onboardingStage === 'profile_incomplete') {
              seller.onboardingStage = 'pending_verification';
            }

            await seller.save({ validateBeforeSave: false });
            console.log('[Product] Seller onboarding updated after product creation');
          }
        }
      } catch (onboardingError) {
        // Don't fail product creation if onboarding update fails
        console.error('[Product] Error updating onboarding:', onboardingError);
      }
    });
  }
});
// Wrapper for updateProduct with activity logging
exports.updateProduct = catchAsync(async (req, res, next) => {
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

  // Get old product data before update
  const oldProduct = await Product.findById(req.params.id);

  const updateHandler = handleFactory.updateOne(Product);

  // Store original json method
  const originalJson = res.json.bind(res);
  let productUpdated = null;

  // Override res.json to intercept response
  res.json = function (data) {
    if (data?.doc) {
      productUpdated = data.doc;
    }
    originalJson(data);
  };

  // Call the factory handler
  await updateHandler(req, res, next);

  // Log activity after update
  if (productUpdated && req.user && req.user.role === 'seller') {
    const changes = [];
    if (oldProduct && productUpdated.name !== oldProduct.name) {
      changes.push(`name from "${oldProduct.name}" to "${productUpdated.name}"`);
    }
    if (oldProduct && productUpdated.price !== oldProduct.price) {
      changes.push(`price from GH₵${oldProduct.price} to GH₵${productUpdated.price}`);
    }
    const changeDesc = changes.length > 0 ? ` (${changes.join(', ')})` : '';

    logActivityAsync({
      userId: req.user.id,
      role: 'seller',
      action: 'UPDATE_PRODUCT',
      description: `Seller updated product: ${productUpdated.name || 'Unknown'}${changeDesc}`,
      req,
      metadata: { productId: productUpdated._id },
    });
  }
});

// Wrapper for deleteProduct with activity logging
exports.deleteProduct = catchAsync(async (req, res, next) => {
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

  // Get product before deletion
  const productToDelete = await Product.findById(req.params.id);

  const deleteHandler = handleFactory.deleteOne(Product);

  // Store original json method
  const originalJson = res.json.bind(res);
  let deleted = false;

  // Override res.json to intercept response
  res.json = function (data) {
    if (data?.status === 'success') {
      deleted = true;
    }
    originalJson(data);
  };

  // Call the factory handler
  await deleteHandler(req, res, next);

  // Log activity after deletion
  if (deleted && productToDelete && req.user && req.user.role === 'seller') {
    logActivityAsync({
      userId: req.user.id,
      role: 'seller',
      action: 'DELETE_PRODUCT',
      description: `Seller deleted product: ${productToDelete.name || 'Unknown'}`,
      req,
      metadata: { productId: productToDelete._id },
    });
  }
});

// ==================== VARIANT CONTROLLERS ====================

/**
 * Get all variants for a product
 * GET /api/v1/product/:id/variants
 */
exports.getProductVariants = catchAsync(async (req, res, next) => {
  const { id: productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  const product = await Product.findById(productId).select('variants seller');

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to access this product', 403));
  }

  res.status(200).json({
    status: 'success',
    data: product.variants || [],
  });
});

/**
 * Get a single variant by ID
 * GET /api/v1/product/:id/variants/:variantId
 */
exports.getProductVariant = catchAsync(async (req, res, next) => {
  const { id: productId, variantId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  const product = await Product.findById(productId).select('variants seller');

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to access this product', 403));
  }

  // Find variant by _id (MongoDB ObjectId) or by index
  let variant = null;
  if (mongoose.Types.ObjectId.isValid(variantId)) {
    variant = product.variants.id(variantId);
  } else {
    // Try as index
    const index = parseInt(variantId);
    if (!isNaN(index) && index >= 0 && index < product.variants.length) {
      variant = product.variants[index];
    }
  }

  if (!variant) {
    return next(new AppError('Variant not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: variant,
  });
});

/**
 * Create a new variant for a product
 * POST /api/v1/product/:id/variants
 */
exports.createProductVariant = catchAsync(async (req, res, next) => {
  const { id: productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  const product = await Product.findById(productId);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to modify this product', 403));
  }

  // Parse variant data
  const variantData = {
    price: parseFloat(req.body.price) || 0,
    stock: parseInt(req.body.stock) || 0,
    sku: req.body.sku || '',
    status: req.body.status || 'active',
  };

  // Handle attributes
  if (req.body.attributes) {
    let attributes = req.body.attributes;
    if (typeof attributes === 'string') {
      try {
        attributes = JSON.parse(attributes);
      } catch (err) {
        return next(new AppError('Invalid attributes format', 400));
      }
    }
    variantData.attributes = Array.isArray(attributes) ? attributes : [];
  }

  // Auto-generate SKU if not provided
  if (!variantData.sku || variantData.sku.trim() === '') {
    // Convert attributes array to object for SKU generation
    const variantsObj = {};
    if (variantData.attributes && Array.isArray(variantData.attributes)) {
      variantData.attributes.forEach((attr) => {
        if (attr.key && attr.value) {
          variantsObj[attr.key] = attr.value;
        }
      });
    }

    // Get category from product
    const category = product.subCategory?.name || product.parentCategory?.name || 'GENERAL';
    const categoryPrefix = category.slice(0, 3).toUpperCase();

    // Get variant string from attributes
    const variantString = Object.entries(variantsObj)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([, value]) => String(value).trim())
      .join('-')
      .replace(/\s+/g, '')
      .substring(0, 3)
      .toUpperCase() || 'DEF';

    // Get seller ID (last 3 chars)
    const { price, salePrice } = req.body;

    // SECURITY FIX #23: Product price validation
    if (price !== undefined) {
      const numPrice = parseFloat(price);

      if (isNaN(numPrice)) {
        return next(new AppError('Price must be a valid number', 400));
      }

      if (numPrice <= 0) {
        return next(new AppError('Price must be greater than zero', 400));
      }

      // Maximum price limit (GH₵1,000,000)
      const MAX_PRICE = 1000000;
      if (numPrice > MAX_PRICE) {
        return next(new AppError(`Price cannot exceed GH₵${MAX_PRICE.toLocaleString()}`, 400));
      }

      req.body.price = numPrice;
    }

    // Validate sale price if provided
    if (salePrice !== undefined) {
      const numSalePrice = parseFloat(salePrice);

      if (isNaN(numSalePrice)) {
        return next(new AppError('Sale price must be a valid number', 400));
      }

      if (numSalePrice < 0) {
        return next(new AppError('Sale price cannot be negative', 400));
      }

      // Sale price must be less than regular price
      if (numSalePrice >= parseFloat(req.body.price)) { // Use req.body.price after validation
        return next(new AppError('Sale price must be less than regular price', 400));
      }

      req.body.salePrice = numSalePrice;
    }

    const sellerId = req.user.id.toString().slice(-3);
    const timestamp = Date.now().toString().slice(-4);

    // Generate SKU: {sellerId}-{category}-{variantString}-{timestamp}
    variantData.sku = `${sellerId}-${categoryPrefix}-${variantString}-${timestamp}`;
  }

  // Handle originalPrice/discount
  if (req.body.originalPrice) {
    variantData.originalPrice = parseFloat(req.body.originalPrice);
  }

  // Handle discount
  if (req.body.discount) {
    variantData.discount = parseFloat(req.body.discount);
  }

  // Handle name
  if (req.body.name) {
    variantData.name = req.body.name;
  }

  // Handle images from Cloudinary (processed by resizeProductImages middleware)
  // The middleware uploads images to Cloudinary and sets req.body.images as an array of URLs
  if (req.body.images && Array.isArray(req.body.images)) {
    variantData.images = req.body.images;
  }

  // Add variant to product
  product.variants.push(variantData);
  await product.save();

  const newVariant = product.variants[product.variants.length - 1];

  res.status(201).json({
    status: 'success',
    data: newVariant,
  });
});

/**
 * Update a variant
 * PATCH /api/v1/product/:id/variants/:variantId
 */
exports.updateProductVariant = catchAsync(async (req, res, next) => {
  const { id: productId, variantId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  const product = await Product.findById(productId);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to modify this product', 403));
  }

  // Find variant
  let variant = null;
  if (mongoose.Types.ObjectId.isValid(variantId)) {
    variant = product.variants.id(variantId);
  } else {
    const index = parseInt(variantId);
    if (!isNaN(index) && index >= 0 && index < product.variants.length) {
      variant = product.variants[index];
    }
  }

  if (!variant) {
    return next(new AppError('Variant not found', 404));
  }

  // Update variant fields
  if (req.body.name !== undefined) variant.name = req.body.name;
  if (req.body.price !== undefined) variant.price = parseFloat(req.body.price);
  if (req.body.stock !== undefined) variant.stock = parseInt(req.body.stock);
  if (req.body.sku !== undefined) variant.sku = req.body.sku;
  if (req.body.status !== undefined) variant.status = req.body.status;
  if (req.body.originalPrice !== undefined) variant.originalPrice = parseFloat(req.body.originalPrice);
  if (req.body.discount !== undefined) variant.discount = parseFloat(req.body.discount);

  // Update attributes
  if (req.body.attributes !== undefined) {
    let attributes = req.body.attributes;
    if (typeof attributes === 'string') {
      try {
        attributes = JSON.parse(attributes);
      } catch (err) {
        return next(new AppError('Invalid attributes format', 400));
      }
    }
    variant.attributes = Array.isArray(attributes) ? attributes : [];
  }

  // Handle images from Cloudinary (processed by resizeProductImages middleware)
  // The middleware uploads newImages to Cloudinary and sets req.body.images as an array of URLs
  if (req.body.images !== undefined && Array.isArray(req.body.images)) {
    // If imagesToDelete is provided, remove those images first
    if (req.body.imagesToDelete) {
      let imagesToDelete = req.body.imagesToDelete;
      if (typeof imagesToDelete === 'string') {
        try {
          imagesToDelete = JSON.parse(imagesToDelete);
        } catch (err) {
          return next(new AppError('Invalid imagesToDelete format', 400));
        }
      }

      // Filter out images to delete
      const existingImages = (variant.images || []).filter(
        (img) => !imagesToDelete.includes(img)
      );

      // Combine existing (non-deleted) images with new images from Cloudinary
      variant.images = [...existingImages, ...req.body.images];
    } else {
      // If no images to delete, just set the new images
      variant.images = req.body.images;
    }
  }

  await product.save();

  res.status(200).json({
    status: 'success',
    data: variant,
  });
});

/**
 * Delete a variant
 * DELETE /api/v1/product/:id/variants/:variantId
 */
exports.deleteProductVariant = catchAsync(async (req, res, next) => {
  const { id: productId, variantId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  const product = await Product.findById(productId);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if seller owns this product (unless admin)
  if (req.user.role !== 'admin' && product.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to modify this product', 403));
  }

  // Find and remove variant
  let removed = false;
  if (mongoose.Types.ObjectId.isValid(variantId)) {
    const variant = product.variants.id(variantId);
    if (variant) {
      variant.remove();
      removed = true;
    }
  } else {
    const index = parseInt(variantId);
    if (!isNaN(index) && index >= 0 && index < product.variants.length) {
      product.variants.splice(index, 1);
      removed = true;
    }
  }

  if (!removed) {
    return next(new AppError('Variant not found', 404));
  }

  await product.save();

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
