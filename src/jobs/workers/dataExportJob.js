const User = require('../../models/user/userModel');
const Permission = require('../../models/user/permissionModel');
const { generateUserDataArchive } = require('../../utils/helpers/generateDataExport');
const { uploadToCloudStorage } = require('../../utils/storage/cloudStorage');
const { sendDataReadyEmail } = require('../../utils/email/emailService');
const { checkFeature, FEATURES } = require('../../utils/featureFlags');
const { toPathString } = require('../../utils/safePath');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

// Modified to accept cloudinary as a parameter
exports.processDataExportJob = async (job, cloudinary) => {
  // FEATURE FLAG: Check if data export is enabled
  if (!checkFeature(FEATURES.DATA_EXPORT, 'DataExportJob')) {
    const { userId, exportId } = job.data;
    console.warn(`[DataExportJob] Feature disabled. Marking export ${exportId} as failed for user ${userId}`);
    
    // Mark export as failed gracefully
    if (userId && exportId) {
      try {
        await User.updateOne(
          { _id: userId, 'dataExports.exportId': exportId },
          { $set: { 'dataExports.$.status': 'failed' } },
        );
      } catch (updateError) {
        console.error('[DataExportJob] Error updating export status:', updateError.message);
      }
    }
    
    // Return success to prevent job retry, but log that feature is disabled
    return { 
      success: false, 
      reason: 'Feature disabled',
      message: 'Data export feature is temporarily unavailable' 
    };
  }

  const { userId, exportId, email } = job.data;

  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // Find the specific export entry
    const exportEntry = user.dataExports.find(
      (e) => e.exportId && e.exportId.toString() === exportId.toString(),
    );

    if (!exportEntry) throw new Error('Export entry not found');

    // Update status to processing
    exportEntry.status = 'processing';
    await user.save();

    // 1. Gather user data
    const userData = {
      profile: user.toObject(),
      permissions: await Permission.findOne({ user: userId }).lean(),
      // Add other data collections as needed
    };

    // 2. Create archive
    const archiveResult = await generateUserDataArchive(userData);
    
    // 🔍 DEBUG: Log archive result
    console.log('[dataExportJob] DEBUG - Archive result:', {
      type: typeof archiveResult,
      hasFilePath: archiveResult && 'filePath' in archiveResult,
      hasFileName: archiveResult && 'fileName' in archiveResult,
    });

    // SAFE PATH EXTRACTION: Use toPathString to handle object or string
    const filePath = toPathString(archiveResult?.filePath || archiveResult, { 
      label: 'data export archive',
      allowEmpty: false 
    });
    const fileName = archiveResult?.fileName || 'user-data-export.zip';

    if (!filePath) {
      throw new Error(
        `Invalid filePath from generateUserDataArchive: could not extract string path. ` +
        `Received: ${typeof archiveResult} with keys: ${archiveResult ? Object.keys(archiveResult).join(', ') : 'null'}`
      );
    }

    console.log('[dataExportJob] ✅ Extracted paths:', {
      filePath: filePath.substring(0, 50) + '...',
      filePathType: typeof filePath,
      fileName: fileName,
      fileNameType: typeof fileName,
    });

    // 3. Upload to cloud storage (passing cloudinary instance)
    const downloadUrl = await uploadToCloudStorage(
      filePath,
      fileName,
      cloudinary,
    );

    // 4. Set expiration (24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 5. Update export entry
    exportEntry.status = 'completed';
    exportEntry.downloadUrl = downloadUrl;
    exportEntry.expiresAt = expiresAt;
    exportEntry.completedAt = new Date();
    await user.save();

    // 6. Send email notification
    await sendDataReadyEmail(email, downloadUrl, expiresAt);

    return { success: true };
  } catch (error) {
<<<<<<< HEAD
    // Enhanced error logging for ERR_INVALID_ARG_TYPE
    if (error.message && error.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('\n🚨 ERR_INVALID_ARG_TYPE DETECTED IN DATA EXPORT JOB - FULL STACK TRACE:');
      console.error('================================================');
      console.error('Error Message:', error.message);
      console.error('Error Name:', error.name);
      console.error('Error Code:', error.code);
      console.error('\nFull Stack Trace:');
      console.error(error.stack);
      console.error('\nJob Data:', JSON.stringify(job.data, null, 2));
      console.error('================================================\n');
    } else {
      console.error('Export job failed:', error);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
=======
    logger.error('Export job failed:', error);
>>>>>>> 6d2bc77 (first ci/cd push)

    // Update status to failed
    if (userId) {
      await User.updateOne(
        { _id: userId, 'dataExports.exportId': exportId },
        { $set: { 'dataExports.$.status': 'failed' } },
      );
    }

    throw error;
  }
};
