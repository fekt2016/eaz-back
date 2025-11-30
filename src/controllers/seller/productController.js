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

//product middleWare
exports.setProductIds = (req, res, next) => {
  if (!req.body.seller) req.body.seller = req.user.id;
  
  // If admin is creating an EazShop product, set seller to EazShop seller ID
  const EAZSHOP_SELLER_ID = '000000000000000000000001';
  if (req.user.role === 'admin' && req.body.isEazShopProduct === true) {
    req.body.seller = EAZSHOP_SELLER_ID;
    req.body.isEazShopProduct = true;
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
  const products = await Product.find({ seller: req.params.sellerId });
  if (!products) return next(new AppError('Product not found', 404));
  res.status(200).json({ status: 'success', data: { products } });
});

//getting all products by admin
exports.getAllProduct = handleFactory.getAll(Product, [
  { path: 'seller', select: 'name email phone shopName' },
  { path: 'parentCategory', select: 'name slug' },
  { path: 'subCategory', select: 'name slug' },
]);

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
  const product = await Product.findById(req.params.id).populate({
    path: 'parentCategory',
    select: 'name slug',
  });

 
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { product },
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
  res.json = function(data) {
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
  res.json = function(data) {
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
  res.json = function(data) {
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
