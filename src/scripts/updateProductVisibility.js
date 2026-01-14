/**
 * Migration Script: Update Product Visibility
 * 
 * This script updates the isVisible field for all existing products
 * based on their seller's verification status.
 * 
 * Run this once after deploying the visibility feature:
 * node src/scripts/updateProductVisibility.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const Product = require('../models/product/productModel');
const Seller = require('../models/user/sellerModel');
const { updateSellerProductsVisibility } = require('../utils/helpers/productVisibility');

const updateAllProductsVisibility = async () => {
  try {
    // Connect to database
    const DB = process.env.DATABASE.replace(
      '<PASSWORD>',
      process.env.DATABASE_PASSWORD
    );
    
    await mongoose.connect(DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Database connected');
    
    // Get all sellers
    const sellers = await Seller.find({}).select('_id verificationStatus');
    console.log(`Found ${sellers.length} sellers`);
    
    let totalUpdated = 0;
    
    // Update products for each seller
    for (const seller of sellers) {
      try {
        const result = await updateSellerProductsVisibility(
          seller._id,
          seller.verificationStatus
        );
        totalUpdated += result.updated;
        console.log(`Seller ${seller._id}: ${result.updated}/${result.total} products updated`);
      } catch (error) {
        console.error(`Error updating products for seller ${seller._id}:`, error);
      }
    }
    
    console.log(`\n✅ Migration complete! Updated ${totalUpdated} products`);
    
    // Close connection
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

// Run migration
updateAllProductsVisibility();

