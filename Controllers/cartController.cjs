const Cart = require('../Models/cartModel');
const handleFactory = require('./handleFactory');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');
const Product = require('../Models/productModel');

// Set user ID from authenticated user
exports.setUserId = (req, res, next) => {
  req.body.user = req.user.id;
  next();
};
// Helper function to populate cart with product details
const populateCart = (cart) => {
  return cart.populate({
    path: 'products.product',
    select: 'name price imageCover variants',
    options: { virtuals: true }, // Include virtual properties
  });
};

// Get current user's cart
exports.getMyCart = catchAsync(async (req, res, next) => {
  const cart = await populateCart(Cart.findOne({ user: req.user.id }));

  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  // Verify cart ownership
  if (cart.user.toString() !== req.user.id) {
    return next(
      new AppError('You do not have permission to view this cart', 403),
    );
  }

  cart.products = cart.products.map((item) => {
    const variantId = String(item.variant); // the ID you stored
    const selectedVariant =
      (item.product.variants || []).find(
        (v) => v._id.toString() === variantId,
      ) || null;

    // Return a new object for this cart-item:
    return {
      ...item,
      variants: selectedVariant, // full sub-doc instead of string
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      cart: {
        ...cart._doc,
        products: cart.products,
      },
    },
  });
});

// Update specific cart item (user operation)
// Backend: cartController.js
exports.updateCartItem = async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  // Find cart and update item
  const cart = await Cart.findOne({ user: req.user._id }).populate({
    path: 'products.product',
    select: 'name price imageCover',
  });
  const itemIndex = cart.products.findIndex(
    (item) => item._id.toString() === itemId,
  );

  if (itemIndex === -1) {
    return next(new AppError('Item not found in cart', 404));
  }

  cart.products[itemIndex].quantity = quantity;
  const updatedCart = await cart.save();
  const populatedCart = await populateCart(Cart.findById(updatedCart._id));

  // Return the FULL updated cart, not just the item
  res.status(200).json({
    status: 'success',
    data: {
      cart: populatedCart,
    },
  });
};

// Delete cart item (user operation)
// controllers/cartController.js
exports.deleteCartItem = catchAsync(async (req, res, next) => {
  console.log('deleteCartItem params:', req.params, 'user:', req.user.id);

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

  console.log('after pull:', populatedCart.products);

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

  res.status(204).json({
    status: 'success',
    data: null,
  });
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

  const cart = await Cart.findOneAndUpdate(
    { user: userId },
    {
      $addToSet: {
        products: {
          $each: [
            {
              product: productId,
              quantity,
              ...(variantId && { variant: variantId }),
            },
          ],
        },
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );
  const populatedCart = await populateCart(Cart.findById(cart._id));

  if (!populatedCart) {
    return next(new AppError('No cart found for this user', 404));
  }

  res.status(200).json({
    status: 'success',
    data: populatedCart,
  });
});

exports.getCart = catchAsync(async (req, res, next) => {
  const cart = await populateCart(Cart.findOne({ user: req.user.id }));
  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }
  console.log(cart);
  cart.products = cart.products.filter((item) => {
    const variantId = item.variant.toString() || item.variantId;
    const selectedVariant = item.product.variants.id(variantId) || null;
    return { ...item.toObject(), variant: selectedVariant };
  });
  console.log('cart', cart);
  res.status(200).json({
    status: 'success',
    data: { cart },
  });
});
