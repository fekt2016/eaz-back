const multer = require('multer');
const stream = require('stream');
const multerStorage = multer.memoryStorage();

const cloudinary = require('cloudinary');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');
const logger = require('../../utils/logger');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
  timeout: 120000, // Global 2-minute timeout
});
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
exports.upProfileImage = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
]);

exports.uploadProfileImage = upload.single('imageCover');

exports.resizeImage = async (req, res, next) => {
  req.body = { ...req.body };
  req.file = { ...req.file };
  logger.info(req.body);
  logger.info(req.file);

  try {
    const cloudinary = req.app.get('cloudinary');
    if (req.file) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      logger.info(uniqueSuffix);

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
      if (req.file.buffer) {
        const coverFile = req.file.buffer;
        // Process cover image
        const coverResult = await uploadFromBuffer(coverFile, {
          folder: 'products',
          public_id: `${uniqueSuffix}-cover`,
          transformation: [
            { width: 2000, height: 1333, crop: 'scale' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        });

        req.body.avatar = coverResult.secure_url;
        logger.info('Cover image URL:', req.body.avatar);
      }
    }
  } catch (err) {
    logger.error(`Upload Failed: ${err.message}`);
    return res.status(408).json({
      status: 'error',
      message: `Upload failed: ${err.message}`,
    });
  }
  // try {
  //   const cloudinary = req.app.get('cloudinary');
  //   if (!req?.file?.buffer) return next();
  //   // 1. Aggressive image optimization
  //   const optimizedBuffer = await sharp(req.file.buffer)
  //     .resize(1200, 800, {
  //       fit: 'inside',
  //       withoutEnlargement: true,
  //       fastShrinkOnLoad: false,
  //     })
  //     .webp({ quality: 70, force: true }) // Force WebP format
  //     .toBuffer();
  //   logger.info(`Optimized size: ${optimizedBuffer.length / 1024}KB`);
  //   // 2. Modern upload function with abort control
  //   const uploadWithTimeout = (buffer, options) => {
  //     return new Promise((resolve, reject) => {
  //       const controller = new AbortController();
  //       const timeout = setTimeout(() => {
  //         controller.abort();
  //         reject(new Error('Upload timeout (120s)'));
  //       }, 120000);
  //       const uploadStream = cloudinary.uploader.upload_stream(
  //         {
  //           ...options,
  //           chunk_size: 6_000_000, // 6MB chunks
  //           resource_type: 'image',
  //           timeout: 120000,
  //         },
  //         (err, result) => {
  //           clearTimeout(timeout);
  //           err ? reject(err) : resolve(result);
  //         },
  //       );
  //       const bufferStream = new stream.PassThrough();
  //       // 3. Proper stream cleanup
  //       controller.signal.addEventListener('abort', () => {
  //         bufferStream.destroy();
  //         uploadStream.destroy();
  //       });
  //       pipeline(bufferStream, uploadStream, { signal: controller.signal })
  //         .then(() => logger.info('Chunk upload complete');)
  //         .catch((err) => {
  //           if (!controller.signal.aborted) reject(err);
  //         });
  //       bufferStream.end(buffer);
  //     });
  //   };
  //   // 4. Upload with diagnostics
  //   const start = Date.now();
  //   const result = await uploadWithTimeout(optimizedBuffer, {
  //     folder: 'avatar',
  //     public_id: `avatar-${Date.now()}`,
  //     transformation: [{ width: 500, height: 500, crop: 'fill' }],
  //   });
  //   logger.info(`Upload completed in ${(Date.now(); - start) / 1000}s`);
  //   req.body.avatar = result.secure_url;
  //   next();
  // } catch (err) {
  //   logger.error(`Upload Failed: ${err.message}`);
  //   return res.status(408).json({
  //     status: 'error',
  //     message: `Upload failed: ${err.message}`,
  //   });
  // }
  next();
};
