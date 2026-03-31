const cloudinary = require('cloudinary').v2;

const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  return cloudinary;
};

const uploadProductImage = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: process.env.CLOUDINARY_FOLDER
          ? `${process.env.CLOUDINARY_FOLDER}/products`
          : 'saiisai/products',
        public_id: options.publicId,
        resource_type: 'image',
        format: 'webp',
        quality: 'auto:good',
        fetch_format: 'auto',
        eager: [
          { width: 200, height: 200, crop: 'fill', quality: 'auto', format: 'webp' },
          { width: 600, height: 600, crop: 'fill', quality: 'auto', format: 'webp' },
          { width: 1200, height: 1200, crop: 'limit', quality: 'auto', format: 'webp' },
        ],
        eager_async: false,
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
    uploadStream.end(buffer);
  });

const deleteCloudinaryAsset = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    // Non-fatal cleanup failure
    console.error('Cloudinary delete error:', publicId, error?.message);
  }
};

module.exports = {
  cloudinary,
  configureCloudinary,
  uploadProductImage,
  deleteCloudinaryAsset,
};
