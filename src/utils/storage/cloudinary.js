// utils/cloudinary.js
const stream = require('stream');
const cloudinaryPackage = require('cloudinary');
const resolveFilePath = require('../helpers/resolveFilePath');

const cloudinary = cloudinaryPackage.v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadToCloudinary(fileOrBuffer, options = {}) {
  // 🔍 DEBUG: Log what we received
  console.log('[uploadToCloudinary] DEBUG:');
  console.log('  Input:', fileOrBuffer);
  console.log('  Type:', typeof fileOrBuffer);
  console.log('  Is string?', typeof fileOrBuffer === 'string');
  console.log('  Is Buffer?', fileOrBuffer instanceof Buffer);
  console.log('  Is object?', typeof fileOrBuffer === 'object' && fileOrBuffer !== null);
  if (fileOrBuffer && typeof fileOrBuffer === 'object') {
    console.log('  Has .path?', 'path' in fileOrBuffer);
    console.log('  Has .buffer?', 'buffer' in fileOrBuffer);
    console.log('  Object keys:', Object.keys(fileOrBuffer));
  }

  // If passed a string, treat it as a file path
  if (typeof fileOrBuffer === 'string') {
    // 🛡️ SAFETY: Validate string is not empty and is actually a path
    if (!fileOrBuffer || fileOrBuffer.trim() === '') {
      throw new Error('Invalid file path: empty string');
    }
    // FIX: Use the string directly as file path, not fileOrBuffer[0].buffer
    console.log('[uploadToCloudinary] ✅ Using string path directly');
    // Ensure cloudinary.uploader.upload receives a string, not an object
    const pathString = String(fileOrBuffer).trim();
    if (typeof pathString !== 'string') {
      throw new Error(`Invalid path type after conversion: ${typeof pathString}`);
    }
    return cloudinary.uploader.upload(pathString, options);
  }

  // If passed a Buffer, upload from buffer
  if (fileOrBuffer instanceof Buffer) {
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

  // If passed a file object, try to get buffer or path
  if (fileOrBuffer && typeof fileOrBuffer === 'object') {
    // Try buffer first (memory storage)
    if (fileOrBuffer.buffer) {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          options,
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          },
        );
        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileOrBuffer.buffer);
        bufferStream.pipe(uploadStream);
      });
    }

    // Try path (disk storage) - USE resolveFilePath for safety
    if (fileOrBuffer.path) {
      try {
        // 🛡️ SAFETY: Validate .path is a string before calling resolveFilePath
        if (typeof fileOrBuffer.path !== 'string') {
          throw new Error(
            `Invalid file.path type: expected string, got ${typeof fileOrBuffer.path}. ` +
            `Object keys: ${Object.keys(fileOrBuffer).join(', ')}`
          );
        }
        const filePath = resolveFilePath(fileOrBuffer, 'cloudinary upload');
        console.log('[uploadToCloudinary] ✅ Using resolved file path');
        // 🛡️ SAFETY: Double-check result is a string
        if (typeof filePath !== 'string') {
          throw new Error(
            `resolveFilePath returned non-string: ${typeof filePath}. ` +
            `This should never happen.`
          );
        }
        return cloudinary.uploader.upload(filePath, options);
      } catch (pathError) {
        // If resolveFilePath fails, it means .path is not a string
        throw new Error(
          `Invalid file object for cloudinary upload: ${pathError.message}`
        );
      }
    }

    // Invalid file object
    throw new Error(
      `Invalid file object: must have either .buffer (memory storage) or .path (disk storage). ` +
      `Received object with keys: ${Object.keys(fileOrBuffer).join(', ')}`
    );
  }

  // Invalid input
  throw new Error(
    `Invalid file input: expected string path, Buffer, or file object, got ${typeof fileOrBuffer}. ` +
    `Value: ${JSON.stringify(fileOrBuffer)}`
  );
}

module.exports = {
  cloudinary,
  uploadToCloudinary,
};
