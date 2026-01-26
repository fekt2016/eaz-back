const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });
const Product = require('../src/models/product/productModel');

const EAZSHOP_SELLER_ID = '000000000000000000000001';

async function checkDeletedEazShopProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.DATABASE);
    console.log('Connected to MongoDB');

    // Find all EazShop products
    const allEazShopProducts = await Product.find({
      $or: [
        { isEazShopProduct: true },
        { seller: EAZSHOP_SELLER_ID },
      ],
    }).select('_id name status isDeleted isDeletedByAdmin isDeletedBySeller deletedAt');

    console.log(`\nTotal EazShop products found: ${allEazShopProducts.length}\n`);

    // Check deleted products
    const deletedProducts = allEazShopProducts.filter(p => 
      p.isDeleted === true || 
      p.isDeletedByAdmin === true || 
      p.isDeletedBySeller === true ||
      p.status === 'archived'
    );

    console.log(`Deleted/Archived EazShop products: ${deletedProducts.length}`);
    if (deletedProducts.length > 0) {
      console.log('\nDeleted Products:');
      deletedProducts.forEach(p => {
        console.log(`  - ${p.name} (${p._id})`);
        console.log(`    Status: ${p.status}`);
        console.log(`    isDeleted: ${p.isDeleted}`);
        console.log(`    isDeletedByAdmin: ${p.isDeletedByAdmin}`);
        console.log(`    isDeletedBySeller: ${p.isDeletedBySeller}`);
        console.log(`    deletedAt: ${p.deletedAt || 'N/A'}`);
        console.log('');
      });
    }

    // Check active products that should be visible
    const activeProducts = allEazShopProducts.filter(p => 
      p.status === 'active' &&
      p.isDeleted !== true &&
      p.isDeletedByAdmin !== true &&
      p.isDeletedBySeller !== true
    );

    console.log(`\nActive (visible) EazShop products: ${activeProducts.length}`);
    if (activeProducts.length > 0) {
      console.log('\nActive Products:');
      activeProducts.forEach(p => {
        console.log(`  - ${p.name} (${p._id})`);
      });
    }

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDeletedEazShopProducts();
