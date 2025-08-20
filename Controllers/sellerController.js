const Seller = require('../Models/sellerModel');
const handleFactory = require('../Controllers/handleFactory');
const catchAsync = require('../utils/catchAsync');
const stream = require('stream');
const Product = require('../Models/productModel');
const APIFeature = require('../utils/apiFeatures');
const AppError = require('../utils/appError');

exports.getSellerProducts = catchAsync(async (req, res, next) => {
  const features = new APIFeature(
    Product.find({ seller: req.user.id }), // Use the filter object
    req.query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const sellerProducts = await features.query.populate({
    path: 'parentCategory subCategory',
    select: 'name slug',
  });

  if (!sellerProducts) {
    return next(new AppError('No product found on this Seller Id', 400));
  }

  res.status(200).json({
    status: 'success',
    result: sellerProducts.length,
    data: {
      data: sellerProducts,
    },
  });
});
exports.getSellerProductById = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }
  res.status(200).json({ status: 'success', data: { product } });
});
exports.SellerDeleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }
  res.status(200).json({ status: 'success', data: { product } });
});

exports.updateSellerImage = catchAsync(async (req, res, next) => {
  // 1. Check if file exists
  if (!req.file) return next(new AppError('No image file uploaded', 400));

  // // 2. Initialize Cloudinary
  const cloudinary = req.app.get('cloudinary');

  // 3. Process and upload image
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'seller-avatars',
        transformation: [{ width: 500, height: 500, crop: 'fill' }],
      },
      (error, result) => {
        if (error) {
          return reject(
            new AppError(`Image upload failed: ${error.message}`, 500),
          );
        }
        resolve(result);
      },
    );

    // Create buffer stream from file
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);
    bufferStream.pipe(uploadStream);
  });

  // 4. Update request body with Cloudinary URL
  req.body.avatar = result.secure_url;

  // 5. Validate request body
  if (!req.body || Object.keys(req.body).length === 0) {
    return next(new AppError('Request body cannot be empty', 400));
  }

  // 6. Update seller document
  const seller = await Seller.findByIdAndUpdate(
    req.user.id, // Ensure this matches your authentication setup
    { avatar: req.body.avatar },
    {
      new: true,
      runValidators: true,
      context: 'query', // Ensures validators run properly
    },
  );

  // 7. Handle case where seller not found
  if (!seller) {
    return next(new AppError('No seller found with that ID', 404));
  }

  // 8. Send response
  res.status(200).json({
    status: 'success',
    data: {
      seller,
      imageInfo: {
        url: result.secure_url,
        publicId: result.public_id,
      },
    },
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const { name, email, phone, shopAddress } = req.body;

  const seller = await Seller.findByIdAndUpdate(
    req.user.id,
    {
      name,
      email,
      phone,
      shopAddress: {
        street: shopAddress.street,
        city: shopAddress.city,
        state: shopAddress.state,
        zipCode: shopAddress.zipCode,
        country: shopAddress.country,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );
  if (!seller) return next(new AppError('No seller found with that ID', 404));

  res.status(200).json({ status: 'success', data: { seller } });
});
exports.deleteMe = catchAsync(async (req, res, next) => {
  const seller = await Seller.findByIdAndUpdate(req.user.id, { active: false });
  if (!seller) return next(new AppError('No seller found with that ID', 404));
  res.status(204).json({ status: 'success', data: null });
});
exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};
exports.sellerStatus = catchAsync(async (req, res, next) => {
  const seller = await Seller.findByIdAndUpdate(
    req.params.id,
    { status: req.body.newStatus },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!seller) return next(new AppError('No seller found with that ID', 404));
  console.log('Updated seller:', seller);
  res.status(200).json({ status: 'success', data: { seller } });
});
exports.getPublicSeller = catchAsync(async (req, res, next) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return next(new AppError('No seller found with that ID', 404));
  res.status(200).json({ status: 'success', data: { seller } });
});
exports.getFeaturedSellers = catchAsync(async (req, res, next) => {
  console.log(req.query);
  // Get query parameters with defaults
  const limit = parseInt(req.query.limit) || 10;
  const minRating = parseFloat(req.query.minRating) || 4.0;

  // Fetch featured sellers from database with flexible filtering
  const sellers = await Seller.aggregate([
    {
      $match: {
        // Handle missing status field
        $or: [
          { status: 'active' },
          { status: { $exists: false } }, // Include documents without status field
        ],
        // Convert string ratings to numbers for comparison
        $expr: {
          $gte: [
            { $toDouble: '$ratings.average' }, // Convert string to number
            minRating,
          ],
        },
      },
    },
    // Convert ratings to numbers for proper sorting
    {
      $addFields: {
        'ratings.average': { $toDouble: '$ratings.average' },
        'ratings.count': {
          $cond: [
            { $ifNull: ['$ratings.count', false] },
            { $toInt: '$ratings.count' },
            0, // Default to 0 if missing
          ],
        },
      },
    },
    // Sort by the converted numeric values
    { $sort: { 'ratings.average': -1, 'ratings.count': -1 } },
    { $limit: limit },
    // Project required fields
    {
      $project: {
        _id: 1,
        shopName: 1,
        avatar: 1,
        createdAt: 1,
        rating: '$ratings.average',
        reviewCount: '$ratings.count',
      },
    },
  ]);

  // Transform to final response format
  const transformedSellers = sellers.map((seller) => ({
    id: seller._id,
    shopName: seller.shopName,
    avatar: seller.avatar,
    joinedDate: seller.createdAt,
    rating: seller.rating,
    reviewCount: seller.reviewCount,
  }));
  res.status(200).json({
    status: 'success',
    results: transformedSellers.length,
    data: {
      sellers: transformedSellers,
    },
  });
});
exports.getMySellerProfile = catchAsync(async (req, res, next) => {
  // req.user is set by auth middleware
  const seller = await Seller.findById(req.user.id)
    .select('-__v -passwordChangedAt')
    .lean();

  if (!seller) return next(new AppError('Seller not found', 404));

  // Transform data
  const result = {
    ...seller,
    rating: seller.ratings?.average ? parseFloat(seller.ratings.average) : 0,
    reviewCount: seller.ratings?.count ? parseInt(seller.ratings.count) : 0,
    joinedDate: seller.createdAt,
  };

  delete result.ratings;
  delete result.createdAt;
  delete result.password;

  res.status(200).json({
    status: 'success',
    data: { seller: result },
  });
});
exports.getAllSeller = handleFactory.getAll(Seller);
exports.getSeller = handleFactory.getOne(Seller);
exports.updateSeller = handleFactory.updateOne(Seller);
exports.deleteSeller = handleFactory.deleteOne(Seller);
