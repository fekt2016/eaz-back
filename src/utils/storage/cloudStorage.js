const fs = require('fs');
const path = require('path');
const { toPathString, safeFs } = require('../safePath');
const { checkFeature, FEATURES } = require('../featureFlags');

// Helper to check if request is from mobile app
// Can't import mobileAppGuard here (circular dependency risk), so inline the check
const isMobileApp = (req) => {
  return req && (
    req.headers['x-client-app'] === 'Saysay' || 
    req.headers['x-mobile'] === 'true' ||
    req.clientApp === 'Saysay'
  );
};

/**
 * Upload file to Cloudinary cloud storage
 * 
 * @param {String} filePath - File path string (MUST be a string, not an object)
 * @param {String} fileName - File name for public_id
 * @param {Object} cloudinary - Cloudinary instance
 * @param {Object} req - Express request object (optional, for mobile detection)
 * @returns {Promise<String>} Authenticated download URL
 * @throws {Error} If file path is invalid or upload fails
 */
exports.uploadToCloudStorage = async (filePath, fileName, cloudinary, req = null) => {
  // 🛡️ MOBILE GUARD: Suspend for mobile app during debugging
  // Check both req object and global context (for background jobs)
  const isMobile = (req && isMobileApp(req)) || 
                   (typeof global !== 'undefined' && global.lastMobileRequest && global.lastMobileRequest.app === 'Saysay');
  
  if (isMobile) {
    console.warn('⚠️  [uploadToCloudStorage] Blocked for mobile app (Saysay) - temporarily disabled for debugging');
    if (typeof global !== 'undefined' && global.lastMobileRequest) {
      console.warn('  📱 Last mobile request:', global.lastMobileRequest.screen, global.lastMobileRequest.route);
    }
    throw new Error('File uploads temporarily disabled for mobile app during debugging');
  }

  // FEATURE FLAG: Check if file uploads are enabled
  if (!checkFeature(FEATURES.FILE_UPLOADS, 'uploadToCloudStorage')) {
    throw new Error('File uploads feature is disabled');
  }
  // 🔍 DEBUG: Log what we received
  console.log('[uploadToCloudStorage] DEBUG - Function called:');
  console.log('  filePath:', filePath, '(type:', typeof filePath, ')');
  console.log('  fileName:', fileName, '(type:', typeof fileName, ')');
  if (filePath && typeof filePath === 'object') {
    console.log('  filePath is object with keys:', Object.keys(filePath));
    console.log('  filePath.path:', filePath.path, '(type:', typeof filePath.path, ')');
  }

  // USE safePath.toPathString to handle both strings and objects - NEVER CRASHES
  const resolvedPath = toPathString(filePath, { label: 'cloud storage upload', allowEmpty: false });
  
  if (!resolvedPath) {
    console.error('[uploadToCloudStorage] ❌ Invalid file path:', {
      type: typeof filePath,
      hasPath: filePath && typeof filePath === 'object' && 'path' in filePath,
      hasFilePath: filePath && typeof filePath === 'object' && 'filePath' in filePath,
    });
    throw new Error(
      `Invalid file path for cloud storage upload: expected string or object with .path property, got ${typeof filePath}`
    );
  }

  console.log('[uploadToCloudStorage] ✅ Resolved path:', resolvedPath, '(type:', typeof resolvedPath, ')');

  // Validate file exists before upload - USE SAFE VERSION
  if (!safeFs.existsSyncSafe(resolvedPath, { label: 'cloud storage upload' })) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  try {
    // 🔍 DEBUG: Log before cloudinary.uploader.upload
    console.log('[uploadToCloudStorage] DEBUG - Before cloudinary.uploader.upload:');
    console.log('  resolvedPath:', resolvedPath, '(type:', typeof resolvedPath, ')');
    console.log('  resolvedPath is string?', typeof resolvedPath === 'string');
    console.log('  resolvedPath value:', JSON.stringify(resolvedPath));
    
    // Upload to Cloudinary - USE resolvedPath (guaranteed to be string via toPathString)
    // Final validation: ensure it's a string before Cloudinary call
    if (typeof resolvedPath !== 'string') {
      throw new Error(
        `Invalid resolved path type: expected string, got ${typeof resolvedPath}. ` +
        `This should never happen if toPathString worked correctly.`
      );
    }
    
    console.log('[uploadToCloudStorage] 📤 Uploading to Cloudinary:', {
      pathType: typeof resolvedPath,
      pathLength: resolvedPath.length,
      fileName: fileName,
    });
    
    const result = await cloudinary.uploader.upload(resolvedPath, {
      resource_type: 'raw',
      public_id: `user-exports/${path.parse(fileName).name}`,
      overwrite: false,
      type: 'authenticated',
      tags: ['user-data-export'],
    });

    // Delete local file after upload (safe cleanup) - USE SAFE VERSION (never crashes)
    safeFs.unlinkSyncSafe(resolvedPath, { label: 'cloud storage cleanup' });
    console.log('[uploadToCloudStorage] ✅ Temp file cleanup attempted:', resolvedPath);

    // Generate authenticated URL with expiration (24 hours)
    const downloadUrl = cloudinary.url(result.public_id, {
      resource_type: 'raw',
      secure: true,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      type: 'authenticated',
    });

    return downloadUrl;
  } catch (error) {
    // Enhanced error logging for ERR_INVALID_ARG_TYPE
    if (error.message && error.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('\n🚨 ERR_INVALID_ARG_TYPE DETECTED IN uploadToCloudStorage - FULL STACK TRACE:');
      console.error('================================================');
      console.error('Error Message:', error.message);
      console.error('Error Name:', error.name);
      console.error('Error Code:', error.code);
      console.error('\nFull Stack Trace:');
      console.error(error.stack);
      console.error('\nFunction Arguments:');
      console.error('  filePath:', filePath, '(type:', typeof filePath, ')');
      console.error('  fileName:', fileName);
      console.error('================================================\n');
    } else {
      console.error('Cloudinary upload error:', error);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
    throw new Error(`Failed to upload to cloud storage: ${error.message}`);
  }
};
