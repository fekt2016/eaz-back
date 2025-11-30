// utils/cloudinary.js
const stream = require('stream');
const cloudinaryPackage = require('cloudinary');

const cloudinary = cloudinaryPackage.v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadToCloudinary(fileOrBuffer, options = {}) {
  // If passed a string, treat it as a file path
  if (typeof fileOrBuffer === 'string') {
    return cloudinary.uploader.upload(fileOrBuffer[0].buffer, options);
  }

  // Otherwise assume it's a Buffer
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileOrBuffer);
    bufferStream.pipe(uploadStream);
  });
}

module.exports = {
  cloudinary,
  uploadToCloudinary,
};
