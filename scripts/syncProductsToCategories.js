/**
 * Script to sync all products to their respective categories
 * This ensures every product is properly added to its category's products array
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import models
const Product = require('../src/models/product/productModel');
const Category = require('../src/models/category/categoryModel');

const syncProductsToCategories = async () => {
  try {
    // Connect to MongoDB
    const DB = process.env.DATABASE.replace(
      '<PASSWORD>',
      process.env.DATABASE_PASSWORD
    );

    await mongoose.connect(DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');
    console.log('🔄 Starting product-category sync...\n');

    // Get all products
    const products = await Product.find({}).select('_id parentCategory subCategory name');
    
    console.log(`📦 Found ${products.length} products to sync\n`);

    // Track statistics
    let syncedCount = 0;
    let errorCount = 0;
    const categoryUpdates = {};

    // Process each product
    for (const product of products) {
      try {
        const updates = [];

        // Add to subCategory if exists
        if (product.subCategory) {
          const subCategoryId = product.subCategory.toString();
          if (!categoryUpdates[subCategoryId]) {
            categoryUpdates[subCategoryId] = [];
          }
          categoryUpdates[subCategoryId].push(product._id);
          updates.push(`subCategory: ${subCategoryId}`);
        }

        // Add to parentCategory if exists
        if (product.parentCategory) {
          const parentCategoryId = product.parentCategory.toString();
          if (!categoryUpdates[parentCategoryId]) {
            categoryUpdates[parentCategoryId] = [];
          }
          categoryUpdates[parentCategoryId].push(product._id);
          updates.push(`parentCategory: ${parentCategoryId}`);
        }

        if (updates.length > 0) {
          syncedCount++;
          console.log(`✅ Product "${product.name}" (${product._id}) → ${updates.join(', ')}`);
        } else {
          console.log(`⚠️  Product "${product.name}" (${product._id}) has no categories`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing product ${product._id}:`, error.message);
      }
    }

    console.log('\n📊 Updating categories...\n');

    // Update each category with its products
    for (const [categoryId, productIds] of Object.entries(categoryUpdates)) {
      try {
        const category = await Category.findById(categoryId);
        if (!category) {
          console.log(`⚠️  Category ${categoryId} not found, skipping...`);
          continue;
        }

        // Use $addToSet to add products without duplicates
        await Category.findByIdAndUpdate(
          categoryId,
          { $addToSet: { products: { $each: productIds } } },
          { new: true }
        );

        console.log(`✅ Category "${category.name}" (${categoryId}) → Added ${productIds.length} products`);
      } catch (error) {
        errorCount++;
        console.error(`❌ Error updating category ${categoryId}:`, error.message);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📈 SYNC SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Products processed: ${syncedCount}`);
    console.log(`📦 Categories updated: ${Object.keys(categoryUpdates).length}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('='.repeat(50));

    // Close connection
    await mongoose.connection.close();
    console.log('\n✅ Sync completed! Database connection closed.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run the script
if (require.main === module) {
  syncProductsToCategories();
}

module.exports = syncProductsToCategories;

