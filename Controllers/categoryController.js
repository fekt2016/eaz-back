const Category = require('../Models/categoryModel');
const handleFactory = require('../Controllers/handleFactory');
const multer = require('multer');
const multerStorage = multer.memoryStorage();
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const cloudinary = require('../utils/cloudinary');
const stream = require('stream');

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

exports.uploadCategoryImage = upload.single('image');

exports.resizeCategoryImages = catchAsync(async (req, res, next) => {
  req.body = { ...req.body };
  req.file = { ...req.file };

  try {
    // Only process image if a new file is uploaded
    if (req.file) {
      const imageBuffer =
        req.file.buffer instanceof Buffer
          ? req.file.buffer
          : Buffer.from(req.file.buffer);
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

      // Process cover image
      const coverResult = await uploadFromBuffer(imageBuffer, {
        folder: 'categories',
        public_id: `${uniqueSuffix}-image`,
        transformation: [
          { width: 2000, height: 1333, crop: 'scale' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      });

      req.body.image = coverResult.secure_url;
    }
  } catch (err) {
    console.log(err.message);
  }

  next();
});
exports.getParentCategories = catchAsync(async (req, res, next) => {
  const categories = await Category.find({ parentCategory: null }); // Adjust field if needed

  res.status(200).json({
    status: 'success',
    results: categories.length,
    data: { categories },
  });
});
exports.getAllCategories = handleFactory.getAll(Category);
exports.getCategory = handleFactory.getOne(Category, { path: 'subcategories' });
exports.createCategory = handleFactory.createOne(Category);
exports.updateCategory = handleFactory.updateOne(Category);
exports.deleteCategory = handleFactory.deleteOne(Category);
