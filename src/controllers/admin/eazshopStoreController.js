const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');
const EazShopShippingFees = require('../../models/shipping/eazshopShippingFeesModel');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const PickupCenter = require('../../models/shipping/pickupCenterModel');

// EazShop Seller ID constant
const EAZSHOP_SELLER_ID = '000000000000000000000001';

/**
 * Get all EazShop products (public - for homepage/display)
 * Only returns active products
 */
exports.getPublicEazShopProducts = catchAsync(async (req, res, next) => {
  // CRITICAL: Use $and to ensure all conditions must be met
  // This explicitly excludes deleted products in multiple ways
  const query = {
    $and: [
      {
        $or: [
          { isEazShopProduct: true },
          { seller: EAZSHOP_SELLER_ID },
        ],
      },
      {
        // Only active products (excludes archived, inactive, draft)
        // This already excludes 'archived' status
        status: { $in: ['active', 'out_of_stock'] },
      },
      {
        moderationStatus: 'approved', // Only approved products
      },
      {
        // Exclude deleted products - check all possible deletion states
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false },
          { isDeleted: null },
        ],
      },
      {
        $or: [
          { isDeletedByAdmin: { $exists: false } },
          { isDeletedByAdmin: false },
          { isDeletedByAdmin: null },
        ],
      },
      {
        $or: [
          { isDeletedBySeller: { $exists: false } },
          { isDeletedBySeller: false },
          { isDeletedBySeller: null },
        ],
      },
    ],
  };

  const products = await Product.find(query)
    .populate('seller', 'shopName name')
    .populate('parentCategory', 'name slug')
    .populate('subCategory', 'name slug')
    .select('-__v') // Exclude version field
    .sort({ createdAt: -1 })
    .limit(50); // Limit for performance

  // CRITICAL: Additional server-side filter as final safety check
  // This catches any products that might have slipped through the query
  const filteredProducts = products.filter(product => {
    // Convert to plain object if it's a Mongoose document
    const productObj = product.toObject ? product.toObject() : product;
    
    // Double-check: exclude any products that are marked as deleted
    const isDeleted = productObj.isDeleted === true || 
                      productObj.isDeletedByAdmin === true || 
                      productObj.isDeletedBySeller === true ||
                      productObj.status === 'archived' ||
                      productObj.status === 'inactive';
    
    if (isDeleted) {
      console.warn(`[getPublicEazShopProducts] ⚠️ Filtered out deleted product: ${productObj._id} - ${productObj.name}`, {
        isDeleted: productObj.isDeleted,
        isDeletedByAdmin: productObj.isDeletedByAdmin,
        isDeletedBySeller: productObj.isDeletedBySeller,
        status: productObj.status,
      });
      return false;
    }
    return true;
  });

  // Log for debugging
  console.log(`[getPublicEazShopProducts] Query returned ${products.length} products, filtered to ${filteredProducts.length}`);
  if (filteredProducts.length > 0) {
    console.log('[getPublicEazShopProducts] Sample product:', {
      id: filteredProducts[0]._id,
      name: filteredProducts[0].name,
      status: filteredProducts[0].status,
      isDeleted: filteredProducts[0].isDeleted,
      isDeletedByAdmin: filteredProducts[0].isDeletedByAdmin,
      isDeletedBySeller: filteredProducts[0].isDeletedBySeller,
    });
  }

  res.status(200).json({
    status: 'success',
    results: filteredProducts.length,
    data: { products: filteredProducts },
  });
});

/**
 * Get all EazShop products (admin - includes all statuses)
 */
exports.getEazShopProducts = catchAsync(async (req, res, next) => {
  const products = await Product.find({
    $or: [
      { isEazShopProduct: true },
      { seller: EAZSHOP_SELLER_ID },
    ],
  })
    .populate('seller', 'shopName name')
    .populate('parentCategory', 'name slug')
    .populate('subCategory', 'name slug')
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: { products },
  });
});

/**
 * Create EazShop product
 */
exports.createEazShopProduct = catchAsync(async (req, res, next) => {
  // Ensure seller is set to EazShop seller
  req.body.seller = EAZSHOP_SELLER_ID;
  req.body.isEazShopProduct = true;

  const product = await Product.create(req.body);

  res.status(201).json({
    status: 'success',
    data: { product },
  });
});

/**
 * Update EazShop product
 */
exports.updateEazShopProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Verify it's an EazShop product
  const isEazShopProduct = product.isEazShopProduct || 
    product.seller?.toString() === EAZSHOP_SELLER_ID;

  if (!isEazShopProduct) {
    return next(new AppError('This product is not an EazShop product', 403));
  }

  // Ensure seller remains EazShop seller
  req.body.seller = EAZSHOP_SELLER_ID;
  req.body.isEazShopProduct = true;

  const updatedProduct = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  res.status(200).json({
    status: 'success',
    data: { product: updatedProduct },
  });
});

/**
 * Toggle EazShop product status (activate/deactivate)
 */
exports.toggleEazShopProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Verify it's an EazShop product
  const isEazShopProduct = product.isEazShopProduct || 
    product.seller?.toString() === EAZSHOP_SELLER_ID;

  if (!isEazShopProduct) {
    return next(new AppError('This product is not an EazShop product', 403));
  }

  // Toggle status
  const newStatus = product.status === 'active' ? 'inactive' : 'active';
  product.status = newStatus;
  await product.save();

  res.status(200).json({
    status: 'success',
    data: { product },
  });
});

/**
 * Mark existing product as EazShop product
 */
exports.markProductAsEazShop = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Mark as EazShop product
  product.isEazShopProduct = true;
  product.seller = EAZSHOP_SELLER_ID;
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product marked as EazShop product',
    data: { product },
  });
});

/**
 * Unmark product as EazShop product (convert back to regular product)
 */
exports.unmarkProductAsEazShop = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Only allow if product was marked as EazShop (not if seller is EazShop)
  if (!product.isEazShopProduct) {
    return next(new AppError('This product is not marked as EazShop product', 400));
  }

  // Unmark as EazShop product (but keep original seller if it was changed)
  product.isEazShopProduct = false;
  // Note: We don't change the seller back as we don't know the original seller
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product unmarked as EazShop product',
    data: { product },
  });
});

/**
 * Get EazShop orders
 */
exports.getEazShopOrders = catchAsync(async (req, res, next) => {
  const sellerOrders = await SellerOrder.find({
    seller: EAZSHOP_SELLER_ID,
    sellerType: 'eazshop',
  })
    .populate('order')
    .populate('items')
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: sellerOrders.length,
    data: { orders: sellerOrders },
  });
});

/**
 * Get EazShop shipping fees
 */
exports.getEazShopShippingFees = catchAsync(async (req, res, next) => {
  const fees = await EazShopShippingFees.getOrCreate();

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

/**
 * Update EazShop shipping fees
 */
exports.updateEazShopShippingFees = catchAsync(async (req, res, next) => {
  const fees = await EazShopShippingFees.getOrCreate();

  // Update fees
  if (req.body.sameCity !== undefined) fees.sameCity = req.body.sameCity;
  if (req.body.crossCity !== undefined) fees.crossCity = req.body.crossCity;
  if (req.body.heavyItem !== undefined) fees.heavyItem = req.body.heavyItem;
  if (req.body.freeDeliveryThreshold !== undefined) {
    fees.freeDeliveryThreshold = req.body.freeDeliveryThreshold;
  }

  await fees.save();

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

/**
 * Get pickup centers (for EazShop store management)
 */
exports.getPickupCenters = catchAsync(async (req, res, next) => {
  const query = {};
  
  // Filter by city if provided
  if (req.query.city) {
    query.city = req.query.city.toUpperCase();
  }
  
  // Filter by active status if provided
  if (req.query.isActive !== undefined) {
    query.isActive = req.query.isActive === 'true';
  }

  const pickupCenters = await PickupCenter.find(query).sort({ city: 1, area: 1 });

  res.status(200).json({
    status: 'success',
    results: pickupCenters.length,
    data: { pickupCenters },
  });
});

