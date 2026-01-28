/**
 * Script to fix isVisible for all approved products
 * Run this script to update existing approved products that might have incorrect isVisible values
 * 
 * Usage: node backend/src/scripts/fixApprovedProductsVisibility.js
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Product = require('../models/product/productModel');
const Seller = require('../models/user/sellerModel');

const fixApprovedProductsVisibility = async () => {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.DATABASE;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI or DATABASE not found in environment variables');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get all approved products
    const approvedProducts = await Product.find({ 
      moderationStatus: 'approved',
      status: { $in: ['active', 'out_of_stock'] }
    }).select('_id name seller status moderationStatus isVisible');

    console.log(`\n📦 Found ${approvedProducts.length} approved products`);

    if (approvedProducts.length === 0) {
      console.log('✅ No approved products to fix');
      await mongoose.disconnect();
      return;
    }

    // Group products by seller
    const productsBySeller = {};
    for (const product of approvedProducts) {
      const sellerId = product.seller.toString();
      if (!productsBySeller[sellerId]) {
        productsBySeller[sellerId] = [];
      }
      productsBySeller[sellerId].push(product);
    }

    console.log(`👥 Found ${Object.keys(productsBySeller).length} unique sellers\n`);

    let totalUpdated = 0;
    let totalChecked = 0;

    // Update visibility for each seller's products
    for (const [sellerId, products] of Object.entries(productsBySeller)) {
      try {
        const seller = await Seller.findById(sellerId).select('verificationStatus shopName');
        if (!seller) {
          console.warn(`⚠️  Seller ${sellerId} not found, skipping ${products.length} products`);
          continue;
        }

        const sellerName = seller.shopName || sellerId;

        console.log(`\n🏪 Processing seller: ${sellerName}`);
        console.log(`   Products: ${products.length}`);

        // Update each product's visibility
        // NOTE: Seller verification is NOT required - approved products are visible regardless
        for (const product of products) {
          totalChecked++;
          const shouldBeVisible = 
            (product.status === 'active' || product.status === 'out_of_stock') &&
            product.moderationStatus === 'approved';

          if (product.isVisible !== shouldBeVisible) {
            await Product.findByIdAndUpdate(
              product._id,
              { isVisible: shouldBeVisible },
              { runValidators: false }
            );
            totalUpdated++;
            console.log(`   ✅ Updated: ${product.name.substring(0, 40)}... (isVisible: ${product.isVisible} → ${shouldBeVisible})`);
          } else {
            console.log(`   ✓ OK: ${product.name.substring(0, 40)}... (isVisible: ${product.isVisible})`);
          }
        }
      } catch (error) {
        console.error(`❌ Error updating products for seller ${sellerId}:`, error.message);
        // Continue with other sellers
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   Total approved products checked: ${totalChecked}`);
    console.log(`   Products updated: ${totalUpdated}`);
    console.log(`   Products already correct: ${totalChecked - totalUpdated}`);

    // Final check: Count how many products should be visible now
    const visibleProducts = await Product.countDocuments({
      moderationStatus: 'approved',
      status: { $in: ['active', 'out_of_stock'] },
      isVisible: true,
      isDeleted: { $ne: true },
      isDeletedByAdmin: { $ne: true },
      isDeletedBySeller: { $ne: true },
    });

    console.log(`\n✅ Total visible approved products: ${visibleProducts}`);

    await mongoose.disconnect();
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Script error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Run the script
fixApprovedProductsVisibility();
