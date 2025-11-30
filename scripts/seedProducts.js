const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../src/models/product/productModel');
const Category = require('../src/models/category/categoryModel');

// Load environment variables
dotenv.config({ path: './.env' });

// EazShop Seller ID constant
const EAZSHOP_SELLER_ID = new mongoose.Types.ObjectId('000000000000000000000001');

// Load products from JSON file
const productsData = require('./seedProducts.json');

async function seedProducts() {
  try {
    // Connect to database
    let DB;
    if (process.env.DATABASE) {
      DB = process.env.DATABASE.replace(
        '<PASSWORD>',
        process.env.DATABASE_PASSWORD || ''
      );
    } else if (process.env.MONGODB_URI) {
      DB = process.env.MONGODB_URI;
    } else {
      throw new Error(
        'Database connection string not found. Please set DATABASE or MONGODB_URI in .env file.\n' +
        'Make sure your .env file is in the backend directory and contains the DATABASE variable.'
      );
    }

    await mongoose.connect(DB);
    console.log('✅ Database connection successful');

    // Get or create default categories
    // Try to find existing categories, or use placeholder IDs
    let parentCategoryId, subCategoryId;

    // Try to find Electronics category
    let electronicsCategory = await Category.findOne({ 
      name: { $regex: /electronics/i },
      parentCategory: null 
    });

    if (!electronicsCategory) {
      // Try to find any parent category
      electronicsCategory = await Category.findOne({ parentCategory: null });
    }

    if (electronicsCategory) {
      parentCategoryId = electronicsCategory._id;
      
      // Find a subcategory under this parent
      let subCategory = await Category.findOne({ 
        parentCategory: parentCategoryId 
      });
      
      if (subCategory) {
        subCategoryId = subCategory._id;
      } else {
        // Use parent as subcategory if no subcategory exists
        subCategoryId = parentCategoryId;
      }
    } else {
      // If no categories exist, we'll need to create them or use placeholder
      console.log('⚠️  No categories found. Products will need category IDs to be set manually.');
      console.log('   Please ensure categories exist in the database before running this script.');
      process.exit(1);
    }

    console.log(`📦 Using Parent Category: ${parentCategoryId}`);
    console.log(`📦 Using Sub Category: ${subCategoryId}`);

    // Prepare products for insertion
    const productsToInsert = productsData.map((product) => {
      // Set EazShop seller and product flag
      const productData = {
        ...product,
        seller: EAZSHOP_SELLER_ID,
        isEazShopProduct: true,
        parentCategory: parentCategoryId,
        subCategory: subCategoryId,
        status: product.status || 'active',
      };

      // Ensure variants have required fields
      if (productData.variants && productData.variants.length > 0) {
        productData.variants = productData.variants.map((variant, index) => ({
          ...variant,
          sku: variant.sku || `EZS-${Date.now()}-${index}`,
          status: variant.status || 'active',
        }));
      }

      return productData;
    });

    // Delete existing EazShop products (optional - comment out if you want to keep existing)
    const deleteResult = await Product.deleteMany({
      $or: [
        { isEazShopProduct: true },
        { seller: EAZSHOP_SELLER_ID },
      ],
    });
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} existing EazShop products`);

    // Insert products
    const insertedProducts = await Product.insertMany(productsToInsert, {
      ordered: false, // Continue inserting even if one fails
    });

    console.log(`\n✅ Successfully inserted ${insertedProducts.length} EazShop products`);
    console.log('\n📋 Product Summary:');
    insertedProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} - GHS ${product.price}`);
    });

    console.log('\n✅ Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding products:', error);
    
    // If it's a validation error, show more details
    if (error.name === 'ValidationError') {
      console.error('\nValidation Errors:');
      Object.keys(error.errors).forEach((key) => {
        console.error(`   ${key}: ${error.errors[key].message}`);
      });
    }
    
    // If it's a bulk write error, show which products failed
    if (error.name === 'BulkWriteError') {
      console.error('\nBulk Write Errors:');
      error.writeErrors?.forEach((writeError, index) => {
        console.error(`   Product ${index + 1}: ${writeError.errmsg}`);
      });
    }
    
    process.exit(1);
  }
}

// Run the seed function
seedProducts();

