const mongoose = require('mongoose');
const Product = require('../models/product/productModel');
const { configureCloudinary } = require('../config/cloudinary');

const extractPublicIdFromCloudinaryUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const parts = url.split('/');
    const uploadIndex = parts.findIndex((part) => part === 'upload');
    if (uploadIndex === -1) return null;

    const afterUpload = parts.slice(uploadIndex + 1);
    const versionIndex = afterUpload.findIndex((part) => /^v\d+$/.test(part));
    const publicParts =
      versionIndex >= 0 ? afterUpload.slice(versionIndex + 1) : afterUpload;

    const publicPath = publicParts.join('/');
    return publicPath.replace(/\.[^.]+$/, '');
  } catch (error) {
    return null;
  }
};

async function migrate() {
  const mongoUri = process.env.MONGODB_URI || process.env.DATABASE;
  if (!mongoUri) {
    throw new Error('MONGODB_URI or DATABASE env is required');
  }

  configureCloudinary();
  await mongoose.connect(mongoUri);
  console.log('Connected. Starting migration...');

  const products = await Product.find({
    images: { $elemMatch: { $type: 'string' } },
  });

  console.log(`Found ${products.length} products to migrate`);

  for (const product of products) {
    const migratedImages = (product.images || []).map((img, index) => {
      if (typeof img !== 'string') return img;

      const publicId =
        extractPublicIdFromCloudinaryUrl(img) ||
        `legacy_${product._id}_${index}_${Date.now()}`;

      return {
        url: img,
        thumbnail: img,
        medium: img,
        large: img,
        publicId,
        blurhash: null,
        position: index,
        alt: product.name || '',
        format: 'jpg',
      };
    });

    product.images = migratedImages;
    product.coverImage =
      migratedImages[0]?.thumbnail || migratedImages[0]?.url || null;
    await product.save();
    console.log(`Migrated: ${product._id} (${product.name})`);
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
