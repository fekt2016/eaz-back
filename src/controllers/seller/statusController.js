const stream = require('stream');
const multer = require('multer');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Status = require('../../models/status/statusModel');
const logger = require('../../utils/logger');

const multerStorage = multer.memoryStorage();
const multerFilter = (req, file, cb) => {
  // Restrict to MP4; validate buffer signature after upload too.
  if (file.mimetype === 'video/mp4') return cb(null, true);
  return cb(new AppError('Only MP4 video files are allowed for status', 400), false);
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB for status videos
  },
});

exports.uploadStatusVideo = upload.single('video');

/**
 * Upload video buffer to Cloudinary and set req.body.videoUrl
 * Must run after uploadStatusVideo
 */
exports.uploadVideoToCloudinary = catchAsync(async (req, res, next) => {
  if (!req.file || !req.file.buffer) {
    return next(new AppError('Please upload a video', 400));
  }

  // Validate MP4 signature to prevent mimetype spoofing.
  const buffer = req.file.buffer;
  const isMp4 = Buffer.isBuffer(buffer) && buffer.length > 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp';
  if (!isMp4) {
    return next(new AppError('Invalid video file', 400));
  }

  const cloudinary = req.app.get('cloudinary');
  if (!cloudinary) {
    logger.error('[statusController] Cloudinary is not configured');
    return next(new AppError('Video upload service is not configured.', 500));
  }

  const uploadFromBuffer = (buffer, options) => {
    return new Promise((resolve, reject) => {
      const writeStream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      const bufferStream = new stream.PassThrough();
      bufferStream.end(buffer);
      bufferStream.pipe(writeStream);
    });
  };

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const videoResult = await uploadFromBuffer(req.file.buffer, {
    folder: 'statuses',
    public_id: `${uniqueSuffix}-status`,
    resource_type: 'video',
  });

  req.body.videoUrl = videoResult.secure_url;
  next();
});

/**
 * POST /api/v1/seller/statuses
 * Create a video status (seller must be authenticated via protectSeller)
 */
exports.createStatus = catchAsync(async (req, res, next) => {
  const videoUrl = req.body.videoUrl;
  if (!videoUrl) {
    return next(new AppError('Video is required', 400));
  }

  const status = await Status.create({
    seller: req.user._id,
    video: videoUrl,
    product: req.body.productId || undefined,
    caption: (req.body.caption || '').trim() || undefined,
  });

  res.status(201).json({
    status: 'success',
    data: { status },
  });
});

/**
 * GET /api/v1/seller/me/statuses
 * Get current seller's statuses (for management list)
 */
exports.getMyStatuses = catchAsync(async (req, res, next) => {
  const statuses = await Status.find({ seller: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('product', 'name imageCover slug');

  res.status(200).json({
    status: 'success',
    data: { items: statuses },
    total: statuses.length,
  });
});

/**
 * DELETE /api/v1/seller/statuses/:id
 * Delete a status (seller must own it)
 */
exports.deleteStatus = catchAsync(async (req, res, next) => {
  const status = await Status.findOne({
    _id: req.params.id,
    seller: req.user._id,
  });
  if (!status) {
    return next(new AppError('Status not found or you do not have permission to delete it', 404));
  }
  await Status.findByIdAndDelete(req.params.id);
  res.status(200).json({
    status: 'success',
    message: 'Status deleted',
  });
});
