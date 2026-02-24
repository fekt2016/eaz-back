require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const connectDatabase = require('../config/database');
const Category = require('../models/category/categoryModel');

(async () => {
  try {
    // Connect using the same logic as the main app (MONGO_URL + DATABASE_PASSWORD)
    await connectDatabase();

    // Fetch all categories (including parent/subcategory info)
    const categories = await Category.find({})
      .populate('parentCategory', 'name slug _id')
      .sort({ name: 1 })
      .lean();

    // 1) Raw export (full documents, including image URL and attributes)
    const rawOutPath = path.join(__dirname, '../../categories-raw.json');
    fs.writeFileSync(rawOutPath, JSON.stringify(categories, null, 2), 'utf8');

    // 2) Simplified export (id, name, slug, image, parent) – handy for other tools
    const simplified = categories.map((cat) => ({
      id: cat._id,
      name: cat.name,
      slug: cat.slug,
      image: cat.image,
      parent: cat.parentCategory
        ? {
            id: cat.parentCategory._id,
            name: cat.parentCategory.name,
            slug: cat.parentCategory.slug,
          }
        : null,
    }));
    const simplifiedOutPath = path.join(
      __dirname,
      '../../categories-with-images.json',
    );
    fs.writeFileSync(
      simplifiedOutPath,
      JSON.stringify(simplified, null, 2),
      'utf8',
    );

    console.log(
      `✅ Exported ${categories.length} categories to:`,
    );
    console.log(`   - Raw:        ${rawOutPath}`);
    console.log(`   - Simplified: ${simplifiedOutPath}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to export categories:', err.message || err);
    process.exit(1);
  }
})();

