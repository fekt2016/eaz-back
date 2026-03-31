/**
 * Ensures product image URLs point to this deployment's Cloudinary delivery host
 * (mitigates arbitrary URL injection in multipart JSON).
 */
const logger = require('./logger');

const isHttpsCloudinaryUrl = (url, cloudName) => {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return false;
    if (u.hostname !== 'res.cloudinary.com') return false;
    if (cloudName && !u.pathname.includes(`/${cloudName}/`)) return false;
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {object} opts
 * @param {Array} [opts.images] - create payload
 * @param {Array} [opts.existingImages] - update payload (after parse)
 * @param {string} [opts.imageCover]
 * @returns {string|null} Error message or null if OK
 */
function validateSellerProductImageUrls(opts = {}) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('[validateSellerProductImageUrls] CLOUDINARY_CLOUD_NAME is unset; skipping image URL checks');
    }
    return null;
  }

  const entries = [];

  if (opts.imageCover && typeof opts.imageCover === 'string') {
    entries.push({ field: 'imageCover', url: opts.imageCover });
  }

  const list = opts.images || opts.existingImages;
  if (Array.isArray(list)) {
    list.forEach((img, i) => {
      if (!img || typeof img !== 'object') return;
      ['url', 'thumbnail', 'medium', 'large'].forEach((key) => {
        const v = img[key];
        if (v && typeof v === 'string') {
          entries.push({ field: `images[${i}].${key}`, url: v });
        }
      });
    });
  }

  for (const { field, url } of entries) {
    if (!isHttpsCloudinaryUrl(url, cloudName)) {
      return `Invalid or disallowed image URL (${field}). Use images uploaded through the seller image upload.`;
    }
  }

  return null;
}

module.exports = {
  validateSellerProductImageUrls,
  isHttpsCloudinaryUrl,
};
