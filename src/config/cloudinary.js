const cloudinary = require('cloudinary').v2;

/**
 * Configure and return Cloudinary instance
 * @returns {Object} Configured Cloudinary instance
 */
const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  return cloudinary;
};

module.exports = configureCloudinary;
