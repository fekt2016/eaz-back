/**
 * Fix Script: Correct product status based on actual stock
 * 
 * This script:
 * 1. Finds products with status='out_of_stock' but have stock > 0
 * 2. Updates their status to 'active'
 * 3. Finds products with status='active' but have 0 stock
 * 4. Updates their status to 'out_of_stock' (if not draft)
 * 5. Activates inactive variants that have stock > 0
 * 
 * Usage: node backend/src/scripts/fixProductStockStatus.js
 */

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
const Seller = require('../models/user/sellerModel');
const Category = require('../models/category/categoryModel');
const connectDatabase = require('../config/database');

// Use the database config module for connection
async function connectToDatabase() {
  try {
    await connectDatabase();
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    throw error;
  }
}

/**
 * Calculate total stock from active variants
 */
function calculateTotalStockFromVariants(product) {
  if (!product.variants || product.variants.length === 0) {
    return 0;
  }
  
  return product.variants.reduce((sum, variant) => {
    // Only count active variants
    if (variant.status === 'inactive') {
      return sum;
    }
    return sum + (variant.stock || 0);
  }, 0);
}

/**
 * Main fix function
 */
async function fixProductStockStatus() {
  try {
    await connectToDatabase();
    
    console.log('\n🔧 Fixing product stock status issues...\n');
    
    // Find all products
    const allProducts = await Product.find({});
    
    console.log(`📦 Total products in database: ${allProducts.length}\n`);
    
    const fixes = {
      outOfStockToActive: [],
      activeToOutOfStock: [],
      activatedVariants: [],
    };
    
    // Process each product
    for (const product of allProducts) {
      const productId = product._id.toString();
      const productName = product.name || 'Unnamed Product';
      const productStatus = product.status || 'active';
      
      // Calculate actual stock from active variants
      const totalVariantStock = calculateTotalStockFromVariants(product);
      const productStock = product.stock || 0;
      const totalStock = totalVariantStock || productStock;
      
      let needsUpdate = false;
      const updates = {};
      
      // Fix 1: Product status is 'out_of_stock' but has stock > 0
      if (productStatus === 'out_of_stock' && totalStock > 0) {
        updates.status = 'active';
        needsUpdate = true;
        fixes.outOfStockToActive.push({
          productId,
          productName,
          oldStatus: productStatus,
          newStatus: 'active',
          stock: totalStock,
        });
      }
      
      // Fix 2: Product status is 'active' but has 0 stock (and not draft)
      if (productStatus === 'active' && totalStock === 0 && productStatus !== 'draft') {
        updates.status = 'out_of_stock';
        needsUpdate = true;
        fixes.activeToOutOfStock.push({
          productId,
          productName,
          oldStatus: productStatus,
          newStatus: 'out_of_stock',
          stock: totalStock,
        });
      }
      
      // Fix 3: Activate inactive variants that have stock > 0
      if (product.variants && product.variants.length > 0) {
        let variantActivated = false;
        product.variants.forEach((variant, index) => {
          if (variant.status === 'inactive' && (variant.stock || 0) > 0) {
            variant.status = 'active';
            variantActivated = true;
            if (!fixes.activatedVariants.find(f => f.productId === productId)) {
              fixes.activatedVariants.push({
                productId,
                productName,
                variants: [],
              });
            }
            const fixEntry = fixes.activatedVariants.find(f => f.productId === productId);
            fixEntry.variants.push({
              sku: variant.sku,
              stock: variant.stock,
              name: variant.name,
            });
          }
        });
        
        if (variantActivated) {
          needsUpdate = true;
        }
      }
      
      // Save updates if needed
      if (needsUpdate) {
        if (Object.keys(updates).length > 0) {
          Object.assign(product, updates);
        }
        await product.save();
      }
    }
    
    // Print results
    console.log('='.repeat(80));
    console.log('🔧 FIX RESULTS');
    console.log('='.repeat(80));
    
    // Fix 1: Out of stock -> Active
    console.log(`\n1️⃣  Products updated from "out_of_stock" to "active": ${fixes.outOfStockToActive.length}`);
    if (fixes.outOfStockToActive.length > 0) {
      fixes.outOfStockToActive.forEach((fix, index) => {
        console.log(`   ${index + 1}. ${fix.productName} (ID: ${fix.productId})`);
        console.log(`      Status: ${fix.oldStatus} → ${fix.newStatus}`);
        console.log(`      Stock: ${fix.stock}`);
      });
    }
    
    // Fix 2: Active -> Out of stock
    console.log(`\n2️⃣  Products updated from "active" to "out_of_stock": ${fixes.activeToOutOfStock.length}`);
    if (fixes.activeToOutOfStock.length > 0) {
      fixes.activeToOutOfStock.forEach((fix, index) => {
        console.log(`   ${index + 1}. ${fix.productName} (ID: ${fix.productId})`);
        console.log(`      Status: ${fix.oldStatus} → ${fix.newStatus}`);
        console.log(`      Stock: ${fix.stock}`);
      });
    }
    
    // Fix 3: Activated variants
    console.log(`\n3️⃣  Products with inactive variants activated: ${fixes.activatedVariants.length}`);
    if (fixes.activatedVariants.length > 0) {
      fixes.activatedVariants.forEach((fix, index) => {
        console.log(`   ${index + 1}. ${fix.productName} (ID: ${fix.productId})`);
        fix.variants.forEach(v => {
          console.log(`      - SKU: ${v.sku}, Stock: ${v.stock}, Name: ${v.name || 'N/A'}`);
        });
      });
    }
    
    // Summary
    const totalFixes = 
      fixes.outOfStockToActive.length +
      fixes.activeToOutOfStock.length +
      fixes.activatedVariants.length;
    
    console.log('\n' + '='.repeat(80));
    console.log('📋 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total products checked: ${allProducts.length}`);
    console.log(`Total fixes applied: ${totalFixes}`);
    console.log(`  - Out of stock → Active: ${fixes.outOfStockToActive.length}`);
    console.log(`  - Active → Out of stock: ${fixes.activeToOutOfStock.length}`);
    console.log(`  - Variants activated: ${fixes.activatedVariants.length}`);
    
    if (totalFixes === 0) {
      console.log('\n✅ No fixes needed! All products have correct status.');
    } else {
      console.log('\n✅ Fixes applied successfully!');
    }
    
    console.log('\n');
    
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
  fixProductStockStatus();
}

module.exports = { fixProductStockStatus };

