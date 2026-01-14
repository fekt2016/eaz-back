/**
 * Diagnostic Script: Check for products showing "out of stock" when they have stock
 * 
 * This script identifies:
 * 1. Products with status='out_of_stock' but have variants with stock > 0
 * 2. Products with inactive variants that have stock > 0
 * 3. Products where total stock calculation doesn't match variant stock sum
 * 4. Products with status='out_of_stock' but product.stock > 0
 * 
 * Usage: node backend/src/scripts/checkProductStockIssues.js
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
 * Calculate total stock from variants
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
 * Main diagnostic function
 */
async function checkProductStockIssues() {
  try {
    await connectToDatabase();
    
    console.log('\n🔍 Checking for products with stock issues...\n');
    
    // Find all products
    const allProducts = await Product.find({})
      .populate('seller', '_id name')
      .populate('parentCategory', 'name')
      .populate('subCategory', 'name')
      .lean();
    
    console.log(`📦 Total products in database: ${allProducts.length}\n`);
    
    const issues = {
      outOfStockButHasStock: [],
      inactiveVariantsWithStock: [],
      stockMismatch: [],
      noVariantsButHasStock: [],
    };
    
    // Check each product
    for (const product of allProducts) {
      const productId = product._id.toString();
      const productName = product.name || 'Unnamed Product';
      
      // Calculate actual stock from variants
      const totalVariantStock = calculateTotalStockFromVariants(product);
      const productStock = product.stock || 0;
      const productStatus = product.status || 'active';
      
      // Issue 1: Product status is 'out_of_stock' but has stock
      if (productStatus === 'out_of_stock') {
        if (totalVariantStock > 0 || productStock > 0) {
          issues.outOfStockButHasStock.push({
            productId,
            productName,
            status: productStatus,
            variantStock: totalVariantStock,
            productStock,
            variants: product.variants?.length || 0,
            seller: product.seller?.name || product.seller?._id || 'Unknown',
            category: product.parentCategory?.name || product.subCategory?.name || 'Unknown',
          });
        }
      }
      
      // Issue 2: Inactive variants with stock > 0
      if (product.variants && product.variants.length > 0) {
        const inactiveWithStock = product.variants.filter(
          v => v.status === 'inactive' && (v.stock || 0) > 0
        );
        
        if (inactiveWithStock.length > 0) {
          issues.inactiveVariantsWithStock.push({
            productId,
            productName,
            inactiveVariants: inactiveWithStock.map(v => ({
              sku: v.sku,
              stock: v.stock,
              name: v.name,
            })),
            seller: product.seller?.name || product.seller?._id || 'Unknown',
            category: product.parentCategory?.name || product.subCategory?.name || 'Unknown',
          });
        }
      }
      
      // Issue 3: Stock mismatch (if product has totalStock virtual or stock field)
      if (product.totalStock !== undefined && product.totalStock !== null) {
        if (Math.abs(product.totalStock - totalVariantStock) > 0) {
          issues.stockMismatch.push({
            productId,
            productName,
            totalStockField: product.totalStock,
            calculatedVariantStock: totalVariantStock,
            seller: product.seller?.name || product.seller?._id || 'Unknown',
            category: product.parentCategory?.name || product.subCategory?.name || 'Unknown',
          });
        }
      }
      
      // Issue 4: Product has no variants but has product.stock > 0
      if ((!product.variants || product.variants.length === 0) && productStock > 0) {
        issues.noVariantsButHasStock.push({
          productId,
          productName,
          productStock,
          seller: product.seller?.name || product.seller?._id || 'Unknown',
          category: product.parentCategory?.name || product.subCategory?.name || 'Unknown',
        });
      }
    }
    
    // Print results
    console.log('='.repeat(80));
    console.log('📊 DIAGNOSTIC RESULTS');
    console.log('='.repeat(80));
    
    // Issue 1: Out of stock but has stock
    console.log(`\n1️⃣  Products marked "out_of_stock" but have stock: ${issues.outOfStockButHasStock.length}`);
    if (issues.outOfStockButHasStock.length > 0) {
      console.log('\n   These products need their status updated to "active":\n');
      issues.outOfStockButHasStock.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue.productName} (ID: ${issue.productId})`);
        console.log(`      Status: ${issue.status}`);
        console.log(`      Variant Stock: ${issue.variantStock}`);
        console.log(`      Product Stock: ${issue.productStock}`);
        console.log(`      Variants: ${issue.variants}`);
        console.log(`      Seller: ${issue.seller}`);
        console.log(`      Category: ${issue.category}`);
        console.log('');
      });
    }
    
    // Issue 2: Inactive variants with stock
    console.log(`\n2️⃣  Products with inactive variants that have stock: ${issues.inactiveVariantsWithStock.length}`);
    if (issues.inactiveVariantsWithStock.length > 0) {
      console.log('\n   These variants should be activated or stock should be set to 0:\n');
      issues.inactiveVariantsWithStock.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue.productName} (ID: ${issue.productId})`);
        issue.inactiveVariants.forEach(v => {
          console.log(`      - SKU: ${v.sku}, Stock: ${v.stock}, Name: ${v.name || 'N/A'}`);
        });
        console.log(`      Seller: ${issue.seller}`);
        console.log(`      Category: ${issue.category}`);
        console.log('');
      });
    }
    
    // Issue 3: Stock mismatch
    console.log(`\n3️⃣  Products with stock calculation mismatch: ${issues.stockMismatch.length}`);
    if (issues.stockMismatch.length > 0) {
      console.log('\n   These products have inconsistent stock values:\n');
      issues.stockMismatch.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue.productName} (ID: ${issue.productId})`);
        console.log(`      totalStock field: ${issue.totalStockField}`);
        console.log(`      Calculated from variants: ${issue.calculatedVariantStock}`);
        console.log(`      Seller: ${issue.seller}`);
        console.log(`      Category: ${issue.category}`);
        console.log('');
      });
    }
    
    // Issue 4: No variants but has stock
    console.log(`\n4️⃣  Products without variants but have product.stock > 0: ${issues.noVariantsButHasStock.length}`);
    if (issues.noVariantsButHasStock.length > 0) {
      console.log('\n   These products should have variants created:\n');
      issues.noVariantsButHasStock.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue.productName} (ID: ${issue.productId})`);
        console.log(`      Product Stock: ${issue.productStock}`);
        console.log(`      Seller: ${issue.seller}`);
        console.log(`      Category: ${issue.category}`);
        console.log('');
      });
    }
    
    // Summary
    const totalIssues = 
      issues.outOfStockButHasStock.length +
      issues.inactiveVariantsWithStock.length +
      issues.stockMismatch.length +
      issues.noVariantsButHasStock.length;
    
    console.log('='.repeat(80));
    console.log('📋 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total products checked: ${allProducts.length}`);
    console.log(`Total issues found: ${totalIssues}`);
    console.log(`  - Out of stock but has stock: ${issues.outOfStockButHasStock.length}`);
    console.log(`  - Inactive variants with stock: ${issues.inactiveVariantsWithStock.length}`);
    console.log(`  - Stock calculation mismatch: ${issues.stockMismatch.length}`);
    console.log(`  - No variants but has stock: ${issues.noVariantsButHasStock.length}`);
    
    if (totalIssues === 0) {
      console.log('\n✅ No stock issues found! All products are correctly configured.');
    } else {
      console.log('\n⚠️  Issues found. Consider running a fix script to correct these problems.');
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
  checkProductStockIssues();
}

module.exports = { checkProductStockIssues };

