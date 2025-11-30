/**
 * Cloudinary Upload Middleware
 * 
 * Reusable middleware for uploading files to Cloudinary.
 * 
 * Usage Examples:
 * 
 * 1. Upload single file field:
 *    router.patch('/update', multerMiddleware, uploadSingleFile('avatar', {
 *      folder: 'avatars',
 *      transformations: [{ width: 500, height: 500, crop: 'fill' }]
 *    }), controller.update);
 * 
 * 2. Upload multiple file fields:
 *    router.patch('/update', multerMiddleware, uploadMultipleFields([
 *      { name: 'imageCover', folder: 'products' },
 *      { name: 'images', folder: 'products' }
 *    ]), controller.update);
 * 
 * 3. Store files in nested object:
 *    router.patch('/update', multerMiddleware, uploadMultipleFields([
 *      { name: 'businessCert', folder: 'documents', storeIn: 'verificationDocuments' }
 *    ]), controller.update);
 *    // Result: req.body.verificationDocuments.businessCert = 'https://...'
 * 
 * 4. Custom configuration:
 *    router.patch('/update', multerMiddleware, cloudinaryUpload({
 *      folder: (req, fieldName) => `users/${req.user.id}/${fieldName}`,
 *      publicIdPrefix: (req, fieldName) => `${Date.now()}-${fieldName}`,
 *      resourceType: 'auto',
 *      transformations: [{ quality: 'auto' }],
 *      onUploadComplete: async (req, field, result) => {
 *        // Custom logic after upload
 *      }
 *    }), controller.update);
 */

const stream = require('stream');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/**
 * Upload a single file buffer to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {Object} options - Cloudinary upload options
 * @param {Object} cloudinary - Cloudinary instance from app
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadFileToCloudinary = (fileBuffer, options, cloudinary) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          return reject(new AppError(`File upload failed: ${error.message}`, 500));
        }
        resolve(result);
      }
    );

    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileBuffer);
    bufferStream.pipe(uploadStream);
  });
};

/**
 * Upload multiple files to Cloudinary
 * @param {Array} files - Array of file objects with buffer property
 * @param {Object|Function} options - Cloudinary options or function that returns options for each file
 * @param {Object} cloudinary - Cloudinary instance
 * @returns {Promise<Array>} Array of upload results
 */
const uploadMultipleFiles = async (files, options, cloudinary) => {
  const uploadPromises = files.map((file, index) => {
    const fileOptions = typeof options === 'function' 
      ? options(file, index) 
      : { ...options, public_id: `${options.public_id || 'file'}-${index}` };
    
    return uploadFileToCloudinary(file.buffer, fileOptions, cloudinary);
  });

  return Promise.all(uploadPromises);
};

/**
 * Middleware to upload files from req.files to Cloudinary
 * @param {Object} config - Configuration object
 * @param {Object|Function} config.options - Cloudinary upload options or function
 * @param {String|Function} config.folder - Folder name or function to generate folder name
 * @param {String|Function} config.publicIdPrefix - Prefix for public_id or function
 * @param {Object} config.transformations - Image transformations (optional)
 * @param {String} config.resourceType - Resource type: 'image', 'video', 'raw', 'auto' (default: 'auto')
 * @param {Function} config.onUploadComplete - Callback after upload (optional)
 * @returns {Function} Express middleware
 */
const cloudinaryUpload = (config = {}) => {
  return catchAsync(async (req, res, next) => {
    // Get Cloudinary instance from app
    const cloudinary = req.app.get('cloudinary');
    
    if (!cloudinary) {
      return next(new AppError('Cloudinary is not configured', 500));
    }

    // If no files, skip upload
    if (!req.files || Object.keys(req.files).length === 0) {
      return next();
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const uploadResults = {};

    // Process each file field
    for (const [fieldName, files] of Object.entries(req.files)) {
      if (!files || files.length === 0) continue;

      const file = files[0]; // Get first file if multiple
      
      // Generate folder name
      const folderName = typeof config.folder === 'function' 
        ? config.folder(req, fieldName)
        : config.folder || 'uploads';

      // Generate public_id
      const publicIdPrefix = typeof config.publicIdPrefix === 'function'
        ? config.publicIdPrefix(req, fieldName)
        : config.publicIdPrefix || `${uniqueSuffix}-${fieldName}`;

      // Build upload options
      const uploadOptions = {
        folder: folderName,
        public_id: publicIdPrefix,
        resource_type: config.resourceType || 'auto',
        ...(config.transformations && { transformation: config.transformations }),
        ...(typeof config.options === 'function' 
          ? config.options(req, fieldName, file)
          : config.options || {}
        ),
      };

      try {
        // Upload file
        const result = await uploadFileToCloudinary(file.buffer, uploadOptions, cloudinary);
        
        // Store result
        uploadResults[fieldName] = {
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        };

        // Add URL to request body for easy access
        req.body[fieldName] = result.secure_url;

        // Call optional callback
        if (config.onUploadComplete) {
          await config.onUploadComplete(req, fieldName, result);
        }
      } catch (error) {
        return next(new AppError(`Failed to upload ${fieldName}: ${error.message}`, 500));
      }
    }

    // Store all upload results in request
    req.cloudinaryUploads = uploadResults;

    next();
  });
};

/**
 * Middleware to upload a single file field to Cloudinary
 * @param {String} fieldName - Name of the file field
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware
 */
const uploadSingleFile = (fieldName, options = {}) => {
  return cloudinaryUpload({
    folder: options.folder || 'uploads',
    publicIdPrefix: options.publicIdPrefix || `${Date.now()}-${fieldName}`,
    resourceType: options.resourceType || 'auto',
    transformations: options.transformations,
    options: options.uploadOptions,
    onUploadComplete: (req, field, result) => {
      // Store in specific location if needed
      if (options.storeIn) {
        if (!req.body[options.storeIn]) {
          req.body[options.storeIn] = {};
        }
        req.body[options.storeIn][field] = result.secure_url;
      }
      if (options.onComplete) {
        return options.onComplete(req, field, result);
      }
    },
  });
};

/**
 * Middleware to upload multiple file fields to Cloudinary
 * @param {Array} fieldConfigs - Array of field configurations
 * @param {Object} defaultOptions - Default options for all fields
 * @returns {Function} Express middleware
 */
const uploadMultipleFields = (fieldConfigs, defaultOptions = {}) => {
  return catchAsync(async (req, res, next) => {
    const cloudinary = req.app.get('cloudinary');
    
    if (!cloudinary) {
      return next(new AppError('Cloudinary is not configured', 500));
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return next();
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const uploadResults = {};

    for (const fieldConfig of fieldConfigs) {
      const fieldName = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.name;
      const options = typeof fieldConfig === 'object' ? { ...defaultOptions, ...fieldConfig } : defaultOptions;

      if (!req.files[fieldName] || req.files[fieldName].length === 0) continue;

      const file = req.files[fieldName][0];
      const folderName = options.folder || defaultOptions.folder || 'uploads';
      const publicId = options.publicId || `${uniqueSuffix}-${fieldName}`;

      const uploadOptions = {
        folder: folderName,
        public_id: publicId,
        resource_type: options.resourceType || 'auto',
        ...(options.transformations && { transformation: options.transformations }),
        ...(options.uploadOptions || {}),
      };

      try {
        const result = await uploadFileToCloudinary(file.buffer, uploadOptions, cloudinary);
        
        uploadResults[fieldName] = {
          url: result.secure_url,
          publicId: result.public_id,
        };

        // Store URL in request body
        // Use fieldMapping if provided, otherwise use fieldName
        const storageFieldName = options.fieldMapping || fieldName;
        
        if (options.storeIn) {
          if (!req.body[options.storeIn]) {
            req.body[options.storeIn] = {};
          }
          req.body[options.storeIn][storageFieldName] = result.secure_url;
        } else {
          req.body[storageFieldName] = result.secure_url;
        }
      } catch (error) {
        return next(new AppError(`Failed to upload ${fieldName}: ${error.message}`, 500));
      }
    }

    req.cloudinaryUploads = uploadResults;
    next();
  });
};

module.exports = {
  cloudinaryUpload,
  uploadSingleFile,
  uploadMultipleFields,
  uploadFileToCloudinary,
  uploadMultipleFiles,
};

