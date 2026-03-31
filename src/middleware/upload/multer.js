const multer = require('multer');
const stream = require('stream');
const multerStorage = multer.memoryStorage();

const cloudinary = require('cloudinary');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');
const logger = require('../../utils/logger');
const { uploadToCloudinary } = require('../../utils/storage/cloudinary');
const AppError = require('../../utils/errors/appError');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
  timeout: 120000, // Global 2-minute timeout
});
const multerFilter = (req, file, cb) => {
  const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (allowedMimes.has(file.mimetype)) return cb(null, true);
  return cb(new AppError('Unsupported file type', 400), false);
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});
exports.upProfileImage = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
]);

exports.uploadProfileImage = upload.single('imageCover');

exports.resizeImage = async (req, res, next) => {
  req.body = { ...req.body };
  req.file = { ...req.file };

  try {
    const cloudinary = req.app.get('cloudinary');
    if (req.file && req.file.buffer) {
      const buffer = req.file.buffer;
      // Validate media signature to prevent mimetype spoofing.
      const detectMediaFromBuffer = (buf) => {
        if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
        const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (buf.slice(0, 8).equals(pngSig)) return 'image/png';
        if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
          return 'image/webp';
        }
        return null;
      };

      const detected = detectMediaFromBuffer(buffer);
      if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected)) {
        return next(new AppError('Invalid image file', 400));
      }

      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      if (process.env.NODE_ENV === 'development') {
        logger.info(uniqueSuffix);
      }

      // Process cover image using central utility (handles duplicates)
      const coverResult = await uploadToCloudinary(req.file.buffer, {
        folder: 'products',
        public_id: `${uniqueSuffix}-cover`,
        transformation: [
          { width: 2000, height: 1333, crop: 'scale' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
        uploadedBy: req.user?._id || req.user?.id
      });

      req.body.avatar = coverResult.secure_url;
      logger.info('Cover image URL:', req.body.avatar);
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
