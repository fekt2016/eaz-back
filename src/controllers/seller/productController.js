const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');
const multer = require('multer');
const stream = require('stream');
const logger = require('../../utils/logger');
const Review = require('../../models/product/reviewModel');
const Product = require('../../models/product/productModel');
const Category = require('../../models/category/categoryModel');
const Seller = require('../../models/user/sellerModel');
const Order = require('../../models/order/orderModel');
const OrderItems = require('../../models/order/OrderItemModel');
const BrowserHistory = require('../../models/user/browserHistoryModel');
const handleFactory = require('../shared/handleFactory');
const APIFeature = require('../../utils/helpers/apiFeatures');
const { buildBuyerSafeQuery } = require('../../utils/helpers/productVisibility');

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
  // logger.info(req.headers['content-type']);
  // Check if files are present in the request
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    // Use upload.any() to accept all files, then we'll process them in resizeProductImages
    return upload.any()(req, res, next);
  }
  next();
};

exports.uploadProductImage = upload.any();

exports.resizeProductImages = catchAsync(async (req, res, next) => {
  // logger.info(req);
  req.body = { ...req.body };
  
  // Convert req.files array to object format for easier access
  // When using upload.any(), files are in array format with fieldname property
  let filesObj = {};
  if (Array.isArray(req.files)) {
    req.files.forEach(file => {
      if (!filesObj[file.fieldname]) {
        filesObj[file.fieldname] = [];
      }
      filesObj[file.fieldname].push(file);
    });
  } else if (req.files) {
    filesObj = req.files;
  }
  
  req.files = filesObj;
  console.log('req.files', req.files);
  let parseExistingImages = [];
  let imagesUrls = [];
  try {
    const cloudinary = req.app.get('cloudinary');
    
    // Check if Cloudinary is configured
    if (!cloudinary) {
      logger.error('[resizeProductImages] Cloudinary is not configured');
      return next(new AppError('Image upload service is not configured. Please contact support.', 500));
    }
    
    // console.log('cloudinary', cloudinary);
    if (req.files && Object.keys(req.files).length > 0) {
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
      
      // Process cover image
      if (req.files.imageCover && req.files.imageCover[0]) {
        const coverFile = req.files.imageCover[0];
        const coverResult = await uploadFromBuffer(coverFile.buffer, {
          folder: 'products',
          public_id: `${uniqueSuffix}-cover`,
          transformation: [
            { width: 2000, height: 1333, crop: 'scale' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        });

        req.body.imageCover = coverResult.secure_url;
        logger.info('Cover image URL:', req.body.imageCover);
      }

      // Process product additional images
      if (req.files.newImages && req.files.newImages.length > 0) {
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

      // Handle variant images
      // Variant images are uploaded with field names like: variantImages[0], variantImages[1], etc.
      if (req.body.variants && Array.isArray(req.body.variants)) {
        // Parse variants if it's a string
        if (typeof req.body.variants === 'string') {
          try {
            req.body.variants = JSON.parse(req.body.variants);
          } catch (err) {
            console.error('Error parsing variants:', err);
          }
        }

        // Process variant images
        for (let i = 0; i < req.body.variants.length; i++) {
          const variantKey = `variantImages[${i}]`;
          const variantKeyAlt = `variants[${i}][images]`; // Alternative format
          
          // Check both possible field name formats
          let variantImageFiles = null;
          if (req.files[variantKey] && req.files[variantKey].length > 0) {
            variantImageFiles = req.files[variantKey];
          } else if (req.files[variantKeyAlt] && req.files[variantKeyAlt].length > 0) {
            variantImageFiles = req.files[variantKeyAlt];
          }

          if (variantImageFiles) {
            const variantImagesPromises = variantImageFiles.map(async (file, imgIndex) => {
              const result = await uploadFromBuffer(file.buffer, {
                folder: 'products/variants',
                public_id: `${uniqueSuffix}-variant-${i}-image-${imgIndex}`,
                transformation: [
                  { width: 1000, height: 1000, crop: 'fill' },
                  { quality: 'auto', fetch_format: 'auto' },
                ],
              });
              return result.secure_url;
            });

            const variantImageUrls = await Promise.all(variantImagesPromises);
            
            // Merge with existing variant images if any
            const existingVariantImages = req.body.variants[i].images || [];
            if (typeof existingVariantImages === 'string') {
              try {
                const parsed = JSON.parse(existingVariantImages);
                req.body.variants[i].images = [...(Array.isArray(parsed) ? parsed : []), ...variantImageUrls];
              } catch {
                req.body.variants[i].images = [...(Array.isArray(existingVariantImages) ? existingVariantImages : []), ...variantImageUrls];
              }
            } else {
              req.body.variants[i].images = [...(Array.isArray(existingVariantImages) ? existingVariantImages : []), ...variantImageUrls];
            }
          } else if (req.body.variants[i].images) {
            // If variant has images but no new files, ensure images is an array
            if (typeof req.body.variants[i].images === 'string') {
              try {
                req.body.variants[i].images = JSON.parse(req.body.variants[i].images);
              } catch {
                req.body.variants[i].images = [];
              }
            }
          } else {
            // Initialize empty images array if not present
            req.body.variants[i].images = [];
          }
        }
      }

      if (req.body.existingImages) {
        parseExistingImages = JSON.parse(req.body.existingImages);
        delete req.body.existingImages; // Remove from request body
      }

      req.body.images = [...parseExistingImages, ...imagesUrls];
      logger.info('All images:', req.body);
    }
  } catch (err) {
    logger.error('[resizeProductImages] Error processing images:', {
      error: err.message,
      stack: err.stack,
      filesCount: req.files ? Object.keys(req.files).length : 0,
    });
    
    // If it's a critical error (like Cloudinary config), return error
    if (err.message && err.message.includes('not configured')) {
      return next(err);
    }
    
    // For other image processing errors, log but continue (product can be created without images)
    logger.warn('[resizeProductImages] Continuing without images due to processing error');
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
  console.time('category-counts');
  console.log('[CATEGORY-COUNTS] Request received');
  
  // PERFORMANCE FIX: Add allowDiskUse(true) for large aggregations
  // This allows MongoDB to use disk for temporary files when memory is insufficient
  // CRITICAL: Exclude deleted products from category counts
  const productCounts = await Product.aggregate([
    {
      $match: {
        isDeleted: { $ne: true }, // Exclude deleted products
        isDeletedByAdmin: { $ne: true }, // Exclude admin-deleted products
        isDeletedBySeller: { $ne: true }, // Exclude seller-deleted products
        status: { $ne: 'archived' }, // Exclude archived products
      },
    },
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
  ]).allowDiskUse(true); // PERFORMANCE FIX: Allow disk use for large aggregations

  console.timeEnd('category-counts');
  console.log(`[CATEGORY-COUNTS] ✅ Returned ${productCounts.length} category counts`);

  res.status(200).json({
    status: 'success',
    data: {
      productCounts,
    },
  });
});
exports.getAllPublicProductsBySeller = catchAsync(async (req, res, next) => {
  const sellerId = req.params.sellerId;
  logger.info('🔍 [getAllPublicProductsBySeller] Seller ID:', sellerId);

  // First, check if seller has any products at all (regardless of status)
  const allProducts = await Product.find({ seller: sellerId });
  logger.info('🔍 [getAllPublicProductsBySeller] Total products for seller (all statuses);:', allProducts.length);
  if (allProducts.length > 0) {
    logger.info('🔍 [getAllPublicProductsBySeller] All product statuses:', allProducts.map(p => ({
      id: p._id,
      name: p.name,
      moderationStatus: p.moderationStatus,
      status: p.status
    })));
  }

  // For public seller page: Only show products that are visible to buyers
  // This means: seller must be verified, product must be active and approved
  // Use buyer-safe query to ensure unverified sellers' products are hidden
  const baseFilter = { seller: sellerId };
  const buyerSafeFilter = buildBuyerSafeQuery(baseFilter, {
    user: req.user,
    isAdmin: req.user?.role === 'admin',
    isSeller: false, // Public view, not seller's own view
  });
  
  const products = await Product.find(buyerSafeFilter)
    .populate('parentCategory', 'name slug')
    .populate('subCategory', 'name slug');

  logger.info('🔍 [getAllPublicProductsBySeller] Found approved/pending products:', products.length);
  logger.info('🔍 [getAllPublicProductsBySeller] Query filter:', {
    seller: sellerId,
    moderationStatus: { $in: ['approved', 'pending'] },
    status: { $in: ['active', 'out_of_stock'] }
  });
  if (products.length > 0) {
    logger.info('🔍 [getAllPublicProductsBySeller] Products:', products.map(p => ({
      id: p._id,
      name: p.name,
      moderationStatus: p.moderationStatus,
      status: p.status
    })));
  } else if (allProducts.length > 0) {
    logger.info('⚠️ [getAllPublicProductsBySeller] Seller has products but none are approved/pending. Showing all active products instead.');
    // If seller has products but none are approved/pending, show all active products
    // This includes rejected products so seller can see them on their page
    // CRITICAL: Exclude deleted products from public view
    const activeProducts = await Product.find({
      seller: sellerId,
      status: { $in: ['active', 'out_of_stock'] },
      isDeleted: { $ne: true }, // Exclude deleted products
      isDeletedByAdmin: { $ne: true }, // Exclude admin-deleted products
      isDeletedBySeller: { $ne: true }, // Exclude seller-deleted products
    }).populate('parentCategory', 'name slug').populate('subCategory', 'name slug');

    logger.info('🔍 [getAllPublicProductsBySeller] Active products (including rejected);:', activeProducts.length);
    if (activeProducts.length > 0) {
      logger.info('🔍 [getAllPublicProductsBySeller] Active product statuses:', activeProducts.map(p => ({
        id: p._id,
        name: p.name,
        moderationStatus: p.moderationStatus,
        status: p.status
      })));
    }
    const fallbackResponse = { status: 'success', data: { products: activeProducts } };
    logger.info("🔍 [getAllPublicProductsBySeller] Fallback response structure:", {
      status: fallbackResponse.status,
      hasData: !!fallbackResponse.data,
      hasProducts: !!fallbackResponse.data.products,
      productsLength: fallbackResponse.data.products?.length,
      productsIsArray: Array.isArray(fallbackResponse.data.products)
    });
    res.status(200).json(fallbackResponse);
    return;
  }
  logger.info("🔍 [getAllPublicProductsBySeller] Final products to return:", products.length);
  logger.info("🔍 [getAllPublicProductsBySeller] Products array type:", Array.isArray(products));
  logger.info("🔍 [getAllPublicProductsBySeller] First product sample:", products[0] ? { id: products[0]._id, name: products[0].name } : 'none');

  // Don't return error if no products - just return empty array
  const response = { status: 'success', data: { products } };
  logger.info("🔍 [getAllPublicProductsBySeller] Response structure:", {
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
  console.time('getAllProduct');
  console.log('🔍 [getAllProduct] Products request hit');
  
  // Check if user is admin - handle both admin and superadmin roles
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin' || req.user.role === 'moderator');
  
  // Set default limit based on user role
  // Admins can see more products at once for better management
  if (!req.query.limit) {
    req.query.limit = isAdmin ? '200' : '20'; // Higher default for admins
  }
  
  // Cap limit based on user role
  // CRITICAL: Enforce strict limits to prevent server lockup
  // Admins can fetch more products (up to 200) for management purposes
  // Regular users are capped at 100 for performance
  const requestedLimit = parseInt(req.query.limit) || (isAdmin ? 200 : 20);
  if (isAdmin) {
    // Admins capped at 200 to prevent timeout and server lockup
    // Frontend should use pagination instead of fetching all products
    if (requestedLimit > 200) {
      req.query.limit = '200';
    }
  } else {
    // Regular users capped at 100
    if (requestedLimit > 100) {
      req.query.limit = '100';
    }
  }
  
  // Build base filter
  let filter = {};
  
  // For non-admin users (public/buyer access), use buyer-safe query
  // This excludes products from unverified sellers
  if (!isAdmin) {
    const isSeller = req.user?.role === 'seller';
    filter = buildBuyerSafeQuery(filter, {
      user: req.user,
      isAdmin: false,
      isSeller: isSeller,
    });
    
    // DEBUG: Log the filter being used for buyer queries
    logger.info('[getAllProduct] Buyer query filter:', JSON.stringify(filter, null, 2));
  }
  // Admins can see all products (including pending/rejected, unverified sellers, and buyer-created products)
  // Sellers can see their own products regardless of verification (handled in getSellerProducts)
  
  // Debug logging for admin access
  if (isAdmin && process.env.NODE_ENV === 'development') {
    console.log('[getAllProduct] Admin access - showing ALL products (including buyer-created, pending, rejected)');
  }

  // Build query with filter
  let query = Product.find(filter);

  // Apply API features (filtering, sorting, pagination)
  const features = new APIFeature(query, req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // CRITICAL: Add MongoDB query timeout to prevent hanging queries
  // maxTimeMS: 20000 = 20 seconds max query time
  features.query = features.query.maxTimeMS(20000);

  // Populate related fields (limit to essential fields for performance)
  // CRITICAL: Use lean() without virtuals for better performance
  // Calculate totalStock in application code instead
  // IMPORTANT: Populate seller with verificationStatus to filter by seller verification
  features.query = features.query
    .populate([
      { path: 'seller', select: 'name email phone shopName verificationStatus' },
      { path: 'parentCategory', select: 'name slug' },
      { path: 'subCategory', select: 'name slug' },
    ])
    .lean(); // Use lean() for better performance, calculate virtuals manually

  let products = await features.query;
  
  // NOTE: We no longer filter by seller verification status
  // Approved products are visible regardless of seller verification status
  
  // DEBUG: Log query results for buyer queries
  if (!isAdmin) {
    logger.info(`[getAllProduct] Query returned ${products.length} products for buyer`);
    if (products.length === 0) {
      // Check what products exist that might match
      const debugQuery = await Product.find({
        moderationStatus: 'approved',
        status: { $in: ['active', 'out_of_stock'] },
        isDeleted: { $ne: true },
        isDeletedByAdmin: { $ne: true },
        isDeletedBySeller: { $ne: true },
      }).select('_id name moderationStatus status isVisible isDeleted isDeletedByAdmin isDeletedBySeller seller').limit(10).lean();
      logger.warn('[getAllProduct] No products returned. Sample approved products in DB:', debugQuery.map(p => ({
        id: p._id,
        name: p.name,
        moderationStatus: p.moderationStatus,
        status: p.status,
        isVisible: p.isVisible,
        isDeleted: p.isDeleted,
        isDeletedByAdmin: p.isDeletedByAdmin,
        isDeletedBySeller: p.isDeletedBySeller,
        seller: p.seller,
      })));
      
      // Also check total count
      const totalApproved = await Product.countDocuments({
        moderationStatus: 'approved',
        status: { $in: ['active', 'out_of_stock'] },
        isDeleted: { $ne: true },
        isDeletedByAdmin: { $ne: true },
        isDeletedBySeller: { $ne: true },
      });
      logger.warn(`[getAllProduct] Total approved products in DB: ${totalApproved}`);
    } else {
      // Log sample of returned products
      logger.info('[getAllProduct] Sample returned products:', products.slice(0, 3).map(p => ({
        id: p._id,
        name: p.name,
        moderationStatus: p.moderationStatus,
        status: p.status,
        isVisible: p.isVisible,
      })));
    }
  }
  
  // Calculate totalStock for each product (lean() doesn't include virtuals)
  // CRITICAL: Keep this synchronous and fast - only calculate what's needed
  if (Array.isArray(products) && products.length > 0) {
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      // Calculate totalStock from variants
      if (Array.isArray(product.variants) && product.variants.length > 0) {
        product.totalStock = product.variants.reduce((sum, variant) => {
          return sum + (variant.stock || 0);
        }, 0);
      } else {
        product.totalStock = 0;
        product.variants = [];
      }
    }
  }
  
  // CRITICAL: Limit debug logging to prevent log accumulation
  // Only log in development and limit to first product only
  if (process.env.NODE_ENV === 'development' && products.length > 0) {
    const sampleProduct = products[0];
    console.log('[getAllProduct] Sample product:', {
      productId: sampleProduct._id,
      totalStock: sampleProduct.totalStock,
      variantsCount: sampleProduct.variants?.length || 0,
    });
  }

  // Get total count for pagination (apply same filter)
  // CRITICAL: Add timeout to count query to prevent hanging
  const countQuery = Product.find(filter);
  const countFeatures = new APIFeature(countQuery, req.query).filter();
  countFeatures.query = countFeatures.query.maxTimeMS(10000); // 10 seconds for count
  const total = await countFeatures.query.countDocuments();

  console.timeEnd('getAllProduct');
  
  // CRITICAL: Limit logging to prevent log accumulation
  // Only log essential info, not full objects
  if (isAdmin && process.env.NODE_ENV === 'development') {
    console.log(`✅ [getAllProduct] Admin: ${products.length}/${total} products (limit: ${req.query.limit || 200})`);
  }

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
    logger.info(`[getProductReviews] Product ID: ${productId}`);
    logger.info(`[getProductReviews] User: ${req.user?.id || 'anonymous'}, Role: ${req.user?.role || 'none'}`);
    logger.info(`[getProductReviews] Status filter:`, statusFilter);
    logger.info(`[getProductReviews] Found ${reviews.length} reviews`);

    res.status(200).json({
      success: true,
      data: {
        count: reviews.length,
        reviews, // Directly return reviews array
        averageRating: calculateAverage(reviews), // Optional
      },
    });
  } catch (error) {
    logger.error('Error fetching product reviews:', error);
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
  const { id } = req.params;

  // Validate product ID
  if (!id || id === 'undefined' || id === 'null') {
    return next(new AppError('Product ID is required', 400));
  }

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError(`Invalid product ID format: ${id}`, 400));
  }

  const productId = new mongoose.Types.ObjectId(id);
  logger.info('productId', productId);

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
    logger.info('[getProductById] Product not found in database:', productId);
    return next(new AppError('Product not found', 404));
  }

  // Get seller ID from product - handle both populated and unpopulated cases
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

  // Check if current user is admin or seller who owns this product
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin' || req.user.role === 'moderator');
  let isSellerOwnProduct = false;
  if (req.user && productSellerId) {
    const userIdStr = req.user.id?.toString() || req.user._id?.toString();
    isSellerOwnProduct = productSellerId === userIdStr;
  }

  logger.info('[getProductById] Product found:', {
    productId: product._id,
    moderationStatus: product.moderationStatus,
    isDeleted: product.isDeleted,
    isDeletedByAdmin: product.isDeletedByAdmin,
    isDeletedBySeller: product.isDeletedBySeller,
    status: product.status,
    deletedBy: product.deletedBy,
    deletedByRole: product.deletedByRole,
    sellerId: productSellerId,
    isAdmin,
    isSellerOwnProduct,
  });

  // CRITICAL: Hide deleted/archived products from buyers
  // Rules:
  // 1. Admins can see all products (including deleted/archived)
  // 2. Sellers can see their own products UNLESS deleted by admin
  // 3. Buyers/public cannot see deleted/archived products
  if (!isAdmin) {
    // If product is deleted or archived
    if (product.isDeleted === true || 
        product.isDeletedByAdmin === true || 
        product.isDeletedBySeller === true || 
        product.status === 'archived') {
      // If seller owns it but admin deleted it, hide it
      if (isSellerOwnProduct && product.isDeletedByAdmin) {
        logger.info('[getProductById] ❌ Product deleted by admin - hiding from seller:', {
          productId: product._id,
          deletedBy: product.deletedBy,
          deletedByRole: product.deletedByRole,
        });
        return next(new AppError('Product not found or not available', 404));
      }
      // If not seller's product, hide it
      if (!isSellerOwnProduct) {
        logger.info('[getProductById] ❌ Product is deleted/archived - hiding from buyer:', {
          productId: product._id,
          isDeleted: product.isDeleted,
          isDeletedByAdmin: product.isDeletedByAdmin,
          isDeletedBySeller: product.isDeletedBySeller,
          status: product.status,
        });
        return next(new AppError('Product not found or not available', 404));
      }
    }
  }

  // Access control logic for moderation status:
  // 1. Admins can see all products
  // 2. Sellers can see their own products regardless of moderation status
  // 3. Everyone else (including unauthenticated) can only see approved products

  // Normalize moderationStatus - handle undefined/null
  const moderationStatus = product.moderationStatus;
  const isApproved = moderationStatus === 'approved';
  const isRejected = moderationStatus === 'rejected';
  const isUndefined = moderationStatus === undefined || moderationStatus === null;

  // Allow access if: approved OR (undefined and not rejected) - undefined might be legacy products
  const canAccess = isApproved || (isUndefined && !isRejected);

  if (!isAdmin) {
    // If not seller's own product and cannot access (not approved and not undefined), deny access
    if (!isSellerOwnProduct && !canAccess) {
      logger.info('[getProductById] ❌ Access denied:', {
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

    logger.info('[getProductById] ✅ Access granted');
  } else {
    logger.info('[getProductById] ✅ Admin access - granted');
  }

  // Fetch product as plain object so populated seller is guaranteed in JSON response (buyer PDP seller card)
  const productResponse = await Product.findById(productId)
    .populate({
      path: 'parentCategory',
      select: 'name slug',
    })
    .populate({
      path: 'seller',
      select: '_id name shopName avatar role ratings shopLocation',
    })
    .lean();

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

  // 5. Apply buyer-safe filter (exclude unverified seller products)
  const isAdmin = req.user?.role === 'admin';
  const isSeller = req.user?.role === 'seller';
  const buyerSafeQuery = buildBuyerSafeQuery(baseQuery, {
    user: req.user,
    isAdmin: isAdmin,
    isSeller: isSeller,
  });

  const products = await Product.find(buyerSafeQuery);
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
  const totalCount = await Product.countDocuments(buyerSafeQuery);
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
  let handlerError = null;

  // Override res.json to intercept response
  res.json = function (data) {
    productCreated = true;
    if (data?.data?.data) {
      createdProduct = data.data.data;
    } else if (data?.data) {
      createdProduct = data.data;
    } else if (data?.doc) {
      createdProduct = data.doc;
    }
    originalJson(data);
  };

  // Wrap handler call in try-catch to catch any errors
  try {
    // Call the factory handler
    await createOneHandler(req, res, next);
  } catch (error) {
    handlerError = error;
    logger.error('[createProduct] Error in createOneHandler:', {
      error: error.message,
      stack: error.stack,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      hasFiles: !!req.files,
    });
    // Re-throw to be caught by outer catchAsync
    throw error;
  }

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
            logger.info(`[Product Creation] Admin notification created for product ${createdProduct._id}`);
          } catch (notificationError) {
            logger.error('[Product Creation] Error creating admin notification:', notificationError);
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
            logger.info('[Product] Seller onboarding updated after product creation');
          }
        }
      } catch (onboardingError) {
        // Don't fail product creation if onboarding update fails
        logger.error('[Product] Error updating onboarding:', onboardingError);
      }
    });
  }
});
// Wrapper for updateProduct with activity logging
exports.updateProduct = catchAsync(async (req, res, next) => {
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

  // Get old product data before update and verify ownership
  const oldProduct = await Product.findById(req.params.id);
  
  if (!oldProduct) {
    return next(new AppError('Product not found', 404));
  }

  // Verify seller owns this product (unless admin)
  if (req.user.role !== 'admin' && oldProduct.seller.toString() !== req.user.id.toString()) {
    return next(new AppError('You do not have permission to modify this product', 403));
  }

  // Parse JSON strings for variants and specifications (same as createProduct)
  if (req.body.variants && typeof req.body.variants === 'string') {
    try {
      req.body.variants = JSON.parse(req.body.variants);
      console.log('[updateProduct] Parsed variants:', req.body.variants);
    } catch (err) {
      return next(new AppError('Invalid variants format', 400));
    }
  }

  // Ensure variants is an array
  if (req.body.variants && !Array.isArray(req.body.variants)) {
    return next(new AppError('Variants must be an array', 400));
  }

  // Transform variants data types and ensure attributes are properly formatted
  if (req.body.variants) {
    req.body.variants = req.body.variants.map((variant) => {
      // Ensure attributes is an array and properly formatted
      let attributes = variant.attributes || [];
      if (!Array.isArray(attributes)) {
        attributes = [];
      }
      
      // Filter out attributes with empty keys or values
      attributes = attributes.filter(attr => attr && attr.key && attr.value);
      
      // If no valid attributes, create a default one to satisfy validation
      if (attributes.length === 0) {
        attributes = [{ key: 'Default', value: 'N/A' }];
      }

      return {
        ...variant,
        attributes,
        price: parseFloat(variant.price) || 0,
        stock: parseInt(variant.stock) || 0,
        sku: variant.sku || '',
        status: variant.status || 'active',
        condition: variant.condition || 'new', // Default to 'new' if not provided
      };
    });
  }

  // Parse specifications if sent as JSON string
  if (req.body.specifications && typeof req.body.specifications === 'string') {
    try {
      req.body.specifications = JSON.parse(req.body.specifications);
      console.log('[updateProduct] Parsed specifications:', req.body.specifications);
    } catch (err) {
      return next(new AppError('Invalid specifications format', 400));
    }
  }

  // Handle manufacturer field - convert string to object format if needed
  if (req.body.manufacturer !== undefined) {
    if (typeof req.body.manufacturer === 'string' && req.body.manufacturer.trim() !== '') {
      // Convert string to object format: { name: "Levi" }
      req.body.manufacturer = {
        name: req.body.manufacturer.trim(),
      };
      console.log('[updateProduct] Converted manufacturer string to object:', req.body.manufacturer);
    } else if (typeof req.body.manufacturer === 'object' && req.body.manufacturer !== null) {
      // Already in object format, ensure it has the correct structure
      if (req.body.manufacturer.name) {
        req.body.manufacturer = {
          name: String(req.body.manufacturer.name).trim() || '',
          sku: req.body.manufacturer.sku ? String(req.body.manufacturer.sku).trim() : '',
          partNumber: req.body.manufacturer.partNumber ? String(req.body.manufacturer.partNumber).trim() : '',
        };
      } else {
        // Empty object or invalid structure, set to null
        req.body.manufacturer = null;
      }
    } else if (req.body.manufacturer === '' || req.body.manufacturer === null) {
      // Empty string or null, set to null
      req.body.manufacturer = null;
    }
  }

  // Handle warranty field - convert string to object format if needed
  // Warranty can be: { duration: Number, type: String, details: String } or a string
  if (req.body.warranty !== undefined) {
    if (typeof req.body.warranty === 'string' && req.body.warranty.trim() !== '') {
      // Try to parse warranty string (e.g., "1 year", "2 years")
      const warrantyStr = req.body.warranty.trim().toLowerCase();
      const durationMatch = warrantyStr.match(/(\d+)/);
      const duration = durationMatch ? parseInt(durationMatch[1]) : null;
      const type = warrantyStr.includes('year') ? 'year' : warrantyStr.includes('month') ? 'month' : 'standard';
      
      req.body.warranty = {
        duration: duration || 1,
        type: type,
        details: req.body.warranty.trim(),
      };
      console.log('[updateProduct] Converted warranty string to object:', req.body.warranty);
    } else if (typeof req.body.warranty === 'object' && req.body.warranty !== null) {
      // Already in object format, ensure it has the correct structure
      req.body.warranty = {
        duration: req.body.warranty.duration ? Number(req.body.warranty.duration) : null,
        type: req.body.warranty.type || 'standard',
        details: req.body.warranty.details ? String(req.body.warranty.details).trim() : '',
      };
    } else if (req.body.warranty === '' || req.body.warranty === null) {
      // Empty string or null, set to null
      req.body.warranty = null;
    }
  }

  // Handle images field - if sent as JSON string, parse it and set as existingImages
  // The resizeProductImages middleware expects existingImages
  if (req.body.images && typeof req.body.images === 'string') {
    try {
      const parsedImages = JSON.parse(req.body.images);
      req.body.existingImages = parsedImages;
      delete req.body.images; // Remove images field, middleware will use existingImages
      console.log('[updateProduct] Parsed existing images:', parsedImages);
    } catch (err) {
      console.warn('[updateProduct] Failed to parse images field, treating as new images array');
      // If parsing fails, it might be a new images array, let middleware handle it
    }
  }

  // Validate ObjectIDs for categories
  if (req.body.parentCategory && !mongoose.Types.ObjectId.isValid(req.body.parentCategory)) {
    return next(new AppError('Invalid parentCategory ID format', 400));
  }

  if (req.body.subCategory && !mongoose.Types.ObjectId.isValid(req.body.subCategory)) {
    return next(new AppError('Invalid subCategory ID format', 400));
  }

  // For products with variants, we need to handle updates manually
  // because findByIdAndUpdate doesn't work well with nested subdocuments
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return next(new AppError('Product not found', 404));
    }

    // Update all fields except variants (we'll handle variants separately)
    const updateFields = { ...req.body };
    const variantsToUpdate = updateFields.variants;
    delete updateFields.variants; // Remove variants, handle separately

    // CRITICAL: Prevent sellers from modifying moderationStatus, moderatedBy, moderatedAt
    // Only admins can change these fields - preserve existing values for sellers
    if (req.user.role === 'seller') {
      delete updateFields.moderationStatus;
      delete updateFields.moderatedBy;
      delete updateFields.moderatedAt;
      delete updateFields.moderationNotes;
      // Preserve existing moderation status
      if (product.moderationStatus) {
        // Keep the existing moderationStatus - don't allow sellers to change it
        logger.info(`[updateProduct] Preserving moderationStatus for seller update: ${product.moderationStatus}`);
      }
    }

    // Update non-variant fields
    // Exclude warranty if not provided (to preserve existing warranty)
    Object.keys(updateFields).forEach((key) => {
      // Skip warranty if not provided in update (preserve existing value)
      if (key === 'warranty' && updateFields[key] === undefined) {
        return;
      }
      if (updateFields[key] !== undefined && updateFields[key] !== null) {
        product[key] = updateFields[key];
      }
    });

    // Handle variants update
    if (variantsToUpdate && Array.isArray(variantsToUpdate)) {
      // Build new variants array
      const newVariants = variantsToUpdate.map((variant) => {
        // If variant has _id and it exists in current product, update it
        if (variant._id && mongoose.Types.ObjectId.isValid(variant._id)) {
          const existingVariant = product.variants.id(variant._id);
          if (existingVariant) {
            // Update existing variant fields
            Object.keys(variant).forEach((key) => {
              if (key !== '_id' && variant[key] !== undefined) {
                existingVariant[key] = variant[key];
              }
            });
            return existingVariant;
          }
        }
        // Create new variant (remove _id if it doesn't exist in product)
        const newVariant = { ...variant };
        if (newVariant._id) {
          delete newVariant._id; // Remove _id for new variants
        }
        return newVariant;
      });
      
      // Replace entire variants array
      product.variants = newVariants;
    }

    // Save the product (this will trigger all pre-save hooks and validations)
    let updatedProduct;
    try {
      updatedProduct = await product.save();
    } catch (saveError) {
      console.error('[updateProduct] Error saving product:', saveError);
      console.error('[updateProduct] Product data before save:', {
        name: product.name,
        price: product.price,
        warranty: product.warranty,
        warrantyType: typeof product.warranty,
        variantsCount: product.variants?.length,
        parentCategory: product.parentCategory,
        subCategory: product.subCategory,
      });
      
      // If it's a validation error, return more details
      if (saveError.name === 'ValidationError') {
        const validationErrors = Object.values(saveError.errors).map(err => ({
          path: err.path,
          message: err.message,
          value: err.value,
        }));
        console.error('[updateProduct] Validation errors:', validationErrors);
        return next(new AppError(`Validation error: ${validationErrors.map(e => `${e.path}: ${e.message}`).join(', ')}`, 400));
      }
      
      // Re-throw if not a validation error to be caught by outer catch
      throw saveError;
    }

    // Log activity
    if (req.user && req.user.role === 'seller') {
      const changes = [];
      if (oldProduct && updatedProduct.name !== oldProduct.name) {
        changes.push(`name from "${oldProduct.name}" to "${updatedProduct.name}"`);
      }
      const changeDesc = changes.length > 0 ? ` (${changes.join(', ')})` : '';

      logActivityAsync({
        userId: req.user.id,
        role: 'seller',
        action: 'UPDATE_PRODUCT',
        description: `Seller updated product: ${updatedProduct.name || 'Unknown'}${changeDesc}`,
        req,
        metadata: { productId: updatedProduct._id },
      });
    }

    res.status(200).json({
      status: 'success',
      doc: updatedProduct,
    });
  } catch (error) {
    console.error('[updateProduct] Error updating product:', error);
    console.error('[updateProduct] Request body:', JSON.stringify(req.body, null, 2));
    console.error('[updateProduct] Product ID:', req.params.id);
    console.error('[updateProduct] Error stack:', error.stack);
    
    // Return more specific error messages
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message).join(', ');
      return next(new AppError(`Validation error: ${errors}`, 400));
    }
    
    return next(new AppError(`Failed to update product: ${error.message}`, 500));
  }

  // Note: Activity logging is already handled above (inside the try block) after saving.
});

// Wrapper for deleteProduct with activity logging
exports.deleteProduct = catchAsync(async (req, res, next) => {
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

  // Validate product ID
  if (!req.params.id) {
    return next(new AppError('Product ID is required', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  // Get product before deletion
  const productToDelete = await Product.findById(req.params.id);
  
  if (!productToDelete) {
    return next(new AppError('Product not found', 404));
  }
console.log(req.user);
  // Log user and product info for debugging
  const userRole = req.user?.role || req.user?.userRole || null;
  const userId = req.user?.id || req.user?._id || null;
  
  logger.info(`[Delete Product] Delete request:`, {
    productId: req.params.id,
    userRole: userRole,
    userId: userId,
    user_id: req.user?._id,
    userObjectKeys: req.user ? Object.keys(req.user) : [],
    userObject: req.user ? {
      id: req.user.id,
      _id: req.user._id,
      role: req.user.role,
      userRole: req.user.userRole,
      email: req.user.email,
      name: req.user.name,
    } : null,
    productSeller: productToDelete.seller?.toString(),
    productSellerType: typeof productToDelete.seller,
  });

  // Verify ownership (unless admin/superadmin/moderator)
  // CRITICAL: If user passed restrictTo('admin', 'superadmin', 'moderator', 'seller') middleware,
  // they are authorized. We just need to check if they're an admin (not a seller) to bypass ownership check.
  
  // Get role from multiple possible locations
  const userRoleValue = userRole || req.user?.role || null;
  
  // More robust Admin model detection - check multiple ways to identify Admin model
  const isAdminModel = req.user && (
    req.user.constructor?.modelName === 'Admin' ||
    req.user.constructor?.name === 'Admin' ||
    req.user.modelName === 'Admin' ||
    // Check if user has admin-specific fields (Admin model has these, Seller doesn't)
    (req.user.email && !req.user.shopName && !req.user.businessName) ||
    // Check if the collection name is 'admins'
    (req.user.collection?.name === 'admins')
  );
  
  // Check if role matches admin roles
  const hasAdminRole = userRoleValue === 'admin' || 
                       userRoleValue === 'superadmin' || 
                       userRoleValue === 'moderator';
  
  // Final admin check: user is admin if they have admin role OR are from Admin model
  // Since they passed the restrictTo middleware, they're authorized - we just need to know if they're admin vs seller
  const finalIsAdmin = hasAdminRole || isAdminModel;
  
  const userOwnsProduct = productToDelete.seller && userId && 
                          (productToDelete.seller.toString() === userId.toString());
  
  logger.info(`[Delete Product] Permission check:`, {
    finalIsAdmin: finalIsAdmin,
    hasAdminRole: hasAdminRole,
    isAdminModel: isAdminModel,
    userOwnsProduct: userOwnsProduct,
    userRole: userRole,
    userRoleValue: userRoleValue,
    reqUserRole: req.user?.role,
    userId: userId,
    productSeller: productToDelete.seller?.toString(),
    userModelInfo: req.user ? {
      constructorName: req.user.constructor?.name,
      modelName: req.user.constructor?.modelName,
      collectionName: req.user.collection?.name,
      hasShopName: !!req.user.shopName,
      hasBusinessName: !!req.user.businessName,
    } : null,
    comparison: {
      sellerId: productToDelete.seller?.toString(),
      userId: userId?.toString(),
    },
  });
  
  if (!finalIsAdmin && !userOwnsProduct) {
    logger.warn(`[Delete Product] Permission denied:`, {
      userRole: userRole,
      reqUserRole: req.user?.role,
      userId: userId,
      productSeller: productToDelete.seller?.toString(),
      finalIsAdmin: finalIsAdmin,
      hasAdminRole: hasAdminRole,
      isAdminModel: isAdminModel,
      userOwnsProduct: userOwnsProduct,
      comparison: {
        sellerId: productToDelete.seller?.toString(),
        userId: userId?.toString(),
      },
      fullUserObject: req.user,
    });
    return next(new AppError('You do not have permission to delete this product', 403));
  }

  logger.info(`[Delete Product] Permission granted:`, {
    isAdmin: finalIsAdmin,
    userOwnsProduct: userOwnsProduct,
    userRole: req.user.role,
    isAdminModel: isAdminModel,
  });

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

  // Log activity after deletion (for both seller and admin)
  if (deleted && productToDelete && req.user) {
    const userRole = req.user.role === 'admin' ? 'admin' : 'seller';
    logActivityAsync({
      userId: req.user.id,
      role: userRole,
      action: 'DELETE_PRODUCT',
      description: `${userRole === 'admin' ? 'Admin' : 'Seller'} deleted product: ${productToDelete.name || 'Unknown'}`,
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

  // Ensure req.user exists
  if (!req.user || !req.user.id) {
    return next(new AppError('Authentication required', 401));
  }

  // Fetch product with seller field (may be ObjectId or populated)
  const product = await Product.findById(productId)
    .select('variants seller')
    .populate('seller', '_id'); // Populate seller to get _id for comparison

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if seller owns this product (unless admin)
  // Handle both ObjectId and string formats
  const productSellerId = product.seller?._id 
    ? product.seller._id.toString() 
    : (product.seller?.toString ? product.seller.toString() : String(product.seller));
  const userId = req.user.id?.toString ? req.user.id.toString() : String(req.user.id);
  
  // Log for debugging
  logger.info('[getProductVariants] Permission check:', {
    productId,
    productSellerId,
    userId,
    userRole: req.user.role,
    sellerMatch: productSellerId === userId,
    isAdmin: req.user.role === 'admin',
    productSellerType: typeof product.seller,
    userIdType: typeof req.user.id,
  });

  if (req.user.role !== 'admin' && productSellerId !== userId) {
    logger.warn('[getProductVariants] Permission denied:', {
      productId,
      productSellerId,
      userId,
      userRole: req.user.role,
      sellerType: typeof product.seller,
      userIdType: typeof req.user.id,
    });
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
    condition: req.body.condition || 'new', // Default to 'new' if not provided
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
  if (req.body.condition !== undefined) variant.condition = req.body.condition; // Update condition field
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

/**
 * GET /api/v1/products/similar?userId={id}
 * Get similar products based on user's recently ordered and viewed items
 */
exports.getSimilarProducts = catchAsync(async (req, res, next) => {
  const userId = req.query.userId;
  const limit = parseInt(req.query.limit) || 10;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  // Validate userId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new AppError('Invalid user ID format', 400));
  }

  try {
    // 1. Get categories from recently ordered products
    const recentOrders = await Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: 'orderItems',
        populate: {
          path: 'product',
          select: 'parentCategory subCategory',
        },
      })
      .lean();

    // 2. Get categories from recently viewed products (BrowserHistory)
    const recentViews = await BrowserHistory.find({
      user: userId,
      type: 'product',
    })
      .sort({ viewedAt: -1 })
      .limit(20)
      .lean();
    
    // Get product IDs from browser history
    const viewedProductIds = recentViews
      .map((view) => view.itemId)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    
    // Fetch products to get their categories
    const viewedProducts = viewedProductIds.length > 0
      ? await Product.find({
          _id: { $in: viewedProductIds },
        })
          .select('_id parentCategory subCategory')
          .lean()
      : [];

    // 3. Collect all category IDs
    const categoryIds = new Set();
    const productIdsToExclude = new Set();

    // From orders
    recentOrders.forEach((order) => {
      if (order.orderItems && Array.isArray(order.orderItems)) {
        order.orderItems.forEach((item) => {
          if (item.product) {
            productIdsToExclude.add(item.product._id.toString());
            if (item.product.parentCategory) {
              categoryIds.add(item.product.parentCategory.toString());
            }
            if (item.product.subCategory) {
              categoryIds.add(item.product.subCategory.toString());
            }
          }
        });
      }
    });

    // From browser history
    viewedProducts.forEach((product) => {
      if (product._id) {
        productIdsToExclude.add(product._id.toString());
        if (product.parentCategory) {
          categoryIds.add(product.parentCategory.toString());
        }
        if (product.subCategory) {
          categoryIds.add(product.subCategory.toString());
        }
      }
    });

    // If no categories found, return empty array
    if (categoryIds.size === 0) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: {
          products: [],
        },
      });
    }

    // 4. Find similar products in those categories
    const categoryArray = Array.from(categoryIds);
    const excludeProductArray = Array.from(productIdsToExclude);

    const similarProducts = await Product.find({
      $or: [
        { parentCategory: { $in: categoryArray } },
        { subCategory: { $in: categoryArray } },
      ],
      _id: { $nin: excludeProductArray },
      moderationStatus: 'approved',
      status: { $ne: 'inactive' },
    })
      .select('_id name price discountPrice images imageCover rating ratingsAverage totalSold slug')
      .populate('parentCategory', 'name slug')
      .populate('subCategory', 'name slug')
      .sort({ totalSold: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    // 5. Format response with lightweight fields
    const formattedProducts = similarProducts.map((product) => {
      // Calculate discount price if discount exists
      let finalPrice = product.price || 0;
      let discountPrice = null;

      if (product.discountPrice && product.discountPrice < product.price) {
        discountPrice = product.discountPrice;
        finalPrice = discountPrice;
      }

      // Get rating
      const rating = product.ratingsAverage || product.rating || 0;

      // Get image
      const imageUri =
        product.imageCover ||
        (product.images && product.images.length > 0 ? product.images[0] : null);

      return {
        _id: product._id,
        name: product.name,
        price: finalPrice,
        discountPrice: discountPrice,
        images: imageUri ? [imageUri] : [],
        imageCover: imageUri,
        rating: rating,
        totalSold: product.totalSold || 0,
        slug: product.slug,
        parentCategory: product.parentCategory,
        subCategory: product.subCategory,
      };
    });

    res.status(200).json({
      status: 'success',
      results: formattedProducts.length,
      data: {
        products: formattedProducts,
      },
    });
  } catch (error) {
    console.error('[getSimilarProducts] Error:', error);
    return next(new AppError('Failed to fetch similar products', 500));
  }
});
