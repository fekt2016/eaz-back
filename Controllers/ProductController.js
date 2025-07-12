const Product = require('../Models/productModel');
const handleFactory = require('../Controllers/handleFactory');
const multer = require('multer');
const stream = require('stream');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
// const cloudinary = require('../utils/cloudinary').v2;
const multerStorage = multer.memoryStorage();
const APIFeature = require('../utils/apiFeatures');

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload an image', 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
exports.conditionalUpload = (req, res, next) => {
  // console.log(req.headers['content-type']);
  // Check if files are present in the request
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    return upload.fields([
      { name: 'imageCover', maxCount: 1 },
      { name: 'newImages', maxCount: 10 },
    ])(req, res, next);
  }
  next();
};

exports.uploadProductImage = upload.fields([
  { name: 'imageCover', maxCount: 1 },
  { name: 'newImages', maxCount: 10 },
]);

exports.resizeProductImages = catchAsync(async (req, res, next) => {
  // console.log(req);
  req.body = { ...req.body };
  req.files = { ...req.files };
  console.log(req.body);
  let parseExistingImages = [];
  let imagesUrls = [];
  try {
    const cloudinary = req.app.get('cloudinary');
    if (req.files) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);

      const uploadFromBuffer = (buffer, options) => {
        return new Promise((resolve, reject) => {
          const writeStream = cloudinary.uploader.upload_stream(
            options,
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          );

          const bufferStream = new stream.PassThrough();
          bufferStream.end(buffer);
          bufferStream.pipe(writeStream);
        });
      };
      if (req.files.imageCover) {
        const coverFile = req.files.imageCover[0];
        // Process cover image
        const coverResult = await uploadFromBuffer(coverFile.buffer, {
          folder: 'products',
          public_id: `${uniqueSuffix}-cover`,
          transformation: [
            { width: 2000, height: 1333, crop: 'scale' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        });

        req.body.imageCover = coverResult.secure_url;
        console.log('Cover image URL:', req.body.imageCover);
      }

      if (req.files.newImages) {
        const newImages = req.files.newImages;

        const imagesPromises = newImages.map(async (file, i) => {
          const result = await uploadFromBuffer(file.buffer, {
            folder: 'products',
            public_id: `${uniqueSuffix}-image-${i}`,
            transformation: [
              { width: 1000, height: 667, crop: 'fill' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          });
          return result.secure_url;
        });

        imagesUrls = await Promise.all(imagesPromises);
      }

      if (req.body.existingImages) {
        parseExistingImages = JSON.parse(req.body.existingImages);
        delete req.body.existingImages; // Remove from request body
      }

      req.body.images = [...parseExistingImages, ...imagesUrls];
      console.log('All images:', req.body);
    }
  } catch (err) {
    console.log(err.message);
  }

  next();
});

exports.bestProductPrice = async () => {
  req.query.limit = '5';
  req.query.sort = '-rating,price';
  req.query.fields = 'name,price, description';
  next();
};

// exports.getSellerProduct = catchAsync(async (req, res, next) => {
//   console.log(req.user.id);
//   const features = new APIFeature(
//     Product.find({ seller: req.user.id }), // Use the filter object
//     req.query,
//   )
//     .filter()
//     .sort()
//     .limitFields()
//     .paginate();

//   const sellerProducts = await features.query.populate({
//     path: 'parentCategory subCategory',
//     select: 'name slug',
//   });

// if (!sellerProducts) {
//   return next(new AppError('No product found on this Seller Id', 400));
// }

//   res.status(200).json({
//     status: 'success',
//     result: sellerProducts.length,
//     data: {
//       data: sellerProducts,
//     },
//   });
// });

exports.setProductIds = (req, res, next) => {
  if (!req.body.seller) req.body.seller = req.user.id;
  next();
};
exports.getAllProduct = handleFactory.getAll(Product, [
  { path: 'seller', select: 'name email phone shopName' },
  { path: 'parentCategory', select: 'name slug' },
  { path: 'subCategory', select: 'name slug' },
]);
// exports.getAllProduct = catchAsync(async (req, res, next) => {
//   console.log(req);
//   res.send('ok');
// });

exports.getProductCountByCategory = catchAsync(async (req, res, next) => {
  const productCounts = await Product.aggregate([
    {
      $group: {
        _id: {
          parentCategory: '$parentCategory',
          subCategory: '$subCategory',
        },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: '_id.parentCategory',
        foreignField: '_id',
        as: 'parentCategoryInfo',
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: '_id.subCategory',
        foreignField: '_id',
        as: 'subCategoryInfo',
      },
    },
    {
      $project: {
        _id: 0,
        parentCategory: { $arrayElemAt: ['$parentCategoryInfo.name', 0] },
        subCategory: { $arrayElemAt: ['$subCategoryInfo.name', 0] },
        count: 1,
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      productCounts,
    },
  });
});
exports.getProduct = handleFactory.getOne(Product, { path: 'reviews' });
exports.createProduct = handleFactory.createOne(Product);
exports.updateProduct = handleFactory.updateOne(Product);
exports.deleteProduct = handleFactory.deleteOne(Product);
