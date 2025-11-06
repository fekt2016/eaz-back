const fs = require('fs');
const path = require('path');

exports.uploadToCloudStorage = async (filePath, fileName, cloudinary) => {
  try {
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'raw',
      public_id: `user-exports/${path.parse(fileName).name}`,
      overwrite: false,
      type: 'authenticated',
      tags: ['user-data-export'],
    });

    // Delete local file after upload
    fs.unlinkSync(filePath);

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
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload to cloud storage');
  }
};
