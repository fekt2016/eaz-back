const cron = require('node-cron');
const { cloudinary } = require('../config/cloudinary');
const Product = require('../models/product/productModel');

const startOrphanedImageCleanup = () => {
  cron.schedule('0 2 * * *', async () => {
    console.log('[CleanupJob] Starting orphaned image cleanup...');
    try {
      const folderPrefix = process.env.CLOUDINARY_FOLDER
        ? `${process.env.CLOUDINARY_FOLDER}/products`
        : 'saiisai/products';

      const { resources = [] } = await cloudinary.api.resources({
        type: 'upload',
        prefix: folderPrefix,
        max_results: 500,
      });

      for (const resource of resources) {
        const publicId = resource.public_id;
        const exists = await Product.exists({ 'images.publicId': publicId });
        if (exists) continue;

        const createdAt = new Date(resource.created_at);
        const ageHours = (Date.now() - createdAt.getTime()) / 3600000;
        if (ageHours > 24) {
          await cloudinary.uploader.destroy(publicId);
          console.log(`[CleanupJob] Deleted orphan: ${publicId}`);
        }
      }
      console.log('[CleanupJob] Cleanup complete.');
    } catch (error) {
      console.error('[CleanupJob] Error:', error?.message);
    }
  });
};

module.exports = {
  startOrphanedImageCleanup,
};
