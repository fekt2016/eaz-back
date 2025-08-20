// wishlist.controller.js
const WishList = require('../Models/wishListModel');
const catchAsync = require('../utils/catchAsync');

// Get user's wishlist
const getWishlist = catchAsync(async (req, res) => {
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
const addToWishlist = catchAsync(async (req, res) => {
  const { productId } = req.body;

  let wishlist = await WishList.findOne({ user: req.user.id });

  if (!wishlist) {
    // Create new wishlist if none exists
    wishlist = await WishList.create({
      user: req.user.id,
      products: [productId],
    });
  } else {
    // Add product if not already in wishlist
    if (!wishlist.products.includes(productId)) {
      wishlist.products.push(productId);
      await wishlist.save();
    }
  }

  res.status(201).json({
    message: 'Product added to wishlist',
    data: { wishlist },
  });
});

// Remove from wishlist
const removeFromWishlist = catchAsync(async (req, res) => {
  const { productId } = req.params;
  console.log('ppro', productId);

  const wishlist = await WishList.findOne({ user: req.user.id });

  if (wishlist) {
    wishlist.products = wishlist.products.filter(
      (id) => id.toString() !== productId,
    );

    await wishlist.save();
    res.status(200).json({
      message: 'Product removed from wishlist',
      wishlist: await wishlist.populate('products', 'name price imageCover'),
    });
  } else {
    res.status(404);
    throw new Error('Wishlist not found');
  }
});
const syncWishlist = catchAsync(async (req, res) => {
  const wishlist = await WishList.findOne({ user: req.user.id });

  if (wishlist) {
    wishlist.products = req.body.wishlist.products;
    await wishlist.save();
    res.status(200).json({
      message: 'Wishlist synced',
      wishlist: await wishlist.populate('products', 'name price imageCover'),
    });
  } else {
    res.status(404);
    throw new Error('Wishlist not found');
  }
});

module.exports = {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  syncWishlist,
};
