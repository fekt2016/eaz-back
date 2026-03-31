const multer = require('multer');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

const detectMimeFromMagicBytes = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  const hex4 = buffer.slice(0, 4).toString('hex');
  const hex3 = buffer.slice(0, 3).toString('hex');
  const riff = buffer.slice(0, 4).toString('ascii') === 'RIFF';
  const webp = buffer.slice(8, 12).toString('ascii') === 'WEBP';

  if (hex3 === 'ffd8ff') return 'image/jpeg';
  if (hex4 === '89504e47') return 'image/png';
  if (riff && webp) return 'image/webp';
  return null;
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(Object.assign(new Error('FILE_TYPE_NOT_ALLOWED'), { code: 422 }), false);
    }
    return cb(null, true);
  },
});

const validateImageBuffer = (req, res, next) => {
  if (!req.file?.buffer) return next();

  const detected = detectMimeFromMagicBytes(req.file.buffer);
  if (!detected || !ALLOWED_MIME_TYPES.includes(detected)) {
    return res.status(422).json({
      success: false,
      message: 'Invalid image file. Only JPEG, PNG, and WebP are allowed.',
      error: 'FILE_TYPE_NOT_ALLOWED',
    });
  }

  return next();
};

module.exports = {
  imageUpload,
  validateImageBuffer,
  detectMimeFromMagicBytes,
};
