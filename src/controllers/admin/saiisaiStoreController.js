const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');
const SaiisaiShippingFees = require('../../models/shipping/saiisaiShippingFeesModel');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const PickupCenter = require('../../models/shipping/pickupCenterModel');

// Saiisai Seller ID constant
const SAIISAI_SELLER_ID = '6970b22eaba06cadfd4b8035';

/**
 * Get all Saiisai products (public - for homepage/display)
 * Only returns active products
 */
exports.getPublicOfficialStoreProducts = catchAsync(async (req, res, next) => {
  // CRITICAL: Use $and to ensure all conditions must be met
  // This explicitly excludes deleted products in multiple ways
  const query = {
    $and: [
      {
        $or: [
          { isEazShopProduct: true },
          { seller: SAIISAI_SELLER_ID },
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
      console.warn(`[getPublicOfficialStoreProducts] ⚠️ Filtered out deleted product: ${productObj._id} - ${productObj.name}`, {
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
  console.log(`[getPublicOfficialStoreProducts] Query returned ${products.length} products, filtered to ${filteredProducts.length}`);

  res.status(200).json({
    status: 'success',
    results: filteredProducts.length,
    data: { products: filteredProducts },
  });
});

/**
 * Get all Saiisai products (admin - includes all statuses)
 */
exports.getOfficialStoreProducts = catchAsync(async (req, res, next) => {
  const products = await Product.find({
    $or: [
      { isEazShopProduct: true },
      { seller: SAIISAI_SELLER_ID },
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
 * Parse and normalize req.body variants/specifications (match seller product controller).
 * Returns true if an error was passed to next(), so caller should return.
 */
function parseAndNormalizeProductBody(req, next) {
  // Parse variants from JSON string (multipart/form-data sends strings)
  if (req.body.variants != null) {
    if (typeof req.body.variants === 'string') {
      try {
        req.body.variants = JSON.parse(req.body.variants);
      } catch (err) {
        next(new AppError('Invalid variants format', 400));
        return true;
      }
    }
    if (!Array.isArray(req.body.variants)) {
      next(new AppError('Variants must be an array', 400));
      return true;
    }
    req.body.variants = req.body.variants.map((variant) => {
      let attributes = variant.attributes || [];
      if (!Array.isArray(attributes)) attributes = [];
      attributes = attributes.filter(attr => attr && attr.key && attr.value);
      if (attributes.length === 0) attributes = [{ key: 'Default', value: 'N/A' }];
      return {
        ...variant,
        attributes,
        price: parseFloat(variant.price) || 0,
        stock: parseInt(variant.stock) || 0,
        sku: variant.sku || '',
        status: variant.status || 'active',
        condition: variant.condition || 'new',
      };
    });
  }

  // Parse specifications from JSON string
  if (req.body.specifications != null && typeof req.body.specifications === 'string') {
    try {
      req.body.specifications = JSON.parse(req.body.specifications);
    } catch (err) {
      next(new AppError('Invalid specifications format', 400));
      return true;
    }
  }

  // Manufacturer string -> object
  if (req.body.manufacturer !== undefined && typeof req.body.manufacturer === 'string' && req.body.manufacturer.trim() !== '') {
    req.body.manufacturer = { name: req.body.manufacturer.trim() };
  }
  return false;
}

/**
 * Create EazShop product
 */
exports.createEazShopProduct = catchAsync(async (req, res, next) => {
  if (parseAndNormalizeProductBody(req, next)) return;

  req.body.seller = SAIISAI_SELLER_ID;
  req.body.isEazShopProduct = true;

  const product = await Product.create(req.body);

  res.status(201).json({
    status: 'success',
    data: { product },
  });
});

/**
 * Update Saiisai product
 */
exports.updateOfficialStoreProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Verify it's an Official Store product
  const isOfficialProduct = product.isEazShopProduct ||
    product.seller?.toString() === SAIISAI_SELLER_ID;

  if (!isOfficialProduct) {
    return next(new AppError('This product is not a Saiisai product', 403));
  }

  if (parseAndNormalizeProductBody(req, next)) return;

  req.body.seller = SAIISAI_SELLER_ID;
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
 * Toggle Saiisai product status (activate/deactivate)
 */
exports.toggleOfficialStoreProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Verify it's an Official Store product
  const isOfficialStoreProduct = product.isEazShopProduct ||
    product.seller?.toString() === SAIISAI_SELLER_ID;

  if (!isOfficialStoreProduct) {
    return next(new AppError('This product is not a Saiisai product', 403));
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
 * Mark existing product as Saiisai product
 */
exports.markProductAsOfficial = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  product.isEazShopProduct = true;

  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product marked as Official Store product',
    data: { product },
  });
});

/**
 * Unmark product as Official Store product (convert back to regular product)
 */
exports.unmarkProductAsOfficial = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Only allow if product was marked as Official (not if seller is Saiisai)
  if (!product.isEazShopProduct) {
    return next(new AppError('This product is not marked as Saiisai product', 400));
  }

  // Unmark as Official Store product (but keep original seller if it was changed)
  product.isEazShopProduct = false;
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product unmarked as Saiisai product',
    data: { product },
  });
});

/**
 * Get Official Store orders
 */
exports.getOfficialStoreOrders = catchAsync(async (req, res, next) => {
  // Support both legacy EazShop seller ID and the current company seller account.
  const legacyIds = ['000000000000000000000001', SAIISAI_SELLER_ID];

  const sellerOrders = await SellerOrder.find({
    $or: [
      { seller: { $in: legacyIds } },
      { sellerType: 'eazshop' },
    ],
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
 * Get Official Store shipping fees
 */
exports.getOfficialStoreShippingFees = catchAsync(async (req, res, next) => {
  const fees = await SaiisaiShippingFees.getOrCreate();

  res.status(200).json({
    status: 'success',
    data: { fees },
  });
});

/**
 * Update Official Store shipping fees
 */
exports.updateOfficialStoreShippingFees = catchAsync(async (req, res, next) => {
  const fees = await SaiisaiShippingFees.getOrCreate();

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

