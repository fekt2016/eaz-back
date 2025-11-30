/**
 * Reset Admin Revenue and All Seller Balances
 * 
 * This script resets:
 * - Admin revenue (PlatformStats.totalRevenue)
 * - All seller balances (balance, lockedBalance, pendingBalance, withdrawableBalance)
 * - Daily revenue tracking (optional)
 * 
 * WARNING: This is a destructive operation. Use with caution!
 * 
 * Usage: node backend/scripts/reset-revenue.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const PlatformStats = require('../src/models/platform/platformStatsModel');
const Seller = require('../src/models/user/sellerModel');

const resetRevenue = async () => {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.DATABASE;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI or DATABASE environment variable is not set');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Reset Admin Revenue
    console.log('\n📊 Resetting Admin Revenue...');
    const platformStats = await PlatformStats.getStats();
    
    const oldAdminRevenue = platformStats.totalRevenue || 0;
    const oldTotalOrders = platformStats.totalOrders || 0;
    const oldDeliveredOrders = platformStats.totalDeliveredOrders || 0;
    const oldProductsSold = platformStats.totalProductsSold || 0;
    const oldPendingOrders = platformStats.totalPendingOrders || 0;
    
    platformStats.totalRevenue = 0;
    platformStats.totalOrders = 0;
    platformStats.totalDeliveredOrders = 0;
    platformStats.totalProductsSold = 0;
    platformStats.totalPendingOrders = 0;
    platformStats.dailyRevenue = []; // Clear daily revenue tracking
    platformStats.lastUpdated = new Date();
    
    await platformStats.save();
    
    console.log(`   ✅ Admin Revenue: GH₵${oldAdminRevenue.toFixed(2)} → GH₵0.00`);
    console.log(`   ✅ Total Orders: ${oldTotalOrders} → 0`);
    console.log(`   ✅ Delivered Orders: ${oldDeliveredOrders} → 0`);
    console.log(`   ✅ Products Sold: ${oldProductsSold} → 0`);
    console.log(`   ✅ Pending Orders: ${oldPendingOrders} → 0`);
    console.log(`   ✅ Daily Revenue: Cleared`);

    // Reset All Seller Balances
    console.log('\n👥 Resetting All Seller Balances...');
    const sellers = await Seller.find({});
    
    let totalSellers = 0;
    let totalBalanceReset = 0;
    let totalLockedReset = 0;
    let totalPendingReset = 0;
    
    for (const seller of sellers) {
      const oldBalance = seller.balance || 0;
      const oldLocked = seller.lockedBalance || 0;
      const oldPending = seller.pendingBalance || 0;
      
      seller.balance = 0;
      seller.lockedBalance = 0;
      seller.pendingBalance = 0;
      seller.withdrawableBalance = 0;
      
      await seller.save();
      
      totalSellers++;
      totalBalanceReset += oldBalance;
      totalLockedReset += oldLocked;
      totalPendingReset += oldPending;
      
      if (oldBalance > 0 || oldLocked > 0 || oldPending > 0) {
        console.log(`   ✅ Seller: ${seller.name || seller.shopName || seller._id}`);
        console.log(`      Balance: GH₵${oldBalance.toFixed(2)} → GH₵0.00`);
        if (oldLocked > 0) console.log(`      Locked: GH₵${oldLocked.toFixed(2)} → GH₵0.00`);
        if (oldPending > 0) console.log(`      Pending: GH₵${oldPending.toFixed(2)} → GH₵0.00`);
      }
    }
    
    console.log(`\n   📊 Summary:`);
    console.log(`      Total Sellers: ${totalSellers}`);
    console.log(`      Total Balance Reset: GH₵${totalBalanceReset.toFixed(2)}`);
    console.log(`      Total Locked Reset: GH₵${totalLockedReset.toFixed(2)}`);
    console.log(`      Total Pending Reset: GH₵${totalPendingReset.toFixed(2)}`);

    // Final Summary
    console.log('\n✅ Reset Complete!');
    console.log('\n📋 Summary:');
    console.log(`   Admin Revenue: GH₵${oldAdminRevenue.toFixed(2)} → GH₵0.00`);
    console.log(`   Sellers Reset: ${totalSellers} sellers`);
    console.log(`   Total Seller Balance Reset: GH₵${totalBalanceReset.toFixed(2)}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error resetting revenue:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Run the script
resetRevenue();

