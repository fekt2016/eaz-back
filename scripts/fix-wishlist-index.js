/**
 * Script to fix wishlist index issue
 * This script drops the old non-sparse unique index on 'user' field
 * and lets Mongoose recreate it as a sparse index
 * 
 * Run this once: node scripts/fix-wishlist-index.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: './.env' });

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD
);

async function fixWishlistIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect(DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('wishlists');

    // Get all indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes);

    // Drop the old non-sparse unique index on 'user' if it exists
    try {
      await collection.dropIndex('user_1');
      console.log('✅ Dropped old user_1 index');
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('ℹ️  user_1 index does not exist (already dropped or never created)');
      } else {
        throw error;
      }
    }

    // Drop sessionId index if it exists (to recreate as sparse)
    try {
      await collection.dropIndex('sessionId_1');
      console.log('✅ Dropped old sessionId_1 index');
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('ℹ️  sessionId_1 index does not exist');
      } else {
        throw error;
      }
    }

    // Create new sparse unique index on user
    await collection.createIndex(
      { user: 1 },
      { unique: true, sparse: true, name: 'user_1' }
    );
    console.log('✅ Created sparse unique index on user field');

    // Create new sparse unique index on sessionId
    await collection.createIndex(
      { sessionId: 1 },
      { unique: true, sparse: true, name: 'sessionId_1' }
    );
    console.log('✅ Created sparse unique index on sessionId field');

    // Create index on products.product for faster lookups
    await collection.createIndex(
      { 'products.product': 1 },
      { name: 'products.product_1' }
    );
    console.log('✅ Created index on products.product field');

    // Verify indexes
    const newIndexes = await collection.indexes();
    console.log('\n✅ New indexes:', newIndexes);

    console.log('\n✅ Wishlist indexes fixed successfully!');
    console.log('You can now create multiple wishlists with user: null');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing wishlist indexes:', error);
    process.exit(1);
  }
}

// Run the fix
fixWishlistIndex();

