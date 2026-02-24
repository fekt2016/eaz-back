require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDatabase = require('../config/database');
const Category = require('../models/category/categoryModel');

(async () => {
  try {
    // Connect to the NEW database defined by MONGO_URL in .env
    await connectDatabase();

    const filePath = path.join(__dirname, '../../categories-raw.json');
    if (!fs.existsSync(filePath)) {
      console.error(`❌ categories-raw.json not found at ${filePath}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const docs = JSON.parse(raw);

    if (!Array.isArray(docs) || docs.length === 0) {
      console.error('❌ No categories found in categories-raw.json');
      process.exit(1);
    }

    console.log(
      `⚠️ This will DELETE all existing categories and import ${docs.length} from categories-raw.json`,
    );

    // 1) Clear existing categories in the new DB
    await Category.deleteMany({});

    // 2) Insert exported ones
    // Ensure _id is kept as ObjectId
    const prepared = docs.map((doc) => {
      const clone = { ...doc };
      if (clone._id && typeof clone._id === 'string') {
        clone._id = new mongoose.Types.ObjectId(clone._id);
      }
      if (clone.parentCategory && typeof clone.parentCategory === 'string') {
        clone.parentCategory = new mongoose.Types.ObjectId(
          clone.parentCategory,
        );
      }
      if (Array.isArray(clone.subcategories)) {
        clone.subcategories = clone.subcategories.map((id) =>
          typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id,
        );
      }
      return clone;
    });

    await Category.insertMany(prepared, { ordered: false });

    console.log(
      `✅ Imported ${prepared.length} categories into the current database.`,
    );
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to import categories:', err.message || err);
    process.exit(1);
  }
})();

