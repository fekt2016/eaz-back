const Category = require('../../models/category/categoryModel');
const handleFactory = require('../shared/handleFactory');
const multer = require('multer');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const stream = require('stream');
const cloudinary = require('cloudinary');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

const multerStorage = multer.memoryStorage();

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
    const cloudinary = req.app.get('cloudinary');
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
  try {
    const categories = await Category.find({ parentCategory: null })
      .populate({
        path: 'subcategories',
        select: 'name image slug',
        options: { sort: { name: 1 } },
      })
      .sort({ name: 1 }); // Sort parent categories by name

    res.status(200).json({
      status: 'success',
      results: categories.length,
      data: { categories },
    });
  } catch (error) {
    console.error('Error fetching parent categories:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch categories',
    });
  }
});
exports.getAllCategories = handleFactory.getAll(Category);
exports.getCategory = handleFactory.getOne(Category, { path: 'subcategories' });
// Wrapper functions with activity logging
exports.createCategory = catchAsync(async (req, res, next) => {
  const createHandler = handleFactory.createOne(Category);
  
  // Store original json method
  const originalJson = res.json.bind(res);
  let categoryCreated = null;
  
  // Override res.json to intercept response
  res.json = function(data) {
    if (data?.doc) {
      categoryCreated = data.doc;
    }
    originalJson(data);
  };
  
  // Call the factory handler
  await createHandler(req, res, next);
  
  // Log activity after creation
  if (categoryCreated && req.user) {
    const role = req.user.role === 'admin' ? 'admin' : 'seller';
    logActivityAsync({
      userId: req.user.id,
      role,
      action: 'CREATE_CATEGORY',
      description: `${role === 'admin' ? 'Admin' : 'Seller'} created category: ${categoryCreated.name || 'Unknown'}`,
      req,
      metadata: { categoryId: categoryCreated._id },
    });
  }
});

exports.updateCategory = catchAsync(async (req, res, next) => {
  const updateHandler = handleFactory.updateOne(Category);
  
  // Store original json method
  const originalJson = res.json.bind(res);
  let categoryUpdated = null;
  let oldCategory = null;
  
  // Get old category data before update
  if (req.params.id) {
    oldCategory = await Category.findById(req.params.id);
  }
  
  // Override res.json to intercept response
  res.json = function(data) {
    if (data?.doc) {
      categoryUpdated = data.doc;
    }
    originalJson(data);
  };
  
  // Call the factory handler
  await updateHandler(req, res, next);
  
  // Log activity after update
  if (categoryUpdated && req.user) {
    const role = req.user.role === 'admin' ? 'admin' : 'seller';
    const changes = [];
    if (oldCategory && categoryUpdated.name !== oldCategory.name) {
      changes.push(`name from "${oldCategory.name}" to "${categoryUpdated.name}"`);
    }
    const changeDesc = changes.length > 0 ? ` (${changes.join(', ')})` : '';
    
    logActivityAsync({
      userId: req.user.id,
      role,
      action: 'UPDATE_CATEGORY',
      description: `${role === 'admin' ? 'Admin' : 'Seller'} updated category: ${categoryUpdated.name || 'Unknown'}${changeDesc}`,
      req,
      metadata: { categoryId: categoryUpdated._id },
    });
  }
});

exports.deleteCategory = catchAsync(async (req, res, next) => {
  // Get category before deletion
  const categoryToDelete = await Category.findById(req.params.id);
  
  const deleteHandler = handleFactory.deleteOne(Category);
  
  // Store original json method
  const originalJson = res.json.bind(res);
  let deleted = false;
  
  // Override res.json to intercept response
  res.json = function(data) {
    if (data?.status === 'success') {
      deleted = true;
    }
    originalJson(data);
  };
  
  // Call the factory handler
  await deleteHandler(req, res, next);
  
  // Log activity after deletion
  if (deleted && categoryToDelete && req.user) {
    const role = req.user.role === 'admin' ? 'admin' : 'seller';
    logActivityAsync({
      userId: req.user.id,
      role,
      action: 'DELETE_CATEGORY',
      description: `${role === 'admin' ? 'Admin' : 'Seller'} deleted category: ${categoryToDelete.name || 'Unknown'}`,
      req,
      metadata: { categoryId: categoryToDelete._id },
    });
  }
});
