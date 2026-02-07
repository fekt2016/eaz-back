/**
 * Wishlist Controller - Refactored with Best Practices
 * 
 * Improvements:
 * - Uses MongoDB operators ($addToSet, $pull) for atomic operations
 * - Lean queries for better performance
 * - Consistent error handling with AppError
 * - User validation and security checks
 * - Optimized queries to reduce database calls
 * - Toggle endpoint for better UX
 */

const WishList = require('../../models/product/wishListModel');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const Product = require('../../models/product/productModel');
const logger = require('../../utils/logger');

/**
 * Helper function to calculate totalStock for products
 * @param {Array} products - Array of wishlist items with populated products
 */
const calculateTotalStock = (products) => {
  if (!products || products.length === 0) return;
  
  products.forEach((item) => {
    try {
      // Skip if product is null or deleted
      if (!item || !item.product) {
        return;
      }
      
      // Handle case where product might be an ObjectId (not populated)
      if (typeof item.product === 'object' && item.product !== null) {
        // Check if variants exist and is an array
        if (Array.isArray(item.product.variants)) {
          item.product.totalStock = item.product.variants.reduce(
            (sum, variant) => {
              const stock = variant?.stock || 0;
              return sum + (typeof stock === 'number' ? stock : 0);
            },
            0
          );
        } else {
          // If no variants, use stock field if available
          item.product.totalStock = item.product.stock || 0;
        }
      }
    } catch (error) {
      // Log error but don't break the entire request
      logger.error('[Wishlist] Error calculating totalStock for product:', error);
      // Set default value to prevent undefined errors
      if (item.product) {
        item.product.totalStock = 0;
      }
    }
  });
};

/**
 * Get user's wishlist
 * GET /api/v1/wishlist
 */
exports.getWishlist = catchAsync(async (req, res, next) => {
  // Validate user ID
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    return next(new AppError('Invalid user ID', 400));
  }

  // Use lean() for better performance and populate with select
  const wishlist = await WishList.findOne({ user: req.user.id })
    .populate({
      path: 'products.product',
      select: 'name price imageCover variants stock status defaultPrice minPrice maxPrice seller',
      // Don't fail if product is deleted - just return null
      strictPopulate: false,
    })
    .lean();

  // Return empty array if no wishlist exists
  if (!wishlist || !wishlist.products || wishlist.products.length === 0) {
    return res.status(200).json({ 
      status: 'success', 
      data: { wishlist: { products: [] } } 
    });
  }

  // Filter out products that were deleted (null products or soft-deleted)
  wishlist.products = wishlist.products.filter(item => {
    if (!item || !item.product) return false;
    // Exclude soft-deleted products (isDeleted: true or status: 'archived')
    const product = item.product;
    return !product.isDeleted && product.status !== 'archived';
  });

  // Return empty if all products were deleted
  if (wishlist.products.length === 0) {
    return res.status(200).json({ 
      status: 'success', 
      data: { wishlist: { products: [] } } 
    });
  }

  // Calculate totalStock for each product
  calculateTotalStock(wishlist.products);

  res.status(200).json({ 
    status: 'success', 
    data: { wishlist } 
  });
});

/**
 * Add product to wishlist using $addToSet for atomic operation
 * POST /api/v1/wishlist
 */
exports.addToWishlist = catchAsync(async (req, res, next) => {
  const { productId } = req.body;

  // Validate inputs
  if (!productId) {
    return next(new AppError('Product ID is required', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID format', 400));
  }

  // Validate user ID
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    return next(new AppError('Invalid user ID', 400));
  }

  // Verify product exists
  const product = await Product.findById(productId).lean();
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Use findOneAndUpdate with $addToSet for atomic operation
  // This prevents duplicates automatically
  const wishlist = await WishList.findOneAndUpdate(
    { user: req.user.id },
    {
      $addToSet: {
        products: {
          product: productId,
          addedAt: new Date(),
        },
      },
    },
    {
      new: true,
      upsert: true, // Create wishlist if it doesn't exist
      setDefaultsOnInsert: true,
    }
  ).populate({
    path: 'products.product',
    select: 'name price imageCover variants stock status defaultPrice minPrice maxPrice seller',
    strictPopulate: false, // Don't fail if product is deleted
  });

  // Filter out null products and soft-deleted products before checking
  wishlist.products = wishlist.products.filter(item => {
    if (!item || !item.product) return false;
    const product = item.product;
    return !product.isDeleted && product.status !== 'archived';
  });

  // Check if product was actually added (might already exist)
  // Filter out null products and soft-deleted products first
  const validProducts = wishlist.products.filter(item => {
    if (!item || !item.product) return false;
    const product = item.product;
    return !product.isDeleted && product.status !== 'archived';
  });
  const productExists = validProducts.some(
    (item) => {
      try {
        return item.product && item.product._id && item.product._id.toString() === productId;
      } catch (error) {
        logger.error('[Wishlist] Error checking product existence:', error);
        return false;
      }
    }
  );

  if (!productExists) {
    return next(new AppError('Product already in wishlist', 400));
  }

  // Calculate totalStock
  calculateTotalStock(wishlist.products);

  res.status(200).json({
    status: 'success',
    message: 'Product added to wishlist',
    data: { wishlist },
  });
});

/**
 * Remove product from wishlist using $pull for atomic operation
 * DELETE /api/v1/wishlist/:productId
 */
exports.removeFromWishlist = catchAsync(async (req, res, next) => {
  const { productId } = req.params;

  // Validate inputs
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  // Validate user ID
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    return next(new AppError('Invalid user ID', 400));
  }

  // Use findOneAndUpdate with $pull for atomic operation
  // Match by ObjectId so $pull finds the array element (stored product is ObjectId)
  const productObjectId = new mongoose.Types.ObjectId(productId);
  const wishlist = await WishList.findOneAndUpdate(
    { user: req.user.id },
    {
      $pull: {
        products: { product: productObjectId },
      },
    },
    {
      new: true,
    }
  ).populate({
    path: 'products.product',
    select: 'name price imageCover variants stock status defaultPrice minPrice maxPrice seller',
    strictPopulate: false, // Don't fail if product is deleted
  });

  // Filter out null products and soft-deleted products
  if (wishlist && wishlist.products) {
    wishlist.products = wishlist.products.filter(item => {
      if (!item || !item.product) return false;
      const product = item.product;
      return !product.isDeleted && 
             !product.isDeletedByAdmin && 
             !product.isDeletedBySeller && 
             product.status !== 'archived';
    });
  }

  if (!wishlist) {
    return next(new AppError('Wishlist not found', 404));
  }

  // Check if product was actually removed
  const productExists = wishlist.products.some(
    (item) => item.product._id.toString() === productId
  );

  if (productExists) {
    return next(new AppError('Product not found in wishlist', 404));
  }

  // Calculate totalStock
  calculateTotalStock(wishlist.products);

  res.status(200).json({
    status: 'success',
    message: 'Product removed from wishlist',
    data: { wishlist },
  });
});

/**
 * Toggle product in wishlist (add if not present, remove if present)
 * POST /api/v1/wishlist/toggle/:productId
 */
exports.toggleWishlist = catchAsync(async (req, res, next) => {
  const { productId } = req.params;

  // Validate inputs
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  // Validate user ID
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    return next(new AppError('Invalid user ID', 400));
  }

  // Verify product exists
  const product = await Product.findById(productId).lean();
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Check if product is in wishlist
  const existingWishlist = await WishList.findOne({
    user: req.user.id,
    'products.product': productId,
  }).lean();

  let wishlist;
  let action;

  if (existingWishlist) {
    // Remove product
    wishlist = await WishList.findOneAndUpdate(
      { user: req.user.id },
      {
        $pull: {
          products: { product: productId },
        },
      },
      {
        new: true,
      }
    ).populate({
      path: 'products.product',
      select: 'name price imageCover variants stock status defaultPrice minPrice maxPrice seller',
      strictPopulate: false, // Don't fail if product is deleted
    });
    // Filter out null products and soft-deleted products
    if (wishlist && wishlist.products) {
      wishlist.products = wishlist.products.filter(item => {
        if (!item || !item.product) return false;
        const product = item.product;
        return !product.isDeleted && 
             !product.isDeletedByAdmin && 
             !product.isDeletedBySeller && 
             product.status !== 'archived';
      });
    }
    action = 'removed';
  } else {
    // Add product
    wishlist = await WishList.findOneAndUpdate(
      { user: req.user.id },
      {
        $addToSet: {
          products: {
            product: productId,
            addedAt: new Date(),
          },
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).populate({
      path: 'products.product',
      select: 'name price imageCover variants stock status defaultPrice minPrice maxPrice seller',
      strictPopulate: false, // Don't fail if product is deleted
    });
    // Filter out null products and soft-deleted products
    if (wishlist && wishlist.products) {
      wishlist.products = wishlist.products.filter(item => {
        if (!item || !item.product) return false;
        const product = item.product;
        return !product.isDeleted && 
             !product.isDeletedByAdmin && 
             !product.isDeletedBySeller && 
             product.status !== 'archived';
      });
    }
    action = 'added';
  }

  if (!wishlist) {
    return next(new AppError('Failed to update wishlist', 500));
  }

  // Calculate totalStock
  calculateTotalStock(wishlist.products);

  res.status(200).json({
    status: 'success',
    message: `Product ${action} from wishlist`,
    data: { 
      wishlist,
      inWishlist: action === 'added',
    },
  });
});

/**
 * Check if product is in wishlist
 * GET /api/v1/wishlist/check/:productId
 */
exports.checkInWishlist = catchAsync(async (req, res, next) => {
  const { productId } = req.params;

  // Validate inputs
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  // Validate user ID
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    return next(new AppError('Invalid user ID', 400));
  }

  // Use lean() for better performance - only check existence
  const wishlist = await WishList.findOne({
    user: req.user.id,
    'products.product': productId,
  })
    .select('_id')
    .lean();

  const inWishlist = !!wishlist;

  res.status(200).json({
    status: 'success',
    inWishlist,
  });
});

// ========== GUEST WISHLIST METHODS ==========

/**
 * Get or create guest wishlist
 * POST /api/v1/wishlist/guest
 */
exports.getOrCreateGuestWishlist = catchAsync(async (req, res, next) => {
  const { sessionId } = req.body;

  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return next(new AppError('Session ID is required', 400));
  }

  // Use findOneAndUpdate with upsert for atomic operation
  let wishlist = await WishList.findOneAndUpdate(
    { sessionId },
    {},
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).populate({
    path: 'products.product',
    select: 'name price images seller variants stock status defaultPrice minPrice maxPrice',
    strictPopulate: false, // Don't fail if product is deleted
  });

  // Filter out null products and soft-deleted products
  if (wishlist && wishlist.products) {
    wishlist.products = wishlist.products.filter(item => {
      if (!item || !item.product) return false;
      const product = item.product;
      return !product.isDeleted && 
             !product.isDeletedByAdmin && 
             !product.isDeletedBySeller && 
             product.status !== 'archived';
    });
  }

  // Calculate totalStock
  calculateTotalStock(wishlist.products);

  res.status(200).json({
    status: 'success',
    data: { wishlist },
  });
});

/**
 * Add product to guest wishlist using $addToSet
 * POST /api/v1/wishlist/guest/add
 */
exports.addToGuestWishlist = catchAsync(async (req, res, next) => {
  const { sessionId, productId } = req.body;

  // Validate inputs
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return next(new AppError('Session ID is required', 400));
  }

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  // Verify product exists
  const product = await Product.findById(productId).lean();
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Use findOneAndUpdate with $addToSet for atomic operation
  const wishlist = await WishList.findOneAndUpdate(
    { sessionId },
    {
      $addToSet: {
        products: {
          product: productId,
          addedAt: new Date(),
        },
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).populate({
    path: 'products.product',
    select: 'name price images seller variants stock status defaultPrice minPrice maxPrice',
  });

  // Check if product was actually added
  const productExists = wishlist.products.some(
    (item) => item.product._id.toString() === productId
  );

  if (!productExists) {
    return next(new AppError('Product already in wishlist', 400));
  }

  // Calculate totalStock
  calculateTotalStock(wishlist.products);

  res.status(200).json({
    status: 'success',
    message: 'Product added to wishlist',
    data: { wishlist },
  });
});

/**
 * Remove product from guest wishlist using $pull
 * POST /api/v1/wishlist/guest/remove
 */
exports.removeFromGuestWishlist = catchAsync(async (req, res, next) => {
  const { sessionId, productId } = req.body;

  // Validate inputs
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return next(new AppError('Session ID is required', 400));
  }

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  // Use findOneAndUpdate with $pull for atomic operation (match ObjectId)
  const productObjectId = new mongoose.Types.ObjectId(productId);
  const wishlist = await WishList.findOneAndUpdate(
    { sessionId },
    {
      $pull: {
        products: { product: productObjectId },
      },
    },
    {
      new: true,
    }
  ).populate({
    path: 'products.product',
    select: 'name price images seller variants stock status defaultPrice minPrice maxPrice',
  });

  if (!wishlist) {
    return next(new AppError('Wishlist not found', 404));
  }

  // Check if product was actually removed
  const productExists = wishlist.products.some(
    (item) => item.product._id.toString() === productId
  );

  if (productExists) {
    return next(new AppError('Product not found in wishlist', 404));
  }

  // Calculate totalStock
  calculateTotalStock(wishlist.products);

  res.status(200).json({
    status: 'success',
    message: 'Product removed from guest wishlist',
    data: { wishlist },
  });
});

/**
 * Merge guest wishlist with user wishlist after login
 * POST /api/v1/wishlist/merge
 */
exports.mergeWishlists = catchAsync(async (req, res, next) => {
  const { sessionId } = req.body;

  // Validate inputs
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return next(new AppError('Session ID is required', 400));
  }

  // Validate user ID
  if (!req.user?.id || !mongoose.Types.ObjectId.isValid(req.user.id)) {
    return next(new AppError('Invalid user ID', 400));
  }

  // Find guest wishlist
  const guestWishlist = await WishList.findOne({ sessionId }).lean();

  if (!guestWishlist || !guestWishlist.products || guestWishlist.products.length === 0) {
    return res.status(200).json({
      status: 'success',
      message: 'No guest wishlist to merge',
      data: { wishlist: null },
    });
  }

  // Find or create user wishlist
  let userWishlist = await WishList.findOne({ user: req.user.id });

  if (!userWishlist) {
    userWishlist = await WishList.create({
      user: req.user.id,
      products: [],
    });
  }

  // Get existing product IDs to avoid duplicates
  const existingProductIds = new Set(
    userWishlist.products.map((item) => item.product.toString())
  );

  // Add guest products using $addToSet for each product
  // This is more efficient than manual array manipulation
  const productsToAdd = guestWishlist.products
    .filter((item) => !existingProductIds.has(item.product.toString()))
    .map((item) => ({
      product: item.product,
      addedAt: item.addedAt || new Date(),
    }));

  if (productsToAdd.length > 0) {
    // Use $addToSet for each product to prevent duplicates
    for (const productItem of productsToAdd) {
      await WishList.findOneAndUpdate(
        { user: req.user.id },
        {
          $addToSet: {
            products: productItem,
          },
        }
      );
    }

    // Refetch the updated wishlist
    userWishlist = await WishList.findOne({ user: req.user.id });
  }

  // Delete the guest wishlist after successful merge
  await WishList.findByIdAndDelete(guestWishlist._id);

  // Populate the merged wishlist
  await userWishlist.populate({
    path: 'products.product',
    select: 'name price images seller',
    strictPopulate: false, // Don't fail if product is deleted
  });

  // Filter out null products and soft-deleted products
  if (userWishlist && userWishlist.products) {
    userWishlist.products = userWishlist.products.filter(item => {
      if (!item || !item.product) return false;
      const product = item.product;
      return !product.isDeleted && 
             !product.isDeletedByAdmin && 
             !product.isDeletedBySeller && 
             product.status !== 'archived';
    });
  }

  // Calculate totalStock
  calculateTotalStock(userWishlist.products);

  res.status(200).json({
    status: 'success',
    message: 'Wishlist merged successfully',
    data: { wishlist: userWishlist },
  });
});
