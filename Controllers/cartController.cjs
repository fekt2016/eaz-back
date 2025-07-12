const Cart = require('../Models/cartModel');
const handleFactory = require('./handleFactory');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');

// Set user ID from authenticated user
exports.setUserId = (req, res, next) => {
  req.body.user = req.user.id;
  next();
};

// Get current user's cart
exports.getMyCart = catchAsync(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user.id }).populate({
    path: 'products.product',
    select: 'name price imageCover',
  });

  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  // Verify cart ownership
  if (cart.user.toString() !== req.user.id) {
    return next(
      new AppError('You do not have permission to view this cart', 403),
    );
  }

  res.status(200).json({
    status: 'success',
    data: { cart },
  });
});

// Update specific cart item (user operation)
// Backend: cartController.js
exports.updateCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;

    // Find cart and update item
    const cart = await Cart.findOne({ user: req.user._id }).populate({
      path: 'products.product',
      select: 'name price imageCover',
    });
    const item = cart.products.id(itemId);

    if (!item) {
      return res.status(404).json({ error: 'Item not found in cart' });
    }

    item.quantity = quantity;
    await cart.save();

    // Return the FULL updated cart, not just the item
    res.status(200).json({
      status: 'success',
      data: {
        cart,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Delete cart item (user operation)
exports.deleteCartItem = catchAsync(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) {
    return next(new AppError('No cart found for this user', 404));
  }

  cart.products.pull(req.params.itemId);
  await cart.save();
  console.log('cart', cart);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

exports.clearCart = catchAsync(async (req, res) => {
  const userId = req.user.id;
  console.log('userId', userId);

  const cart = await Cart.findOneAndUpdate(
    { user: userId },
    { $set: { products: [], totalPrice: 0 } }, // 👈 Now you're clearing the correct field
    { new: true, runValidators: true },
  );
  console.log('cart', cart);
  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// --- Admin operations below ---
exports.createCart = catchAsync(async (req, res, next) => {
  const { productId, quantity } = req.body;
  console.log(productId, quantity);
  const userId = req.user.id;

  // Validate input
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return next(new AppError('Quantity must be a positive integer', 400));
  }

  let cart = await Cart.findOne({ user: userId });

  if (!cart) {
    cart = new Cart({
      user: userId,
      products: [{ product: productId, quantity }], // Ensure product field is set
    });
  } else {
    // Correct product field comparison
    const existingProductIndex = cart.products.findIndex(
      (item) => item.product && item.product.toString() === productId,
    );

    if (existingProductIndex > -1) {
      cart.products[existingProductIndex].quantity += quantity;
    } else {
      cart.products.push({ product: productId, quantity }); // Ensure product field is set
    }
  }

  const savedCart = await cart.save();

  // CORRECTED POPULATION - use .populate() on the query
  const populatedCart = await Cart.findById(savedCart._id)
    .populate({
      path: 'products.product', // Correct path to populate
      select: 'name price images', // Include specific fields
    })
    .lean(); // Convert to plain JS object for better inspection

  console.log('populatedCart', populatedCart);
  res.status(200).json({
    status: 'success',
    data: populatedCart,
  });
});

exports.getCart = handleFactory.getOne(Cart, {
  path: 'products.product',
  select: 'name description price',
});
