/**
 * Reset Admin Total Revenue Only
 * This script resets only the admin totalRevenue to zero
 * It does NOT reset seller balances or other stats
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const PlatformStats = require('../src/models/platform/platformStatsModel');

const resetAdminRevenueOnly = async () => {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.DATABASE;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI or DATABASE environment variable is not set');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Reset Admin Revenue Only
    console.log('\n📊 Resetting Admin Total Revenue Only...');
    const platformStats = await PlatformStats.getStats();
    
    const oldAdminRevenue = platformStats.totalRevenue || 0;
    
    platformStats.totalRevenue = 0;
    platformStats.lastUpdated = new Date();
    
    await platformStats.save();
    
    console.log(`   ✅ Admin Total Revenue: GH₵${oldAdminRevenue.toFixed(2)} → GH₵0.00`);
    console.log('\n✅ Admin revenue reset completed successfully!');
    console.log('   Note: Seller balances were NOT affected.');

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting admin revenue:', error);
    process.exit(1);
  }
};

// Run the script
resetAdminRevenueOnly();

