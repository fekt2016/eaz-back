/**
 * FILE OPERATION LOGGER
 * 
 * Wraps file operations to log ALL file system calls
 * This helps identify which operation is causing ERR_INVALID_ARG_TYPE
 * 
 * CRITICAL: This wrapper MUST NEVER THROW - it's a best-effort logger
 * If it can't stringify/extract a path, it logs a warning and calls the original function
 * 
 * NOTE: Respects feature flags - will block operations when FILE_UPLOADS is disabled
 */

const fs = require('fs');
const path = require('path');
const { checkFeature, FEATURES } = require('../featureFlags');
const { toPathString } = require('../safePath');

// Store original functions
// NOTE: These may already be trapped by fsTrap.js (which loads first)
// That's fine - the trap will catch objects before they reach here
const originalUnlinkSync = fs.unlinkSync;
const originalUnlink = fs.unlink;
const originalReadFileSync = fs.readFileSync;
const originalReadFile = fs.readFile;
const originalCreateReadStream = fs.createReadStream;
const originalExistsSync = fs.existsSync;
const originalWriteFileSync = fs.writeFileSync;
const originalWriteFile = fs.writeFile;

// Helper to get screen info from global context
const getScreenInfo = () => {
  if (typeof global !== 'undefined' && global.lastMobileRequest) {
    const { screen, params, route } = global.lastMobileRequest;
    return `\n  📱 From Screen: ${screen || 'Unknown'}` +
           (params ? `\n  📱 Screen Params: ${JSON.stringify(params)}` : '') +
           `\n  📱 Last Route: ${route || 'Unknown'}`;
  }
  return '';
};

// Wrap fs.unlinkSync - NEVER THROWS - SAFETY FIRST
fs.unlinkSync = function(filePath) {
  try {
    // 🛡️ STRICT GUARD: Must be string or valid object with .path
    if (typeof filePath !== 'string') {
      if (filePath && typeof filePath === 'object' && typeof filePath.path === 'string') {
        filePath = filePath.path; // Extract path from object
      } else {
        console.warn('[FILE_OP] ⚠️  [SAFETY_DISABLED] fs.unlinkSync skipped - invalid path type:', typeof filePath);
        if (filePath && typeof filePath === 'object') {
          console.warn('  Object keys:', Object.keys(filePath));
        }
        return; // Silently skip - NEVER throw
      }
    }
    
    // FEATURE FLAG: Block file operations when FILE_UPLOADS is disabled
    // BUT: Allow core operations (like reading .env files) to continue
    // Only block operations that look like they're related to exports/uploads
    const isExportRelated = filePath && (
      filePath.includes('exports') || 
      filePath.includes('user-data') ||
      filePath.includes('archive')
    );
    
    if (isExportRelated && !checkFeature(FEATURES.FILE_UPLOADS, 'fileOperationLogger')) {
      console.warn(`⚠️  [FILE_OP] Blocked fs.unlinkSync - FILE_UPLOADS disabled: ${filePath}`);
      return; // Silently skip - don't throw, just don't execute
    }

    console.log('\n📁 [FILE_OP] fs.unlinkSync called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    console.log('  Stack trace:');
    console.log(new Error().stack.split('\n').slice(1, 5).join('\n'));
    console.log(getScreenInfo());
    console.log('');

    // At this point, filePath is guaranteed to be a string
    return originalUnlinkSync.call(this, filePath);
  } catch (error) {
    // NEVER THROW from this wrapper - log and return silently
    console.error('[FILE_OP] ❌ Error in fs.unlinkSync wrapper:', error.message);
    console.error('  [SAFETY] Silently skipping operation to prevent crash');
    return; // Silently fail - NEVER throw
  }
};

// Wrap fs.unlink - NEVER THROWS
fs.unlink = function(filePath, callback) {
  try {
    console.log('\n📁 [FILE_OP] fs.unlink called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const pathString = toPathString(filePath, { label: 'unlink', allowEmpty: false });
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - SKIPPING operation');
      // DO NOT call original with object - trap will catch it
      if (callback) {
        return callback(new Error('Invalid file path: expected string, got ' + typeof filePath));
      }
      return;
    }
    
    return originalUnlink.call(this, safePath, callback);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.unlink wrapper:', error.message);
    try {
      return originalUnlink.call(this, filePath, callback);
    } catch (originalError) {
      console.error('[FILE_OP] ❌ Original fs.unlink also failed:', originalError.message);
      if (callback) callback(originalError);
      return;
    }
  }
};

// Wrap fs.readFileSync - NEVER THROWS
fs.readFileSync = function(filePath, ...args) {
  try {
    console.log('\n📁 [FILE_OP] fs.readFileSync called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const pathString = toPathString(filePath, { label: 'readFileSync', allowEmpty: false });
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - SKIPPING operation (trap will catch if original called)');
      // DO NOT call original with object - trap will catch it
      // Return null as safe fallback
      return null;
    }
    
    return originalReadFileSync.call(this, safePath, ...args);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.readFileSync wrapper:', error.message);
    try {
      return originalReadFileSync.call(this, filePath, ...args);
    } catch (originalError) {
      console.error('[FILE_OP] ❌ Original fs.readFileSync also failed:', originalError.message);
      throw originalError; // readFileSync failures should propagate
    }
  }
};

// Wrap fs.readFile - NEVER THROWS
fs.readFile = function(filePath, ...args) {
  try {
    console.log('\n📁 [FILE_OP] fs.readFile called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const pathString = toPathString(filePath, { label: 'readFile', allowEmpty: false });
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - SKIPPING operation');
      // DO NOT call original with object - trap will catch it
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        return callback(new Error('Invalid file path: expected string, got ' + typeof filePath));
      }
      return Promise.reject(new Error('Invalid file path: expected string, got ' + typeof filePath));
    }
    
    return originalReadFile.call(this, safePath, ...args);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.readFile wrapper:', error.message);
    try {
      return originalReadFile.call(this, filePath, ...args);
    } catch (originalError) {
      console.error('[FILE_OP] ❌ Original fs.readFile also failed:', originalError.message);
      throw originalError; // readFile failures should propagate
    }
  }
};

// Wrap fs.createReadStream - NEVER THROWS
fs.createReadStream = function(filePath, ...args) {
  try {
    // FEATURE FLAG: Only block export-related operations
    const pathString = toPathString(filePath, { label: 'createReadStream', allowEmpty: false });
    const isExportRelated = pathString && (
      pathString.includes('exports') || 
      pathString.includes('user-data') ||
      pathString.includes('archive')
    );
    
    if (isExportRelated && !checkFeature(FEATURES.FILE_UPLOADS, 'fileOperationLogger')) {
      console.warn(`⚠️  [FILE_OP] Blocked fs.createReadStream - FILE_UPLOADS disabled: ${pathString}`);
      // Return a dummy stream that immediately ends
      const { Readable } = require('stream');
      const dummyStream = new Readable();
      dummyStream.push(null); // End immediately
      return dummyStream;
    }

    console.log('\n📁 [FILE_OP] fs.createReadStream called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - SKIPPING operation (trap will catch if original called)');
      // DO NOT call original with object - trap will catch it
      // Return a dummy stream that immediately ends
      const { Readable } = require('stream');
      const dummyStream = new Readable();
      dummyStream.push(null);
      return dummyStream;
    }
    
    return originalCreateReadStream.call(this, safePath, ...args);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.createReadStream wrapper:', error.message);
    try {
      return originalCreateReadStream.call(this, filePath, ...args);
    } catch (originalError) {
      console.error('[FILE_OP] ❌ Original fs.createReadStream also failed:', originalError.message);
      // Return a dummy stream that immediately ends
      const { Readable } = require('stream');
      const dummyStream = new Readable();
      dummyStream.push(null);
      return dummyStream;
    }
  }
};

// Wrap fs.existsSync - NEVER THROWS
fs.existsSync = function(filePath) {
  try {
    // FEATURE FLAG: Only block export-related operations
    const pathString = toPathString(filePath, { label: 'existsSync', allowEmpty: false });
    const isExportRelated = pathString && (
      pathString.includes('exports') || 
      pathString.includes('user-data') ||
      pathString.includes('archive')
    );
    
    if (isExportRelated && !checkFeature(FEATURES.FILE_UPLOADS, 'fileOperationLogger')) {
      console.warn(`⚠️  [FILE_OP] Blocked fs.existsSync - FILE_UPLOADS disabled: ${pathString}`);
      return false; // Return false (file doesn't exist) instead of throwing
    }

    console.log('\n📁 [FILE_OP] fs.existsSync called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - returning false (best-effort)');
      return false; // Safe fallback
    }
    
    return originalExistsSync.call(this, safePath);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.existsSync wrapper:', error.message);
    return false; // Safe fallback - assume file doesn't exist
  }
};

// Wrap fs.writeFileSync - NEVER THROWS
fs.writeFileSync = function(filePath, ...args) {
  try {
    console.log('\n📁 [FILE_OP] fs.writeFileSync called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const pathString = toPathString(filePath, { label: 'writeFileSync', allowEmpty: false });
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - SKIPPING operation (trap will catch if original called)');
      // DO NOT call original with object - trap will catch it
      // Return silently to prevent crash
      return;
    }
    
    return originalWriteFileSync.call(this, safePath, ...args);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.writeFileSync wrapper:', error.message);
    try {
      return originalWriteFileSync.call(this, filePath, ...args);
    } catch (originalError) {
      console.error('[FILE_OP] ❌ Original fs.writeFileSync also failed:', originalError.message);
      // Don't throw - write failures should be logged but not crash
      return;
    }
  }
};

// Wrap fs.writeFile - NEVER THROWS
fs.writeFile = function(filePath, ...args) {
  try {
    console.log('\n📁 [FILE_OP] fs.writeFile called');
    console.log('  filePath:', filePath);
    console.log('  filePath type:', typeof filePath);
    
    const pathString = toPathString(filePath, { label: 'writeFile', allowEmpty: false });
    const safePath = pathString || (filePath && typeof filePath === 'string' ? filePath : null);
    
    if (!safePath) {
      console.warn('[FILE_OP] ⚠️  Invalid path arg (type=' + typeof filePath + ') - calling original function anyway (best-effort)');
      return originalWriteFile.call(this, filePath, ...args);
    }
    
    return originalWriteFile.call(this, safePath, ...args);
  } catch (error) {
    console.error('[FILE_OP] ❌ Error in fs.writeFile wrapper:', error.message);
    try {
      return originalWriteFile.call(this, filePath, ...args);
    } catch (originalError) {
      console.error('[FILE_OP] ❌ Original fs.writeFile also failed:', originalError.message);
      // If there's a callback, call it with error
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(originalError);
      }
      return;
    }
  }
};

console.log('✅ [fileOperationLogger] File operation logging enabled (non-throwing mode)');
