/**
 * CLOUDINARY WRAPPER
 * 
 * Wraps cloudinary.uploader.upload to log ALL calls and catch errors
 * Includes mobile app guard to prevent crashes
 * Uses safePath utilities to prevent ERR_INVALID_ARG_TYPE
 */

const { toPathString } = require('../safePath');

let cloudinaryInstance = null;

// Helper to check if we're in a mobile request context
// Note: This is a best-effort check since cloudinary.uploader.upload
// may be called from background jobs without req object
const isMobileRequestContext = () => {
  if (typeof global !== 'undefined' && global.lastMobileRequest) {
    return global.lastMobileRequest.app === 'Saysay';
  }
  return false;
};

const wrapCloudinaryUpload = (cloudinary) => {
  if (cloudinaryInstance) {
    console.log('⚠️ [cloudinaryWrapper] Cloudinary already wrapped, skipping');
    return cloudinary;
  }

  cloudinaryInstance = cloudinary;
  const originalUpload = cloudinary.uploader.upload.bind(cloudinary.uploader);

  // Wrap cloudinary.uploader.upload
  cloudinary.uploader.upload = function(file, options, callback) {
    console.log('\n☁️ [CLOUDINARY] cloudinary.uploader.upload called');
    
    // 🛡️ MOBILE GUARD: Check if this is from a mobile request
    if (isMobileRequestContext()) {
      console.warn('⚠️  [CLOUDINARY] Blocked upload - mobile app context detected');
      console.warn('  📱 Last mobile request:', global.lastMobileRequest);
      const error = new Error('Cloudinary upload temporarily disabled for mobile app during debugging');
      if (callback) {
        return callback(error);
      }
      return Promise.reject(error);
    }
    
    console.log('  file:', file);
    console.log('  file type:', typeof file);
    console.log('  file is string?', typeof file === 'string');
    console.log('  file is Buffer?', file instanceof Buffer);
    
    // Validate file parameter - USE SAFE PATH UTILITIES
    if (!file) {
      console.error('\n🚨🚨🚨 BLOCKING ERR_INVALID_ARG_TYPE - file is null/undefined!');
      const error = new Error('ERR_INVALID_ARG_TYPE PREVENTION: cloudinary.uploader.upload requires file, got null/undefined');
      if (callback) {
        return callback(error);
      }
      return Promise.reject(error);
    }

    // If it's a string, validate it's a valid path
    if (typeof file === 'string') {
      const pathString = toPathString(file, { label: 'cloudinary upload', allowEmpty: false });
      if (!pathString) {
        const error = new Error('ERR_INVALID_ARG_TYPE PREVENTION: invalid file path string');
        if (callback) {
          return callback(error);
        }
        return Promise.reject(error);
      }
      file = pathString; // Use validated path
      console.log('  ✅ Validated string path:', file.substring(0, 50) + '...');
    }
    // If it's a Buffer, it's valid
    else if (file instanceof Buffer) {
      console.log('  ✅ Using Buffer (valid)');
      // Keep as is, will use upload_stream
    }
    // If it's an object (not Buffer), try to extract path or buffer
    else if (file && typeof file === 'object') {
      // Try to extract path using safePath utility
      const pathString = toPathString(file, { label: 'cloudinary upload', allowEmpty: false });
      if (pathString) {
        console.log('  ✅ Extracted path from object:', pathString.substring(0, 50) + '...');
        file = pathString; // Use the extracted path
      } else if (file.buffer && file.buffer instanceof Buffer) {
        console.log('  ✅ Using file.buffer (Buffer)');
        // Keep as is, will use upload_stream
      } else {
        console.error('\n🚨🚨🚨 BLOCKING ERR_INVALID_ARG_TYPE - invalid file object!');
        console.error('  Object keys:', Object.keys(file));
        console.error('  Has .path?', 'path' in file);
        console.error('  Has .buffer?', 'buffer' in file);
        const error = new Error(
          `ERR_INVALID_ARG_TYPE PREVENTION: cloudinary.uploader.upload requires string path or Buffer, ` +
          `got object without .path or .buffer. Object keys: ${Object.keys(file).join(', ')}`
        );
        if (callback) {
          return callback(error);
        }
        return Promise.reject(error);
      }
    }
    // Invalid type
    else {
      console.error('\n🚨🚨🚨 BLOCKING ERR_INVALID_ARG_TYPE - invalid file type!');
      console.error('  Type:', typeof file);
      const error = new Error(
        `ERR_INVALID_ARG_TYPE PREVENTION: cloudinary.uploader.upload requires string path or Buffer, got ${typeof file}`
      );
      if (callback) {
        return callback(error);
      }
      return Promise.reject(error);
    }
    
    console.log('  options:', options);
    console.log('  Stack trace:');
    console.log(new Error().stack.split('\n').slice(1, 6).join('\n'));
    console.log('');

    // Call original with validated file
    try {
      return originalUpload(file, options, callback);
    } catch (error) {
      if (error.message && error.message.includes('ERR_INVALID_ARG_TYPE')) {
        console.error('\n🚨🚨🚨 ERR_INVALID_ARG_TYPE IN CLOUDINARY.UPLOADER.UPLOAD!');
        console.error('  Error:', error.message);
        console.error('  File passed:', file);
        console.error('  File type:', typeof file);
        console.error('  Stack trace:', error.stack);
      }
      throw error;
    }
  };

  console.log('✅ [cloudinaryWrapper] Cloudinary uploader wrapped');
  return cloudinary;
};

module.exports = wrapCloudinaryUpload;
