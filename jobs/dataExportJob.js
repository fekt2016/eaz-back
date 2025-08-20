const User = require('../Models/userModel');
const Permission = require('../Models/permissionModel');
const { generateUserDataArchive } = require('../utils/generateDataExport');
const { uploadToCloudStorage } = require('../utils/cloudStorage');
const { sendDataReadyEmail } = require('../utils/emailService');
const mongoose = require('mongoose');

// Modified to accept cloudinary as a parameter
exports.processDataExportJob = async (job, cloudinary) => {
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
    const { filePath, fileName } = await generateUserDataArchive(userData);

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
    console.error('Export job failed:', error);

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
