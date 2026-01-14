/**
 * Script to add default variants to products that don't have any variants
 * 
 * This script:
 * 1. Finds all products with no variants (empty array or missing)
 * 2. Creates a default variant for each product with stock
 * 3. Generates a unique SKU for each variant
 * 
 * Configuration:
 * - DEFAULT_STOCK: Default stock value for variants when product has no stock info (default: 10)
 * 
 * Usage: node backend/src/scripts/addVariantsToProducts.js
 */

// Configuration
const DEFAULT_STOCK = 10; // Default stock value for variants when product has no stock information

// Load environment variables
const path = require('path');
const dotenv = require('dotenv');

// Try multiple paths for .env file
const envPath = path.join(__dirname, '../../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('⚠️  Warning: Could not load .env file:', result.error.message);
  console.log(`   Attempted path: ${envPath}`);
}

const mongoose = require('mongoose');
const Product = require('../models/product/productModel');
const connectDatabase = require('../config/database');

// Use the database config module for connection
async function connectToDatabase() {
  try {
    await connectDatabase();
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    // Fallback: try direct connection
    try {
      let mongodb;
      if (process.env.MONGO_URL) {
        mongodb = process.env.MONGO_URL.replace(
          '<PASSWORD>',
          process.env.DATABASE_PASSWORD || ''
        );
      } else if (process.env.MONGODB_URI) {
        mongodb = process.env.MONGODB_URI;
      } else if (process.env.DATABASE) {
        mongodb = process.env.DATABASE;
      } else {
        throw new Error('No MongoDB connection string found in environment variables');
      }

      await mongoose.connect(mongodb, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('✅ Connected to MongoDB (fallback method)');
      return true;
    } catch (fallbackError) {
      console.error('❌ Fallback connection also failed:', fallbackError.message);
      throw fallbackError;
    }
  }
}

/**
 * Generate SKU for a variant
 * Format: {sellerId}-{category}-DEF-{timestamp}
 */
function generateSKU(product) {
  try {
    // Get seller ID (last 3 chars)
    // Handle both populated (object) and unpopulated (ObjectId) seller
    let sellerId = 'UNK';
    if (product.seller) {
      if (product.seller._id) {
        sellerId = product.seller._id.toString().slice(-3).toUpperCase();
      } else if (typeof product.seller === 'object' && product.seller.toString) {
        sellerId = product.seller.toString().slice(-3).toUpperCase();
      } else if (typeof product.seller === 'string') {
        sellerId = product.seller.slice(-3).toUpperCase();
      }
    }
    
    // Get category name
    // Handle both populated (object) and unpopulated (ObjectId) categories
    let categoryName = 'GENERAL';
    if (product.subCategory) {
      categoryName = product.subCategory.name || 
                     (typeof product.subCategory === 'string' ? 'GENERAL' : 'GENERAL');
    } else if (product.parentCategory) {
      categoryName = product.parentCategory.name || 
                     (typeof product.parentCategory === 'string' ? 'GENERAL' : 'GENERAL');
    }
    const categoryPrefix = categoryName.slice(0, 3).toUpperCase();
    
    // Default variant string for products without variants
    const variantString = 'DEF';
    
    // Timestamp suffix (last 4 digits)
    const timestamp = Date.now().toString().slice(-4);
    
    // Generate SKU: {sellerId}-{category}-DEF-{timestamp}
    return `${sellerId}-${categoryPrefix}-${variantString}-${timestamp}`;
  } catch (error) {
    console.error('Error generating SKU:', error);
    // Fallback SKU
    return `SKU-${Date.now()}`;
  }
}

/**
 * Create a default variant for a product
 */
function createDefaultVariant(product) {
  const sku = generateSKU(product);
  const timestamp = new Date();
  
  // Use product price or default to 0
  const variantPrice = product.price || 0;
  
  // Determine stock value:
  // 1. Use product.stock if it exists and is a valid number
  // 2. Use totalStock (virtual) if available
  // 3. Calculate from existing variants if any
  // 4. Default to DEFAULT_STOCK if none of the above
  let variantStock = DEFAULT_STOCK; // Default stock value
  
  if (product.stock !== undefined && product.stock !== null && !isNaN(product.stock)) {
    variantStock = Math.max(0, parseInt(product.stock));
  } else if (product.totalStock !== undefined && product.totalStock !== null && !isNaN(product.totalStock)) {
    variantStock = Math.max(0, parseInt(product.totalStock));
  } else if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
    // Sum stock from existing variants
    const totalVariantStock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
    variantStock = Math.max(10, totalVariantStock); // At least 10, or sum of existing variants
  }
  
  // Create default variant
  const variant = {
    name: product.name || 'Default Variant',
    attributes: [],
    price: variantPrice,
    originalPrice: variantPrice,
    discount: 0,
    stock: variantStock,
    sku: sku.toUpperCase(),
    status: 'active',
    description: product.shortDescription || product.description || '',
    images: product.images && product.images.length > 0 ? [product.images[0]] : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  
  return variant;
}

/**
 * Main function to add variants to products
 */
async function addVariantsToProducts() {
  try {
    await connectToDatabase();
    
    console.log('\n🔍 Finding products without variants...\n');
    
    // Find all products that have no variants
    // This includes products where variants array is empty or doesn't exist
    const productsWithoutVariants = await Product.find({
      $or: [
        { variants: { $exists: false } },
        { variants: { $eq: [] } },
        { variants: { $size: 0 } }
      ]
    })
      .populate('seller', '_id')
      .populate('parentCategory', 'name')
      .populate('subCategory', 'name');
    
    console.log(`📦 Found ${productsWithoutVariants.length} products without variants\n`);
    
    if (productsWithoutVariants.length === 0) {
      console.log('✅ All products already have variants. Nothing to do.');
      await mongoose.connection.close();
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Process each product
    for (let i = 0; i < productsWithoutVariants.length; i++) {
      const product = productsWithoutVariants[i];
      
      try {
        console.log(`[${i + 1}/${productsWithoutVariants.length}] Processing: ${product.name} (ID: ${product._id})`);
        
        // Create default variant
        const variant = createDefaultVariant(product);
        
        // Add variant to product
        if (!product.variants) {
          product.variants = [];
        }
        product.variants.push(variant);
        
        // Update product minPrice and maxPrice if needed
        if (product.variants.length > 0) {
          const prices = product.variants.map(v => v.price).filter(p => p !== undefined && p !== null);
          if (prices.length > 0) {
            product.minPrice = Math.min(...prices);
            product.maxPrice = Math.max(...prices);
          }
        }
        
        // Save product
        await product.save();
        
        console.log(`  ✅ Added variant with SKU: ${variant.sku}`);
        console.log(`     Price: ${variant.price}, Stock: ${variant.stock}\n`);
        
        successCount++;
      } catch (error) {
        console.error(`  ❌ Error processing product ${product._id}:`, error.message);
        errors.push({
          productId: product._id,
          productName: product.name,
          error: error.message
        });
        errorCount++;
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully processed: ${successCount} products`);
    console.log(`❌ Errors: ${errorCount} products`);
    console.log(`📦 Total products: ${productsWithoutVariants.length}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach((err, index) => {
        console.log(`  ${index + 1}. Product: ${err.productName} (${err.productId})`);
        console.log(`     Error: ${err.error}`);
      });
    }
    
    console.log('\n✅ Script completed successfully!\n');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  addVariantsToProducts();
}

module.exports = { addVariantsToProducts };

