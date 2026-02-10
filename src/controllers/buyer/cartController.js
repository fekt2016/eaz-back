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

// Helper function to populate cart with product details (include promotionKey for promo price)
const populateCart = (cart) => {
  return cart.populate({
    path: 'products.product',
    select: 'name price priceInclVat imageCover variants seller isEazShopProduct promotionKey',
    populate: {
      path: 'seller',
      select: '_id name shopName role shopAddress location',
    },
    options: { virtuals: true }, // Include virtual properties
  });
};

// Apply promo pricing to cart products; mutates items in place, adds unitPrice and originalUnitPrice when discounted
const applyCartPromoPricing = async (products) => {
  if (!products?.length) return;
  let promos;
  try {
    promos = await getPromosFromAds();
  } catch (e) {
    logger.warn('[cart] Could not load promos for cart:', e?.message);
    return;
  }
  for (const item of products) {
    const product = item.product;
    if (!product) continue;
    const variant = item.variant;
    // Dual VAT: display inclusive price to customer (seller enters base; we store priceInclVat on product)
    const basePrice = (variant && (variant.priceInclVat ?? variant.price != null))
      ? Number(variant.priceInclVat ?? variant.price)
      : Number(product.priceInclVat ?? product.price ?? 0);
    if (!basePrice) {
      item.unitPrice = 0;
      continue;
    }
    const applicable = getApplicablePromos(product, promos);
    const { unitPrice, originalPrice } = applyPromosToPrice(basePrice, applicable);
    item.unitPrice = unitPrice;
    if (originalPrice != null && originalPrice > unitPrice) {
      item.originalUnitPrice = originalPrice;
    }
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

  populatedCart.products = populatedCart.products
    .filter((item) => item.product) // Filter out items with null products
    .map((item) => {
      const variantId = String(item.variant);

      const selectedVariant =
        (item.product?.variants || []).find(
          (v) => v._id.toString() === variantId,
        ) || null;
      return {
        ...item.toObject(),
        variant: selectedVariant, // ✅ replaces ID with full object
      };
    });

  await applyCartPromoPricing(populatedCart.products);

  res.status(200).json({
    status: 'success',
    data: {
      cart: {
        ...populatedCart.toObject(),
        products: populatedCart.products,
      },
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
  if (product.variants && product.variants.length > 0 && cart.products[itemIndex].variant) {
    const variantId = String(cart.products[itemIndex].variant);
    const variant = product.variants.find(
      (v) => v._id && v._id.toString() === variantId,
    );
    if (variant) {
      availableStock = Math.max(0, (variant.stock || 0) - (variant.sold || 0));
    }
  } else {
    availableStock = Math.max(0, (product.stock || 0) - (product.sold || 0));
  }

  if (rawQty > availableStock) {
    return next(new AppError(
      `Only ${availableStock} available in stock. Reduce quantity or remove item.`,
      400,
    ));
  }

  cart.products[itemIndex].quantity = rawQty;
  const updatedCart = await cart.save();
  const populatedCart = await populateCart(Cart.findById(updatedCart._id));

  // Filter out null products and process variants
  if (populatedCart && populatedCart.products) {
    populatedCart.products = populatedCart.products
      .filter((item) => item.product)
      .map((item) => {
        const variantId = String(item.variant);
        const selectedVariant =
          (item.product?.variants || []).find(
            (v) => v._id.toString() === variantId,
          ) || null;
        return {
          ...item.toObject(),
          variant: selectedVariant,
        };
      });
    await applyCartPromoPricing(populatedCart.products);
  }

  // Return the FULL updated cart, not just the item
  res.status(200).json({
    status: 'success',
    data: {
      cart: populatedCart,
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

  const populatedCart = await Cart.findById(cart._id)
    .populate('products.product')
    .lean();

  logger.info('after pull:', populatedCart.products);

  // Filter out null products
  if (populatedCart && populatedCart.products) {
    populatedCart.products = populatedCart.products.filter(
      (item) => item.product
    );
  }

  res.status(200).json({
    status: 'success',
    data: { cart: populatedCart },
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
  const { productId, quantity, variantId } = req.body;

  const userId = req.user.id;

  // Validate input
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return next(new AppError('Quantity must be a positive integer', 400));
  }

  // Check if product exists (optional but recommended)
  const productExists = await Product.exists({ _id: productId });
  if (!productExists) {
    return next(new AppError('Product not found', 404));
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

  // Normalize variantId to string for comparison
  const normalizedVariantId = variantId 
    ? (typeof variantId === 'object' && variantId._id ? variantId._id.toString() : variantId.toString())
    : null;

  // Check if item already exists in cart (same product + variant combination)
  const existingItemIndex = cart.products.findIndex((item) => {
    const itemProductId = item.product?.toString() || String(item.product);
    const itemVariantId = item.variant?.toString() || null;
    
    // Match by product ID and variant ID (both must match)
    const productMatches = itemProductId === productId.toString();
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
      product: productId,
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

  // Filter out null products and process variants
  if (populatedCart.products) {
    populatedCart.products = populatedCart.products
      .filter((item) => item.product)
      .map((item) => {
        const variantId = String(item.variant);
        const selectedVariant =
          (item.product?.variants || []).find(
            (v) => v._id.toString() === variantId,
          ) || null;
        return {
          ...item.toObject(),
          variant: selectedVariant,
        };
      });
    await applyCartPromoPricing(populatedCart.products);
  }

  // Log activity
  const product = populatedCart.products?.find(p => p.product?._id?.toString() === productId);
  logActivityAsync({
    userId: req.user.id,
    role: 'buyer',
    action: 'ADD_TO_CART',
    description: `User added ${quantity}x ${product?.product?.name || 'product'} to cart`,
    req,
    metadata: { productId, quantity, variantId },
  });

  res.status(200).json({
    status: 'success',
    data: {
      cart: populatedCart,
    },
  });
});

exports.getCart = catchAsync(async (req, res, next) => {
  const cart = await populateCart(Cart.findOne({ user: req.user.id }));
  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  cart.products = cart.products
    .filter((item) => item.product) // Filter out items with null products
    .map((item) => {
      const variantId = item.variant?.toString() || item.variantId;
      const selectedVariant = item.product?.variants?.id(variantId) || null;
      return { ...item.toObject(), variant: selectedVariant };
    });

  await applyCartPromoPricing(cart.products);

  res.status(200).json({
    status: 'success',
    data: { cart },
  });
});
