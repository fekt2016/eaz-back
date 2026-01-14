/**
 * GLOBAL FILE PATH RESOLVER
 * 
 * MANDATORY: Use this function before ANY file operation
 * This prevents ERR_INVALID_ARG_TYPE errors permanently
 * 
 * @param {Object|String} file - File object (req.file) or string path
 * @param {String} operation - Operation name for error messages (e.g., 'upload', 'delete')
 * @returns {String} Validated file path string
 * @throws {Error} If file path is invalid
 */
const resolveFilePath = (file, operation = 'file operation') => {
  // 🔍 DEBUG: Log what we received
  console.log(`[resolveFilePath] DEBUG for ${operation}:`);
  console.log('  Input:', file);
  console.log('  Type:', typeof file);
  console.log('  Is string?', typeof file === 'string');
  console.log('  Is object?', typeof file === 'object' && file !== null);
  if (file && typeof file === 'object') {
    console.log('  Has .path?', 'path' in file);
    console.log('  .path value:', file.path);
    console.log('  .path type:', typeof file.path);
    console.log('  Object keys:', Object.keys(file));
  }

  // If already a string, validate and return
  if (typeof file === 'string') {
    if (!file || file.trim().length === 0) {
      throw new Error(`Invalid file path for ${operation}: empty string`);
    }
    console.log(`[resolveFilePath] ✅ Returning string path: ${file}`);
    return file;
  }

  // If it's an object, extract the path
  if (file && typeof file === 'object') {
    // Check for .path property (multer disk storage)
    if (file.path && typeof file.path === 'string') {
      console.log(`[resolveFilePath] ✅ Extracted path from object: ${file.path}`);
      return file.path;
    }
    
    // Check for .filename (multer memory storage - no path available)
    if (file.filename && !file.path) {
      throw new Error(
        `Invalid file for ${operation}: file is in memory storage (no path available). ` +
        `Use buffer-based upload instead of file path operations.`
      );
    }

    // If no path found, throw error with details
    throw new Error(
      `Invalid file object for ${operation}: missing path property. ` +
      `Received object with keys: ${Object.keys(file).join(', ')}. ` +
      `If you passed req.file, ensure it has a .path property (disk storage).`
    );
  }

  // If null/undefined
  if (!file) {
    throw new Error(`Invalid file for ${operation}: file is null or undefined`);
  }

  // Fallback error
  throw new Error(
    `Invalid file for ${operation}: expected string path or file object with .path property, got ${typeof file}`
  );
};

module.exports = resolveFilePath;

