const AppError = require('../errors/appError');
const { toPathString, safeFs } = require('../safePath');

/**
 * Get file path from file object
 * Ensures we always pass a string path to file system operations
 * 
 * @param {Object|String} file - File object (req.file) or string path
 * @param {String} fieldName - Field name for error messages (optional)
 * @returns {String} File path string
 * @throws {AppError} If file path is invalid
 */
const getFilePath = (file, fieldName = 'file') => {
  // USE SAFE PATH UTILITY - more robust
  const pathString = toPathString(file, { label: fieldName, allowEmpty: false });
  if (pathString) {
    return pathString;
  }
  
  // Fallback to original logic for backward compatibility
  // If already a string, validate and return
  if (typeof file === 'string') {
    if (!file || file.trim().length === 0) {
      throw new AppError(`Invalid ${fieldName} path: empty string`, 400);
    }
    return file;
  }

  // If it's an object, extract the path
  if (file && typeof file === 'object') {
    // Check for .path property (multer disk storage)
    if (file.path && typeof file.path === 'string') {
      return file.path;
    }
    
    // Check for .filename (multer memory storage - no path available)
    if (file.filename && !file.path) {
      throw new AppError(
        `Invalid ${fieldName}: file is in memory storage (no path available). Use buffer instead.`,
        400
      );
    }

    // If no path found, throw error
    throw new AppError(
      `Invalid ${fieldName}: missing path property. File object: ${JSON.stringify(Object.keys(file))}`,
      400
    );
  }

  // If null/undefined
  if (!file) {
    throw new AppError(`Invalid ${fieldName}: file is null or undefined`, 400);
  }

  // Fallback error
  throw new AppError(
    `Invalid ${fieldName}: expected string path or file object with .path property, got ${typeof file}`,
    400
  );
};

/**
 * Get buffer from file object
 * For memory storage (multer.memoryStorage())
 * 
 * @param {Object} file - File object (req.file)
 * @param {String} fieldName - Field name for error messages (optional)
 * @returns {Buffer} File buffer
 * @throws {AppError} If buffer is invalid
 */
const getFileBuffer = (file, fieldName = 'file') => {
  if (!file) {
    throw new AppError(`Invalid ${fieldName}: file is null or undefined`, 400);
  }

  if (file instanceof Buffer) {
    return file;
  }

  if (file && typeof file === 'object' && file.buffer) {
    if (file.buffer instanceof Buffer) {
      return file.buffer;
    }
    
    // Try to convert to buffer if it's not already
    if (typeof file.buffer === 'string') {
      return Buffer.from(file.buffer);
    }
  }

  throw new AppError(
    `Invalid ${fieldName}: missing buffer property. Use getFilePath() for disk storage files.`,
    400
  );
};

/**
 * Validate file path before using with fs operations
 * 
 * @param {String} filePath - File path to validate
 * @param {String} operation - Operation name for error messages (optional)
 * @returns {String} Validated file path
 * @throws {AppError} If path is invalid
 */
const validateFilePath = (filePath, operation = 'file operation') => {
  if (!filePath || typeof filePath !== 'string') {
    throw new AppError(
      `Invalid file path for ${operation}: expected string, got ${typeof filePath}`,
      400
    );
  }

  if (filePath.trim().length === 0) {
    throw new AppError(`Invalid file path for ${operation}: empty string`, 400);
  }

  return filePath;
};

/**
 * Safely delete a file with error handling
 * 
 * @param {String} filePath - File path to delete
 * @param {Boolean} throwOnError - Whether to throw on error (default: false)
 * @returns {Boolean} True if deleted, false if error (when throwOnError is false)
 */
const safeDeleteFile = (filePath, throwOnError = false) => {
  try {
    // USE SAFE PATH UTILITY - never crashes
    const validatedPath = toPathString(filePath, { label: 'file deletion', allowEmpty: false });
    
    if (!validatedPath) {
      if (throwOnError) {
        throw new AppError(`Invalid file path for deletion: expected string, got ${typeof filePath}`, 400);
      }
      console.warn(`[safeDeleteFile] ⚠️  Invalid file path, skipping deletion`);
      return false;
    }
    
    // USE SAFE VERSIONS - never crashes
    if (safeFs.existsSyncSafe(validatedPath, { label: 'file deletion' })) {
      safeFs.unlinkSyncSafe(validatedPath, { label: 'file deletion' });
      return true;
    }
    
    // File doesn't exist - not an error
    return true;
  } catch (error) {
    if (throwOnError) {
      throw new AppError(
        `Failed to delete file: ${error.message}`,
        500
      );
    }
    // Log error but don't throw (for cleanup operations)
    console.error(`[safeDeleteFile] Error deleting file ${filePath}:`, error.message);
    return false;
  }
};

module.exports = {
  getFilePath,
  getFileBuffer,
  validateFilePath,
  safeDeleteFile,
};

