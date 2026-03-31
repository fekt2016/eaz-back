const Cart = require('../../models/product/cartModel');
const handleFactory = require('../shared/handleFactory');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const mongoose = require('mongoose');
const Product = require('../../models/product/productModel');
const logger = require('../../utils/logger');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const {
  getPromosFromAds,
  getApplicablePromos,
  applyPromosToPrice,
} = require('../seller/productController');

// Set user ID from authenticated user
exports.setUserId = (req, res, next) => {
  req.body.user = req.user.id;
  next();
};

/**
 * Normalize variant to a valid ObjectId string or null.
 * Prevents storing stringified variant objects (from old clients/bugs).
 * If value looks like JSON (starts with { or [), try to extract _id; otherwise reject.
 */
function normalizeVariantId(value) {
  if (value == null || value === '') return null;
  const str =
    typeof value === 'object' && value !== null && value._id != null
      ? (value._id.toString ? value._id.toString() : String(value._id))
      : String(value);
  const trimmed = str.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const id = parsed?._id ?? parsed?.id;
      return id != null && mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null;
    } catch {
      return null;
    }
  }
  return mongoose.Types.ObjectId.isValid(trimmed) ? trimmed : null;
}

/**
 * Get variant ID from a cart item for lookup. If item.variant is a stringified
 * object (invalid), return null so we don't match and we return variant: null.
 */
function getVariantIdForLookup(item) {
  const raw = item.variant;
  if (raw == null || raw === '') return null;
  const str = String(raw).trim();
  if (str.startsWith('{') || str.startsWith('[')) {
    // Attempt to parse existing stringified Object to rescue the cart
    try {
      // Sometimes it's not valid JSON, but rather `"{ _id: new ObjectId('...') }"`
      // We'll use a regex to snatch the hex id
      const match = str.match(/(?:_id|id)\s*["': ]+([0-9a-fA-F]{24})/);
      if (match && match[1]) {
        return mongoose.Types.ObjectId.isValid(match[1]) ? match[1] : null;
      }

      const parsed = JSON.parse(str);
      const id = parsed?._id ?? parsed?.id;
      return id != null && mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null;
    } catch {
      // Fallback regex if it's strictly a mongoose string representation
      const match = str.match(/([0-9a-fA-F]{24})/);
      return match && match[1] && mongoose.Types.ObjectId.isValid(match[1]) ? match[1] : null;
    }
  }
  return mongoose.Types.ObjectId.isValid(str) ? str : null;
}

// Helper function to populate cart with product details (include promotionKey for promo price)
const populateCart = (cart) => {
  return cart.populate({
    path: 'products.product',
    // Include isPreOrder + pre-order metadata so frontend (cart, checkout)
    // can clearly label pre-order items and show international shipping info.
    select:
      'name price priceInclVat imageCover variants seller isEazShopProduct promotionKey isPreOrder preOrderAvailableDate preOrderNote preOrderOriginCountry',
    populate: {
      path: 'seller',
      select: '_id name shopName role shopAddress location',
    },
    options: { virtuals: true }, // Include virtual properties
  });
};

/**
 * Shared logic to process and map cart products, resolving variant IDs to full objects.
 * This ensures consistency between getMyCart, getCart, and addToCart.
 */
const mapCartProducts = (populatedProducts) => {
  if (!populatedProducts || !Array.isArray(populatedProducts)) return [];

  return populatedProducts
    .filter((item) => item.product) // Filter out items with null products
    .map((item) => {
      const variantId = getVariantIdForLookup(item);
      const product = item.product;

      let selectedVariant = null;
      if (variantId && product && Array.isArray(product.variants)) {
        // Find variant by ID
        const found = product.variants.find(v => (v._id || v.id || '').toString() === variantId);
        if (found) {
          // Convert to plain object to ensure all fields (images, attributes, etc.) are included
          selectedVariant = typeof found.toObject === 'function' ? found.toObject() : JSON.parse(JSON.stringify(found));

          // Ensure images is an array of strings (sometimes Mongoose subdocs return objects for array items)
          if (selectedVariant.images && Array.isArray(selectedVariant.images)) {
            selectedVariant.images = selectedVariant.images.map(img => {
              if (typeof img === 'string') return img;
              if (img && typeof img === 'object' && img.url) return img.url;
              return String(img);
            }).filter(Boolean);
          }
        }
      }

      const itemObj = typeof item.toObject === 'function' ? item.toObject() : { ...item };

      return {
        ...itemObj,
        variant: selectedVariant, // Inject full variant object
      };
    });
};

// Apply promo pricing to cart products; mutates items in place, adds unitPrice and originalUnitPrice when discounted
const applyCartPromoPricing = async (items) => {
  if (!items?.length) return;

  const pricingService = require('../../services/pricing/pricingService');
  let promos;
  try {
    promos = await getPromosFromAds();
  } catch (e) {
    logger.warn('[cart] Could not load promos for cart:', e?.message);
    return;
  }

  for (const item of items) {
    const product = item.product;
    if (!product) continue;
    const variant = item.variant;

    // 1. Get base price (VAT exclusive)
    const basePrice = (variant && variant.price != null)
      ? Number(variant.price)
      : Number(product.price ?? product.defaultPrice ?? 0);

    if (!basePrice) {
      item.unitPrice = 0;
      continue;
    }

    // 2. Add VAT to get standard inclusive price for promo calculation
    const taxService = require('../../services/tax/taxService');
    const vatComputed = await taxService.addVatToBase(basePrice);
    const standardPriceInclVat = vatComputed.priceInclVat;

    // 3. Apply promotions to the standard inclusive price
    const applicable = getApplicablePromos(product, promos);
    const { unitPrice: finalInclVat } = applyPromosToPrice(standardPriceInclVat, applicable);
    const promoDiscount = Math.max(0, standardPriceInclVat - finalInclVat);

    // 4. Get final pricing breakdown using the unified service (P2-FIX 2)
    const pricing = await pricingService.calculateItemPricing(basePrice, promoDiscount);

    item.unitPrice = pricing.unitPrice;
    if (pricing.promoDiscount > 0) {
      item.originalUnitPrice = standardPriceInclVat;
    }

    // Attach breakdown for frontend display if needed
    item.pricingBreakdown = pricing;
  }
};

// Get current user's cart
exports.getMyCart = catchAsync(async (req, res, next) => {
  let cart = await Cart.findOne({ user: req.user.id });

  // If no cart exists, create an empty one
  if (!cart) {
    cart = await Cart.create({
      user: req.user.id,
      products: [],
    });
  }

  // Populate cart with product details
  const populatedCart = await populateCart(Cart.findById(cart._id));

  if (!populatedCart) {
    return next(new AppError('Failed to load cart', 500));
  }

  // Verify cart ownership
  if (populatedCart.user.toString() !== req.user.id) {
    return next(
      new AppError('You do not have permission to view this cart', 403),
    );
  }

  // Map products to include full variant objects
  const mappedProducts = mapCartProducts(populatedCart.products);
  await applyCartPromoPricing(mappedProducts);

  returnCart = {
    ...populatedCart.toObject(),
    products: mappedProducts
  };

  // Sanitize DB: if any cart item had stringified variant, fix it so we don't keep returning null
  const rawCart = await Cart.findOne({ user: req.user.id });
  if (rawCart && rawCart.products?.length) {
    let needsSave = false;
    for (const item of rawCart.products) {
      const v = item.variant;
      if (typeof v === 'string' && (v.trim().startsWith('{') || v.trim().startsWith('['))) {
        item.variant = undefined;
        needsSave = true;
      }
    }
    if (needsSave) {
      rawCart.markModified('products');
      await rawCart.save();
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      cart: returnCart,
    },
  });
});

// Max quantity per line item (cart abuse prevention)
const MAX_QUANTITY_PER_ITEM = 999;

// Update specific cart item (user operation)
// Backend: cartController.js
exports.updateCartItem = catchAsync(async (req, res, next) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  // SECURITY: Validate quantity type and range before any DB work
  const rawQty = quantity != null ? Number(quantity) : NaN;
  if (!Number.isInteger(rawQty) || rawQty < 1) {
    return next(new AppError('Quantity must be a positive integer', 400));
  }
  if (rawQty > MAX_QUANTITY_PER_ITEM) {
    return next(new AppError(`Quantity cannot exceed ${MAX_QUANTITY_PER_ITEM} per item`, 400));
  }

  // Find cart and update item (include stock for validation)
  const cart = await Cart.findOne({ user: req.user._id }).populate({
    path: 'products.product',
    select: 'name price imageCover variants stock',
  });

  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  const itemIndex = cart.products.findIndex(
    (item) => item._id.toString() === itemId,
  );

  if (itemIndex === -1) {
    return next(new AppError('Item not found in cart', 404));
  }

  // Check if product exists
  if (!cart.products[itemIndex].product) {
    // Remove item with null product
    cart.products.splice(itemIndex, 1);
    await cart.save();
    return next(new AppError('Product no longer available. Item removed from cart.', 404));
  }

  // SECURITY: Resolve sellable unit (variant or product) and available stock
  const product = cart.products[itemIndex].product;
  let availableStock = 0;
  const variantIdForStock = getVariantIdForLookup(cart.products[itemIndex]);
  if (product.variants && product.variants.length > 0 && variantIdForStock) {
    const variant = product.variants.find(
      (v) => v._id && v._id.toString() === variantIdForStock,
    );
    if (variant) {
      availableStock = Math.max(0, (variant.stock || 0) - (variant.sold || 0));
    }
  } else {
    availableStock = Math.max(0, (product.stock || 0) - (product.sold || 0));
  }

  // Gracefully clamp the requested quantity to available stock to prevent stuck carts (e.g., when trying to lower quantity from 15 to 14, but stock is 10)
  let finalQty = rawQty;
  let didClamp = false;
  if (rawQty > availableStock) {
    finalQty = availableStock;
    didClamp = true;

    // If the cart item was already effectively 0 available stock, we should remove the item instead.
    // However, if the user requested > 0 and stock is > 0, we just clamp it.
    if (availableStock === 0) {
      return next(new AppError('This item is currently out of stock.', 400));
    }
  }

  cart.products[itemIndex].quantity = finalQty;
  const updatedCart = await cart.save();
  const populatedCart = await populateCart(Cart.findById(updatedCart._id));

  if (!populatedCart) {
    return next(new AppError('Failed to load cart after update', 500));
  }

  // Map products to include full variant objects
  const mappedProducts = mapCartProducts(populatedCart.products);
  await applyCartPromoPricing(mappedProducts);

  const returnCart = {
    ...populatedCart.toObject(),
    products: mappedProducts
  };

  // Return the FULL updated cart, not just the item
  res.status(200).json({
    status: 'success',
    data: {
      cart: returnCart,
    },
  });
});

// Delete cart item (user operation)
// controllers/cartController.js
exports.deleteCartItem = catchAsync(async (req, res, next) => {
  logger.info('deleteCartItem params:', req.params, 'user:', req.user.id);

  const { itemId } = req.params;

  // Pull the subdoc whose _id === itemId
  const cart = await Cart.findOneAndUpdate(
    { user: req.user.id },
    { $pull: { products: { _id: itemId } } },
    { new: true },
  );

  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  const populatedCart = await populateCart(Cart.findById(cart._id));

  if (!populatedCart) {
    return next(new AppError('Failed to load cart after item removal', 500));
  }

  // Map products to include full variant objects
  const mappedProducts = mapCartProducts(populatedCart.products);
  await applyCartPromoPricing(mappedProducts);

  const returnCart = {
    ...populatedCart.toObject(),
    products: mappedProducts
  };

  res.status(200).json({
    status: 'success',
    data: { cart: returnCart },
  });
});

exports.clearCart = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const cart = await Cart.findOneAndUpdate(
    { user: userId },
    { $set: { products: [], totalPrice: 0 } }, // 👈 Now you're clearing the correct field
    { new: true, runValidators: true },
  );

  res.status(204).json({ data: null, status: 'success' });
});

// --- Admin operations below ---
exports.addToCart = catchAsync(async (req, res, next) => {
  const rawProductId = req.body.productId;
  const rawQuantity = req.body.quantity;
  const variantId = req.body.variantId;

  const userId = req.user.id;

  // Normalize productId (client may send string or object with _id)
  const productId = rawProductId != null
    ? (typeof rawProductId === 'object' && rawProductId._id != null ? rawProductId._id : rawProductId)
    : null;
  const productIdStr = productId != null ? String(productId) : '';

  // Normalize quantity (client may send string "1")
  const quantity = rawQuantity != null ? Math.floor(Number(rawQuantity)) : NaN;

  // Validate input
  if (!productIdStr || !mongoose.Types.ObjectId.isValid(productIdStr)) {
    return next(new AppError('Invalid product ID', 400));
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return next(new AppError('Quantity must be a positive integer', 400));
  }

  // Enforce buyer visibility rules before allowing cart additions.
  // If a product is not approved/active/visible, buyers must not add it.
  const productDoc = await Product.findById(productIdStr)
    .select(
      'name moderationStatus status isVisible isDeleted isDeletedByAdmin isDeletedBySeller'
    )
    .lean();
  if (!productDoc) {
    return next(new AppError('Product not found', 404));
  }
  const notApproved = productDoc.moderationStatus !== 'approved';
  const notSellableStatus = !['active', 'out_of_stock', 'outOfStock'].includes(
    productDoc.status
  );
  const hiddenOrDeleted =
    productDoc.isVisible === false ||
    productDoc.isDeleted === true ||
    productDoc.isDeletedByAdmin === true ||
    productDoc.isDeletedBySeller === true;
  if (notApproved || notSellableStatus || hiddenOrDeleted) {
    return next(
      new AppError(
        `Product "${productDoc.name}" is not approved for sale.`,
        400
      )
    );
  }

  // Find or create cart
  let cart = await Cart.findOne({ user: userId });

  if (!cart) {
    // Create new cart if it doesn't exist
    cart = await Cart.create({
      user: userId,
      products: [],
    });
  }

  const normalizedVariantId = normalizeVariantId(variantId);

  // Check if item already exists in cart (same product + variant combination)
  const existingItemIndex = cart.products.findIndex((item) => {
    const itemProductId = item.product?.toString() || String(item.product);
    const itemVariantId = getVariantIdForLookup(item);
    const productMatches = itemProductId === productIdStr;
    const variantMatches = itemVariantId === normalizedVariantId;
    return productMatches && variantMatches;
  });

  if (existingItemIndex !== -1) {
    // Item exists, update quantity
    cart.products[existingItemIndex].quantity += quantity;
    logger.info(`[addToCart] Updated existing item quantity: ${cart.products[existingItemIndex].quantity}`);
  } else {
    // Item doesn't exist, add new item
    const newItem = {
      product: productIdStr,
      quantity,
    };

    if (normalizedVariantId) {
      newItem.variant = normalizedVariantId;
    }

    cart.products.push(newItem);
    logger.info(`[addToCart] Added new item to cart: product=${productId}, variant=${normalizedVariantId || 'none'}, quantity=${quantity}`);
  }

  // Save the cart
  await cart.save();
  logger.info(`[addToCart] Cart saved with ${cart.products.length} items`);
  const populatedCart = await populateCart(Cart.findById(cart._id));

  if (!populatedCart) {
    return next(new AppError('No cart found for this user', 404));
  }

  let returnCart = populatedCart;

  // Map products to include full variant objects
  const mappedProducts = mapCartProducts(populatedCart.products);
  await applyCartPromoPricing(mappedProducts);

  // We need to construct a plain object to return so our mapped array isn't lost by mongoose serialization
  returnCart = {
    ...populatedCart.toObject(),
    products: mappedProducts
  };

  // Log activity
  const product = populatedCart.products?.find(p => p.product?._id?.toString() === productIdStr);
  logActivityAsync({
    userId: req.user.id,
    role: 'buyer',
    action: 'ADD_TO_CART',
    description: `User added ${quantity}x ${product?.product?.name || 'product'} to cart`,
    req,
    metadata: { productId: productIdStr, quantity, variantId },
  });

  res.status(200).json({
    status: 'success',
    data: {
      cart: returnCart,
    },
  });
});

exports.getCart = catchAsync(async (req, res, next) => {
  const cart = await populateCart(Cart.findOne({ user: req.user.id }));
  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  // Map products to include full variant objects
  const mappedProducts = mapCartProducts(cart.products);
  await applyCartPromoPricing(mappedProducts);

  const returnCart = {
    ...cart.toObject(),
    products: mappedProducts
  };

  res.status(200).json({
    status: 'success',
    data: { cart: returnCart },
  });
});
