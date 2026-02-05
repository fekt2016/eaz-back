#!/usr/bin/env node
/**
 * Simulate balance API response for a specific seller (benzflex00).
 * Usage: node scripts/checkBalanceApiForSeller.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Seller = require('../src/models/user/sellerModel');
const User = require('../src/models/user/userModel');
const PaymentMethod = require('../src/models/payment/PaymentMethodModel');
const { hasVerifiedPayoutMethod } = require('../src/utils/helpers/paymentMethodHelpers');

const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

const BENZFLEX_SELLER_ID = '6970b22eaba06cadfd4b8035';

async function main() {
  await mongoose.connect(DB);

  const seller = await Seller.findById(BENZFLEX_SELLER_ID)
    .select('balance lockedBalance pendingBalance withdrawableBalance name shopName email paymentMethods')
    .lean();

  if (!seller) {
    console.log('Seller not found');
    process.exit(1);
  }

  console.log('\n=== BALANCE API SIMULATION (benzflex00) ===\n');
  console.log('Seller ID:', seller._id);
  console.log('Email:', seller.email);
  console.log('paymentMethods:', JSON.stringify(seller.paymentMethods, null, 2));

  let payoutCheck = hasVerifiedPayoutMethod(seller);
  let payoutStatus = payoutCheck.hasVerified ? 'verified' : (payoutCheck.allRejected ? 'rejected' : 'pending');

  console.log('\nAfter hasVerifiedPayoutMethod: payoutStatus =', payoutStatus);

  if (payoutStatus !== 'verified' && seller.email) {
    let userAccount = await User.findOne({ email: seller.email }).select('_id').lean();
    console.log('User (exact email):', userAccount ? userAccount._id : 'NOT FOUND');

    if (!userAccount) {
      const escaped = String(seller.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      userAccount = await User.findOne({ email: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
      console.log('User (case-insensitive):', userAccount ? userAccount._id : 'NOT FOUND');
    }

    if (userAccount) {
      const verifiedPm = await PaymentMethod.findOne({
        user: userAccount._id,
        $or: [{ verificationStatus: 'verified' }, { status: 'verified' }],
      }).lean();
      console.log('Verified PaymentMethod:', verifiedPm ? verifiedPm._id : 'NOT FOUND');

      if (verifiedPm) {
        payoutStatus = 'verified';
        payoutCheck = { hasVerified: true, rejectionReasons: [] };
      }
    }
  }

  console.log('\n>>> FINAL payoutStatus:', payoutStatus);
  console.log('>>> canWithdraw:', payoutStatus === 'verified');
  console.log('\n');

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
