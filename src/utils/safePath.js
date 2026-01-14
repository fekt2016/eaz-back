/**
 * SAFE PATH UTILITIES
 * 
 * Permanent fix to prevent ERR_INVALID_ARG_TYPE crashes.
 * All fs.* and path.* operations should use these utilities.
 * 
 * Usage:
 *   const { toPathString, safeFs } = require('./utils/safePath');
 *   const path = toPathString(req.file, { label: 'upload' });
 *   if (!path) return res.status(400).json({ error: 'Invalid file path' });
 *   safeFs.unlinkSyncSafe(path);
 */

const fs = require('fs');
const path = require('path');
const AppError = require('./errors/appError');

/**
 * Convert any value to a string path safely
 * 
 * @param {any} value - Value to convert (string, object with .path, etc.)
 * @param {Object} options - Options
 * @param {string} options.label - Label for error messages (e.g., 'upload', 'export')
 * @param {boolean} options.allowEmpty - Allow empty strings (default: false)
 * @returns {string|null} - String path or null if invalid
 */
const toPathString = (value, { label = 'file', allowEmpty = false } = {}) => {
  // Handle null/undefined
  if (value === null || value === undefined) {
    console.warn(`[safePath] ⚠️  ${label}: value is null/undefined`);
    return null;
  }

  // If already a string, validate and return
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!allowEmpty && trimmed.length === 0) {
      console.warn(`[safePath] ⚠️  ${label}: empty string not allowed`);
      return null;
    }
    return trimmed;
  }

  // If it's an object, try to extract path
  if (value && typeof value === 'object') {
    // Check for .path property (multer disk storage, file objects)
    if (value.path && typeof value.path === 'string') {
      const trimmed = value.path.trim();
      if (!allowEmpty && trimmed.length === 0) {
        console.warn(`[safePath] ⚠️  ${label}: extracted path is empty`);
        return null;
      }
      console.log(`[safePath] ✅ ${label}: extracted path from object: ${trimmed}`);
      return trimmed;
    }

    // Check for .filePath property (some return objects)
    if (value.filePath && typeof value.filePath === 'string') {
      const trimmed = value.filePath.trim();
      if (!allowEmpty && trimmed.length === 0) {
        console.warn(`[safePath] ⚠️  ${label}: extracted filePath is empty`);
        return null;
      }
      console.log(`[safePath] ✅ ${label}: extracted filePath from object: ${trimmed}`);
      return trimmed;
    }

    // Object has no path property
    console.warn(`[safePath] ⚠️  ${label}: object has no .path or .filePath property`, {
      type: typeof value,
      keys: Object.keys(value),
      hasPath: 'path' in value,
      hasFilePath: 'filePath' in value,
    });
    return null;
  }

  // Invalid type
  console.warn(`[safePath] ⚠️  ${label}: invalid type`, {
    type: typeof value,
    value: value instanceof Buffer ? 'Buffer' : String(value).substring(0, 100),
  });
  return null;
};

/**
 * Assert that value is a valid string path (for request validation)
 * Throws AppError 400 if invalid - ONLY use for request validation, not internal cleanup
 * 
 * @param {any} value - Value to validate
 * @param {Object} options - Options
 * @param {string} options.label - Label for error messages
 * @throws {AppError} If value is not a valid string path
 */
const assertPathString = (value, { label = 'file' } = {}) => {
  const pathString = toPathString(value, { label, allowEmpty: false });
  if (!pathString) {
    throw new AppError(
      `Invalid ${label} path: expected string or object with .path property, got ${typeof value}`,
      400
    );
  }
  return pathString;
};

/**
 * Safe fs wrapper - never throws ERR_INVALID_ARG_TYPE
 * All methods return safe fallbacks instead of crashing
 */
const safeFs = {
  /**
   * Safe fs.existsSync - returns false if path is invalid
   */
  existsSyncSafe: (filePath, options = {}) => {
    const pathString = toPathString(filePath, { label: options.label || 'existsSync', allowEmpty: false });
    if (!pathString) {
      console.warn(`[safeFs.existsSyncSafe] ⚠️  Invalid path, returning false`);
      return false;
    }
    try {
      return fs.existsSync(pathString);
    } catch (error) {
      console.error(`[safeFs.existsSyncSafe] ❌ Error checking existence:`, error.message);
      return false; // Safe fallback
    }
  },

  /**
   * Safe fs.unlinkSync - silently skips if path is invalid
   */
  unlinkSyncSafe: (filePath, options = {}) => {
    const pathString = toPathString(filePath, { label: options.label || 'unlinkSync', allowEmpty: false });
    if (!pathString) {
      console.warn(`[safeFs.unlinkSyncSafe] ⚠️  Invalid path, skipping deletion`);
      return; // Silently skip
    }
    try {
      // Only delete if file exists
      if (fs.existsSync(pathString)) {
        fs.unlinkSync(pathString);
        console.log(`[safeFs.unlinkSyncSafe] ✅ Deleted: ${pathString}`);
      } else {
        console.log(`[safeFs.unlinkSyncSafe] ℹ️  File does not exist, skipping: ${pathString}`);
      }
    } catch (error) {
      // Log but don't throw - cleanup failures are non-critical
      console.error(`[safeFs.unlinkSyncSafe] ❌ Error deleting file:`, error.message);
    }
  },

  /**
   * Safe fs.readFileSync - returns null if path is invalid or read fails
   */
  readFileSyncSafe: (filePath, encoding = 'utf8', options = {}) => {
    const pathString = toPathString(filePath, { label: options.label || 'readFileSync', allowEmpty: false });
    if (!pathString) {
      console.warn(`[safeFs.readFileSyncSafe] ⚠️  Invalid path, returning null`);
      return null;
    }
    try {
      if (!fs.existsSync(pathString)) {
        console.warn(`[safeFs.readFileSyncSafe] ⚠️  File does not exist: ${pathString}`);
        return null;
      }
      return fs.readFileSync(pathString, encoding);
    } catch (error) {
      console.error(`[safeFs.readFileSyncSafe] ❌ Error reading file:`, error.message);
      return null; // Safe fallback
    }
  },

  /**
   * Safe fs.writeFileSync - silently skips if path is invalid
   */
  writeFileSyncSafe: (filePath, data, options = {}) => {
    const pathString = toPathString(filePath, { label: options.label || 'writeFileSync', allowEmpty: false });
    if (!pathString) {
      console.warn(`[safeFs.writeFileSyncSafe] ⚠️  Invalid path, skipping write`);
      return; // Silently skip
    }
    try {
      // Ensure directory exists
      const dir = path.dirname(pathString);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(pathString, data, options.encoding || 'utf8');
      console.log(`[safeFs.writeFileSyncSafe] ✅ Written: ${pathString}`);
    } catch (error) {
      console.error(`[safeFs.writeFileSyncSafe] ❌ Error writing file:`, error.message);
      // Don't throw - write failures should be logged but not crash
    }
  },

  /**
   * Safe fs.createReadStream - returns null if path is invalid
   */
  createReadStreamSafe: (filePath, options = {}) => {
    const pathString = toPathString(filePath, { label: options.label || 'createReadStream', allowEmpty: false });
    if (!pathString) {
      console.warn(`[safeFs.createReadStreamSafe] ⚠️  Invalid path, returning null`);
      return null;
    }
    try {
      if (!fs.existsSync(pathString)) {
        console.warn(`[safeFs.createReadStreamSafe] ⚠️  File does not exist: ${pathString}`);
        return null;
      }
      return fs.createReadStream(pathString, options);
    } catch (error) {
      console.error(`[safeFs.createReadStreamSafe] ❌ Error creating read stream:`, error.message);
      return null; // Safe fallback
    }
  },
};

/**
 * Safe path utilities
 */
const safePath = {
  /**
   * Safe path.resolve - returns null if any argument is invalid
   */
  resolveSafe: (...args) => {
    const validArgs = args.map((arg, index) => {
      const pathString = toPathString(arg, { label: `path.resolve[${index}]`, allowEmpty: true });
      if (!pathString && arg !== undefined && arg !== null) {
        console.warn(`[safePath.resolveSafe] ⚠️  Invalid argument at index ${index}, returning null`);
        return null;
      }
      return pathString || arg; // Allow undefined for optional args
    });

    if (validArgs.some(arg => arg === null && args[validArgs.indexOf(arg)] !== null && args[validArgs.indexOf(arg)] !== undefined)) {
      return null;
    }

    try {
      return path.resolve(...validArgs);
    } catch (error) {
      console.error(`[safePath.resolveSafe] ❌ Error resolving path:`, error.message);
      return null;
    }
  },

  /**
   * Safe path.join - returns null if any argument is invalid
   */
  joinSafe: (...args) => {
    const validArgs = args.map((arg, index) => {
      const pathString = toPathString(arg, { label: `path.join[${index}]`, allowEmpty: true });
      if (!pathString && arg !== undefined && arg !== null) {
        console.warn(`[safePath.joinSafe] ⚠️  Invalid argument at index ${index}, returning null`);
        return null;
      }
      return pathString || arg; // Allow undefined for optional args
    });

    if (validArgs.some(arg => arg === null && args[validArgs.indexOf(arg)] !== null && args[validArgs.indexOf(arg)] !== undefined)) {
      return null;
    }

    try {
      return path.join(...validArgs);
    } catch (error) {
      console.error(`[safePath.joinSafe] ❌ Error joining path:`, error.message);
      return null;
    }
  },
};

module.exports = {
  toPathString,
  assertPathString,
  safeFs,
  safePath,
};

