// wishlist.controller.js
const WishList = require('../Models/wishListModel');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const Product = require('../Models/productModel');

// Get user's wishlist
exports.getWishlist = catchAsync(async (req, res) => {
  const wishlist = await WishList.findOne({ user: req.user.id }).populate(
    'products',
    'name price imageCover',
  );

  if (!wishlist) {
    return res.status(200).json({ products: [] });
  }

  res.status(200).json({ status: 'success', data: wishlist });
});

// Add to wishlist
exports.addToWishlist = catchAsync(async (req, res, next) => {
  try {
    console.log(req.body);
    const { productId } = req.body;
    console.log('Adding product to wishlist:', productId);

    let wishlist = await WishList.findOne({ user: req.user.id });
    console.log('Current wishlist:', wishlist);
    if (!wishlist) {
      // Create new wishlist if it doesn't exist
      wishlist = new WishList({
        user: req.user.id,
        products: [{ productId }],
      });
    } else {
      // Check if product already exists in wishlist
      const existingProduct = wishlist.products.find((item) => {
        return item.product.toString() === productId;
      });

      if (existingProduct) {
        return res.status(400).json({ message: 'Product already in wishlist' });
      }

      // Add product to wishlist
      wishlist.products.push({ product: productId });
    }

    await wishlist.save();
    await wishlist.populate('products.product');

    res.status(200).json(wishlist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Remove from wishlist
exports.removeFromWishlist = catchAsync(async (req, res, next) => {
  try {
    const { productId } = req.params;
    console.log('Removing product from wishlist:', productId);

    // Validate productId
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return next(new AppError('Invalid product ID', 400));
    }

    // Find the user's wishlist
    const wishlist = await WishList.findOne({ user: req.user.id });

    if (!wishlist) {
      return next(new AppError('Wishlist not found', 404));
    }

    const productIndex = wishlist.products.findIndex((item) => {
      console.log(
        'Checking product in wishlist:',
        item.product.toString(),
        productId,
      );
      return item.product.toString() === productId;
    });

    if (productIndex === -1) {
      return next(new AppError('Product not found in wishlist', 404));
    }

    // Remove the product from the wishlist
    wishlist.products.splice(productIndex, 1);

    // Save the updated wishlist
    await wishlist.save();

    // Populate product details before sending response
    await wishlist.populate('products', 'name price imageCover');

    res.status(200).json({
      status: 'success',
      message: 'Product removed from wishlist',
      data: {
        wishlist,
      },
    });
  } catch (err) {
    console.log(err.message);
  }
});
exports.removeFromGuestWishlist = catchAsync(async (req, res, next) => {
  const { sessionId, productId } = req.body;
  if (!sessionId || !productId) {
    return next(new AppError('Session ID and Product ID are required', 400));
  }
  const wishlist = await WishList.findOne({ sessionId });
  if (!wishlist) {
    return next(new AppError('Wishlist not found', 404));
  }
  const productIndex = wishlist.products.findIndex(
    (item) => item.product.toString() === productId,
  );

  if (productIndex === -1) {
    return next(new AppError('Product not found in wishlist', 404));
  }
  wishlist.products.splice(productIndex, 1);
  await wishlist.save();
  res.status(200).json({
    status: 'success',
    message: 'Product removed from guest wishlist',
    data: {
      wishlist,
    },
  });
});
// exports.syncWishlist = catchAsync(async (req, res, next) => {
//   const wishlist = await WishList.findOne({ user: req.user.id });

//   if (wishlist) {
//     wishlist.products = req.body.wishlist.products;
//     await wishlist.save();
//     res.status(200).json({
//       message: 'Wishlist synced',
//       wishlist: await wishlist.populate('products', 'name price imageCover'),
//     });
//   } else {
//     res.status(404);
//     throw new Error('Wishlist not found');
//   }
// });

// Get or create guest wishlist
exports.getOrCreateGuestWishlist = catchAsync(async (req, res, next) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return next(new AppError('Session ID is required', 400));
  }

  let wishlist = await WishList.findOne({ sessionId }).populate(
    'products.product',
    'name price images seller',
  );

  if (!wishlist) {
    // Create new guest wishlist
    wishlist = await WishList.create({
      sessionId,
      products: [],
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      wishlist,
    },
  });
});

// Add product to guest wishlist
exports.addToGuestWishlist = catchAsync(async (req, res, next) => {
  const { sessionId, productId } = req.body;

  if (!sessionId || !productId) {
    return next(new AppError('Session ID and Product ID are required', 400));
  }

  // Check if product exists
  const product = await Product.findById(productId);

  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  let wishlist = await WishList.findOne({ sessionId });
  console.log('Current guest wishlist:', wishlist);

  if (!wishlist) {
    // Create new guest wishlist if it doesn't exist
    wishlist = await WishList.create({
      sessionId,
      products: [{ product: productId }],
    });
  } else {
    // Check if product is already in wishlist
    const existingProduct = wishlist.products.find(
      (item) => item.product.toString() === productId,
    );

    if (existingProduct) {
      return next(new AppError('Product already in wishlist', 400));
    }

    // Add product to wishlist
    wishlist.products.push({ product: productId });
    await wishlist.save();
  }

  // Populate the product details
  await wishlist.populate('products.product', 'name price images seller');

  res.status(200).json({
    status: 'success',
    message: 'Product added to wishlist',
    data: {
      wishlist,
    },
  });
});

// Merge guest wishlist with user wishlist after login
exports.mergeWishlists = catchAsync(async (req, res, next) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return next(new AppError('Session ID is required', 400));
  }

  // Find guest wishlist
  const guestWishlist = await WishList.findOne({ sessionId });

  if (!guestWishlist || guestWishlist.products.length === 0) {
    return res.status(200).json({
      status: 'success',
      message: 'No guest wishlist to merge',
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

  // Get current user product IDs to avoid duplicates
  const userProductIds = userWishlist.products.map((item) =>
    item.product.toString(),
  );

  // Add guest products to user wishlist (avoiding duplicates)
  for (const item of guestWishlist.products) {
    const productId = item.product.toString();

    if (!userProductIds.includes(productId)) {
      userWishlist.products.push({ product: productId });
      userProductIds.push(productId); // Update to prevent duplicates in this operation
    }
  }

  // Save the updated user wishlist
  await userWishlist.save();

  // Delete the guest wishlist after successful merge
  await WishList.findByIdAndDelete(guestWishlist._id);

  // Populate the merged wishlist
  await userWishlist.populate('products.product', 'name price images seller');

  res.status(200).json({
    status: 'success',
    message: 'Wishlist merged successfully',
    data: { wishlist: userWishlist },
  });
});
exports.checkInWishlist = catchAsync(async (req, res, next) => {
  const { productId } = req.params;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return next(new AppError('Invalid product ID', 400));
  }

  // Check if the user has a wishlist
  const wishlist = await WishList.findOne({ user: req.user.id });

  if (!wishlist) {
    return res.status(200).json({
      inWishlist: false,
    });
  }

  // Check if the product is in the wishlist
  const inWishlist = wishlist.products.some(
    (item) => item.product.toString() === productId,
  );

  res.status(200).json({
    status: 'success',
    inWishlist,
  });
});
// The existing methods (getWishlist, addToWishlist, removeFromWishlist, checkInWishlist)
// remain the same but should check for both user and sessionId where appropriate
